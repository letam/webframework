import type { QueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/sonner'
import { cancelPostByClientUuid, createPost, transcribePost } from '@/lib/api/posts'
import { ApiError } from '@/lib/api/errors'
import { applyCreatedPostToCaches, applyUpdatedPostToCaches } from '@/hooks/usePosts'
import { clearCsrfTokenCache } from '@/lib/utils/fetch'
import { getSettings } from '@/lib/utils/settings'
import {
	claimOutboxEntryForSend,
	cancelOutboxEntry,
	deleteCancelledOutboxEntry,
	deleteOwnedOutboxEntryClaim,
	inspectOutboxEntry,
	loadOutboxEntries,
	OUTBOX_CLAIM_LEASE_MS,
	renewOutboxEntryClaim,
	resetFailedOutboxEntryForRetry,
	saveOutboxEntry,
	updateOwnedOutboxEntryClaim,
	type OwnedOutboxClaimResult,
	type OutboxEntry,
} from '@/lib/utils/outboxDb'

// Mirrors MAX_MEDIA_UPLOAD_BYTES in server/config/settings.py.
export const MAX_QUEUED_MEDIA_BYTES = 100 * 1024 * 1024

export type SyncMode = 'auto' | 'local'

export type EnqueueInput = Omit<
	OutboxEntry,
	'id' | 'createdAt' | 'status' | 'attempts' | 'lastError' | 'claimOwner' | 'claimExpiresAt'
>

export interface OutboxAuthState {
	isAuthenticated: boolean
	userId: number | null
	isAuthResolved: boolean
}

export interface OutboxDependencies {
	queryClient: QueryClient
	getAuthState: () => OutboxAuthState
	refreshAuthStatus: () => Promise<boolean>
}

export interface OutboxSnapshot {
	entries: OutboxEntry[]
	flushing: boolean
	syncMode: SyncMode
}

const RETRY_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const
const LOAD_RETRY_DELAY_MS = 1_000
const CANCELLATION_RETRY_DELAY_MS = 5_000
const STORAGE_ACCESS_ERROR = "Couldn't access a queued post on this device. Try again."
const outboxClaimOwner = crypto.randomUUID()

const getInitialSyncMode = (): SyncMode => {
	if (typeof localStorage === 'undefined') return 'auto'
	try {
		return localStorage.getItem('post-sync-mode') === 'local' ? 'local' : 'auto'
	} catch {
		return 'auto'
	}
}

const getPersistedSyncMode = (): SyncMode | null => {
	if (typeof localStorage === 'undefined') return null
	try {
		const stored = localStorage.getItem('post-sync-mode')
		return stored === 'auto' || stored === 'local' ? stored : null
	} catch {
		return null
	}
}

const persistSyncMode = (mode: SyncMode) => {
	if (typeof localStorage === 'undefined') return false
	try {
		localStorage.setItem('post-sync-mode', mode)
		return true
	} catch {
		// Storage can be unavailable in private or restricted browsing contexts.
		return false
	}
}

export const resolveInitialSyncMode = (): SyncMode => {
	const postSyncDefault = getSettings().postSyncDefault
	return postSyncDefault === 'remember' ? getInitialSyncMode() : postSyncDefault
}

const initialSyncMode = resolveInitialSyncMode()
let snapshot: OutboxSnapshot = {
	entries: [],
	flushing: false,
	syncMode: initialSyncMode,
}
// Explicit auto/local defaults override remembered composer history. Persist the
// resolved startup value so the first automatic flush cannot adopt stale history.
let syncModePersistenceFailed = !persistSyncMode(initialSyncMode)
let dependencies: OutboxDependencies | null = null
let retryTimer: number | undefined
let loadRetryTimer: number | undefined
let retryIndex = 0
const sendingReconcileTimers = new Map<string, number>()
const cancellationReconcileTimers = new Map<string, number>()
let flushLocked = false
// Flush requests that arrive while a pass holds the lock; replayed when the pass ends.
// Manual intent is sticky because any explicit request must remain explicit when
// several overlapping requests collapse into one drain pass.
let pendingFlush: { ids: Set<string>; manual: boolean } | null = null
const listeners = new Set<() => void>()

const publishSnapshot = (next: OutboxSnapshot) => {
	snapshot = next
	for (const listener of listeners) listener()
}

const setEntries = (entries: OutboxEntry[]) => {
	publishSnapshot({ ...snapshot, entries: [...entries].sort((a, b) => a.createdAt - b.createdAt) })
}

const refreshSyncModeFromStorage = () => {
	// A failed local write leaves the old value readable. Until a later write
	// succeeds, the explicit in-memory choice is newer and must remain authoritative.
	if (syncModePersistenceFailed) return snapshot.syncMode
	const persisted = getPersistedSyncMode()
	if (persisted && persisted !== snapshot.syncMode) {
		publishSnapshot({ ...snapshot, syncMode: persisted })
		if (persisted === 'local') resetBackoff()
	}
	return snapshot.syncMode
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine

const clearSendingReconcileTimer = (id: string) => {
	const timer = sendingReconcileTimers.get(id)
	if (timer !== undefined && typeof window !== 'undefined') window.clearTimeout(timer)
	sendingReconcileTimers.delete(id)
}

const clearCancellationReconcileTimer = (id: string) => {
	const timer = cancellationReconcileTimers.get(id)
	if (timer !== undefined && typeof window !== 'undefined') window.clearTimeout(timer)
	cancellationReconcileTimers.delete(id)
}

const scheduleCancellationReconciliation = (id: string) => {
	if (typeof window === 'undefined' || !isOnline() || cancellationReconcileTimers.has(id)) {
		return
	}
	const timer = window.setTimeout(() => {
		cancellationReconcileTimers.delete(id)
		void reconcileCancelledEntry(id)
	}, CANCELLATION_RETRY_DELAY_MS)
	cancellationReconcileTimers.set(id, timer)
}

const scheduleSendingReconciliation = (id: string) => {
	if (typeof window === 'undefined' || sendingReconcileTimers.has(id)) return
	const timer = window.setTimeout(async () => {
		sendingReconcileTimers.delete(id)
		const current = snapshot.entries.find((entry) => entry.id === id)
		if (!current) return

		const durable = await inspectOutboxEntry(id)
		if (durable.status === 'missing') {
			setEntries(snapshot.entries.filter((entry) => entry.id !== id))
			return
		}
		if (durable.status === 'found' && durable.entry.status !== 'sending') {
			setEntries(snapshot.entries.map((entry) => (entry.id === id ? durable.entry : entry)))
			if (durable.entry.status === 'cancelled') {
				scheduleCancellationReconciliation(id)
				return
			}
			if (durable.entry.status === 'queued' && snapshot.syncMode === 'auto' && isOnline()) {
				void flushOutbox()
			}
			return
		}
		scheduleSendingReconciliation(id)
	}, 1_000)
	sendingReconcileTimers.set(id, timer)
}

const resetBackoff = () => {
	if (retryTimer !== undefined && typeof window !== 'undefined') {
		window.clearTimeout(retryTimer)
	}
	retryTimer = undefined
	retryIndex = 0
}

const clearLoadRetry = () => {
	if (loadRetryTimer !== undefined && typeof window !== 'undefined') {
		window.clearTimeout(loadRetryTimer)
	}
	loadRetryTimer = undefined
}

const scheduleLoadRetry = () => {
	if (loadRetryTimer !== undefined || typeof window === 'undefined') return
	loadRetryTimer = window.setTimeout(() => {
		loadRetryTimer = undefined
		void reloadDurableEntriesAndFlush()
	}, LOAD_RETRY_DELAY_MS)
}

const scheduleRetry = () => {
	if (
		retryTimer !== undefined ||
		typeof window === 'undefined' ||
		!isOnline() ||
		snapshot.syncMode !== 'auto'
	) {
		return
	}

	const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)]
	retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS_MS.length - 1)
	retryTimer = window.setTimeout(() => {
		retryTimer = undefined
		void flushOutbox()
	}, delay)
}

export const isOutboxEntryVisible = (
	entry: OutboxEntry,
	auth: Pick<OutboxAuthState, 'isAuthenticated' | 'userId'>
) =>
	auth.isAuthenticated
		? entry.author === auth.userId || entry.author === 'unknown'
		: entry.author === 'anon' || entry.author === 'unknown'

const getKnownAuthState = async () => {
	if (!dependencies) return null
	// Cookies can change in another tab without updating this tab's React state.
	// Revalidate at every actual send boundary so an entry selected for one author
	// can never be published under a different current server session.
	if (!(await dependencies.refreshAuthStatus())) return null
	const auth = dependencies.getAuthState()
	return auth.isAuthResolved ? auth : null
}

type CancellationResult = 'removed' | 'published' | 'pending'

const reconcileCancelledEntry = async (id: string): Promise<CancellationResult> => {
	const entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (!entry || entry.status !== 'cancelled') return 'removed'
	if (!dependencies || !isOnline()) return 'pending'

	let retriedCsrf = false
	while (true) {
		try {
			const auth = await getKnownAuthState()
			if (!auth) {
				scheduleCancellationReconciliation(id)
				return 'pending'
			}
			if (!isOutboxEntryVisible(entry, auth)) return 'pending'
			const expectedAuthor = auth.isAuthenticated ? (auth.userId as number) : 'anon'
			const publishedPost = await cancelPostByClientUuid(entry.id, expectedAuthor)
			const cleanup = await deleteCancelledOutboxEntry(id)
			if (cleanup.status === 'unavailable') {
				scheduleCancellationReconciliation(id)
				return 'pending'
			}
			if (cleanup.status === 'conflict') {
				// The server has accepted the cancellation, so a stale tab must not
				// resurrect the same UUID between acknowledgement and local cleanup.
				const restored = await cancelOutboxEntry(id, cleanup.entry)
				if (restored.status === 'cancelled') {
					setEntries(
						snapshot.entries.map((candidate) => (candidate.id === id ? restored.entry : candidate))
					)
				}
				scheduleCancellationReconciliation(id)
				return 'pending'
			}
			clearCancellationReconcileTimer(id)
			setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
			if (publishedPost && dependencies) {
				applyCreatedPostToCaches(dependencies.queryClient, publishedPost)
			}
			return publishedPost ? 'published' : 'removed'
		} catch (error) {
			if (error instanceof ApiError && error.status === 403 && !retriedCsrf) {
				clearCsrfTokenCache()
				retriedCsrf = true
				continue
			}
			scheduleCancellationReconciliation(id)
			return 'pending'
		}
	}
}

const reconcileCancelledEntries = async () => {
	for (const entry of snapshot.entries.filter((candidate) => candidate.status === 'cancelled')) {
		await reconcileCancelledEntry(entry.id)
	}
}

const buildCreateRequest = (entry: OutboxEntry, auth: OutboxAuthState) => ({
	text: entry.text,
	client_uuid: entry.id,
	expected_author: auth.isAuthenticated ? (auth.userId as number) : ('anon' as const),
	...(entry.visibility === null ? {} : { visibility: entry.visibility }),
	is_draft: entry.isDraft,
	link_previews_enabled: entry.linkPreviewsEnabled,
	...(entry.media && entry.mediaName && entry.mediaType
		? {
				media_type: entry.mediaType,
				media: new File([entry.media], entry.mediaName, { type: entry.media.type }),
			}
		: {}),
})

type SyncResult = 'synced' | 'network' | 'failed' | 'retryable' | 'storage' | 'skipped'

const adoptOwnedClaimResult = (
	id: string,
	result: OwnedOutboxClaimResult,
	unavailableFallback?: Partial<OutboxEntry>
) => {
	if (result.status === 'updated') {
		setEntries(snapshot.entries.map((entry) => (entry.id === id ? result.entry : entry)))
		return
	}
	if (result.status === 'removed' || result.status === 'missing') {
		setEntries(snapshot.entries.filter((entry) => entry.id !== id))
		return
	}
	if (result.status === 'lost') {
		setEntries(snapshot.entries.map((entry) => (entry.id === id ? result.entry : entry)))
		if (result.entry.status === 'sending') scheduleSendingReconciliation(id)
		if (result.entry.status === 'cancelled') scheduleCancellationReconciliation(id)
		return
	}
	if (unavailableFallback) {
		setEntries(
			snapshot.entries.map((entry) =>
				entry.id === id
					? {
							...entry,
							...unavailableFallback,
							claimOwner: null,
							claimExpiresAt: null,
						}
					: entry
			)
		)
		scheduleSendingReconciliation(id)
	}
}

const updateOwnedClaimAfterSend = async (
	entry: OutboxEntry,
	changes: Partial<OutboxEntry>,
	unavailableFallback: Partial<OutboxEntry> = {
		status: 'failed',
		lastError: "Couldn't save this post's status. Try again.",
	}
) => {
	const result = await updateOwnedOutboxEntryClaim(entry.id, outboxClaimOwner, changes)
	adoptOwnedClaimResult(entry.id, result, unavailableFallback)
	return result
}

const markFailure = async (entry: OutboxEntry, error: unknown): Promise<SyncResult> => {
	if (error instanceof TypeError) {
		await updateOwnedClaimAfterSend(entry, { status: 'queued', lastError: null })
		return 'network'
	}

	if (error instanceof ApiError) {
		if (error.status === 401) {
			await updateOwnedClaimAfterSend(entry, {
				status: 'failed',
				lastError: 'Sign in to post this.',
			})
			return 'failed'
		}
		if (error.status === 429 || error.status >= 500) {
			const attempts = entry.attempts + 1
			if (attempts < 5) {
				await updateOwnedClaimAfterSend(entry, {
					status: 'queued',
					attempts,
					lastError: null,
				})
				return 'retryable'
			}
			await updateOwnedClaimAfterSend(entry, {
				status: 'failed',
				attempts,
				lastError: 'The server had trouble with this post. Try again in a bit.',
			})
			return 'failed'
		}
		if (error.status === 409) {
			const result = await updateOwnedClaimAfterSend(entry, {
				status: 'failed',
				lastError: 'The server rejected this post.',
			})
			if (
				result.status === 'missing' ||
				result.status === 'removed' ||
				(result.status === 'lost' && result.entry.status === 'cancelled')
			) {
				return 'skipped'
			}
			return 'failed'
		}
		if (error.status < 500) {
			await updateOwnedClaimAfterSend(entry, {
				status: 'failed',
				lastError: 'The server rejected this post.',
			})
			return 'failed'
		}
	}

	await updateOwnedClaimAfterSend(entry, {
		status: 'failed',
		lastError: "Couldn't post this. Try again.",
	})
	return 'failed'
}

const syncEntry = async (id: string, auth: OutboxAuthState): Promise<SyncResult> => {
	let entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (!entry || !auth.isAuthResolved || !isOutboxEntryVisible(entry, auth)) return 'skipped'

	// Claim and verify the durable row in one transaction. This prevents a stale
	// snapshot in another tab from recreating and publishing a post that the user
	// already removed there.
	const claim = await claimOutboxEntryForSend(id, outboxClaimOwner)
	if (claim.status === 'unavailable') return 'storage'
	if (claim.status === 'missing') {
		setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
		return 'skipped'
	}
	if (claim.status === 'not-queued') {
		setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? claim.entry : candidate)))
		if (claim.entry.status === 'sending') scheduleSendingReconciliation(id)
		if (claim.entry.status === 'cancelled') scheduleCancellationReconciliation(id)
		return 'skipped'
	}
	entry = claim.entry
	setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? entry : candidate)))
	if (!isOutboxEntryVisible(entry, auth)) {
		await updateOwnedClaimAfterSend(entry, { status: 'queued' })
		return 'skipped'
	}
	let retriedCsrf = false
	const claimHeartbeat =
		typeof window === 'undefined'
			? undefined
			: window.setInterval(
					() => {
						void renewOutboxEntryClaim(entry.id, outboxClaimOwner)
					},
					Math.min(OUTBOX_CLAIM_LEASE_MS / 3, 60_000)
				)

	try {
		while (true) {
			try {
				const post = await createPost(buildCreateRequest(entry, auth))
				const completion = await deleteOwnedOutboxEntryClaim(entry.id, outboxClaimOwner)
				if (completion.status === 'unavailable') {
					// Publication succeeded, so this entry must never return to the send queue.
					// Keep the durable copy visible as cleanup-only instead of silently allowing
					// it to reappear as a queued post after reload.
					await updateOwnedClaimAfterSend(
						entry,
						{
							status: 'published',
							lastError: "This post was published, but its local copy couldn't be cleared.",
						},
						{
							status: 'published',
							lastError: "This post was published, but its local copy couldn't be cleared.",
						}
					)
				} else {
					adoptOwnedClaimResult(entry.id, completion)
				}
				if (dependencies) applyCreatedPostToCaches(dependencies.queryClient, post)
				resetBackoff()

				if (
					entry.autoTranscribe &&
					(entry.mediaType === 'audio' || entry.mediaType === 'video') &&
					auth.isAuthenticated
				) {
					const queryClient = dependencies?.queryClient
					void transcribePost(post.id)
						.then((updatedPost) => {
							if (queryClient) applyUpdatedPostToCaches(queryClient, updatedPost)
						})
						.catch((error) => {
							console.error('Auto-transcription failed to start:', error)
							toast.error('Auto-transcription failed to start')
						})
				}
				return 'synced'
			} catch (error) {
				if (error instanceof ApiError && error.status === 403 && !retriedCsrf) {
					clearCsrfTokenCache()
					retriedCsrf = true
					let retryAuth: OutboxAuthState | null
					try {
						retryAuth = await getKnownAuthState()
					} catch {
						retryAuth = null
					}
					if (!retryAuth) {
						await updateOwnedClaimAfterSend(entry, { status: 'queued' })
						return 'network'
					}
					if (!isOutboxEntryVisible(entry, retryAuth)) {
						await updateOwnedClaimAfterSend(entry, { status: 'queued' })
						return 'skipped'
					}
					auth = retryAuth
					continue
				}
				if (error instanceof ApiError && error.status === 403) {
					await updateOwnedClaimAfterSend(entry, {
						status: 'failed',
						lastError: "Couldn't post this. Try again.",
					})
					return 'failed'
				}
				return markFailure(entry, error)
			}
		}
	} finally {
		if (claimHeartbeat !== undefined && typeof window !== 'undefined') {
			window.clearInterval(claimHeartbeat)
		}
	}
}

const runFlush = async (ids: string[], options?: { manual?: boolean }) => {
	if (ids.length === 0 || !isOnline()) return
	if (!options?.manual && refreshSyncModeFromStorage() !== 'auto') return
	if (flushLocked || snapshot.flushing) {
		pendingFlush ??= { ids: new Set(), manual: false }
		for (const id of ids) pendingFlush.ids.add(id)
		pendingFlush.manual ||= options?.manual === true
		return
	}
	flushLocked = true
	publishSnapshot({ ...snapshot, flushing: true })
	let synced = 0
	let failed = 0
	let shouldRetry = false
	let authFailed = false
	let storageFailed = false

	try {
		for (const id of ids) {
			// The user can flip auto-sync off while a pass is mid-flight; an automatic
			// pass stops at the next entry boundary (a manual "Post all" keeps going).
			if (!options?.manual && refreshSyncModeFromStorage() !== 'auto') break
			let latestAuth: OutboxAuthState | null
			try {
				latestAuth = await getKnownAuthState()
			} catch {
				latestAuth = null
			}
			if (!latestAuth) {
				authFailed = true
				shouldRetry = true
				break
			}
			// Auth refresh is asynchronous, so local mode can be selected while it is
			// in flight. Never claim or send until the automatic boundary is rechecked.
			if (!options?.manual && refreshSyncModeFromStorage() !== 'auto') break
			const result = await syncEntry(id, latestAuth)
			if (result === 'synced') synced += 1
			if (result === 'failed') failed += 1
			if (result === 'retryable') shouldRetry = true
			if (result === 'storage') {
				shouldRetry = true
				storageFailed = true
			}
			if (result === 'network') {
				shouldRetry = true
				break
			}
		}
	} finally {
		publishSnapshot({ ...snapshot, flushing: false })
		flushLocked = false
	}
	if (authFailed) {
		const manualAuthFailed = options?.manual === true || pendingFlush?.manual === true
		// Ids latched during a failed auth check would otherwise replay from an
		// unrelated later pass. Auto mode's backoff below covers the whole queue.
		pendingFlush = null
		if (manualAuthFailed) {
			toast.error("Couldn't reach the server — your posts are still on this device.")
		}
	}

	if (synced === 1) toast('Synced 1 queued post.')
	if (synced > 1) toast(`Synced ${synced} queued posts.`)
	if (failed > 0) {
		toast.error("A queued post couldn't be sent. It's still on this device.")
	}
	if (storageFailed && options?.manual) {
		toast.error(STORAGE_ACCESS_ERROR)
	}
	if (
		options?.manual &&
		refreshSyncModeFromStorage() === 'auto' &&
		snapshot.entries.some((entry) => entry.status === 'queued')
	) {
		// A successful single-entry send resets the shared backoff. Keep remaining
		// retryable entries live instead of stranding them behind that manual action.
		shouldRetry = true
	}
	if (shouldRetry) scheduleRetry()
	await drainPendingFlush()
}

const drainPendingFlush = async () => {
	if (!pendingFlush) return
	const requested = pendingFlush
	pendingFlush = null
	const ids = snapshot.entries
		.filter((entry) => entry.status === 'queued' && requested.ids.has(entry.id))
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((entry) => entry.id)
	await runFlush(ids, { manual: requested.manual })
}

export const configureOutbox = (nextDependencies: OutboxDependencies) => {
	dependencies = nextDependencies
}

export const subscribeOutbox = (callback: () => void) => {
	listeners.add(callback)
	return () => listeners.delete(callback)
}

export const getOutboxSnapshot = () => snapshot

export const getEffectiveSyncMode = () => refreshSyncModeFromStorage()

const reloadDurableEntriesAndFlush = async () => {
	await loadOutbox()
	await flushOutbox()
}

export const setSyncMode = (mode: SyncMode) => {
	if (snapshot.syncMode === mode) {
		syncModePersistenceFailed = !persistSyncMode(mode)
		if (mode === 'auto') void reloadDurableEntriesAndFlush()
		return
	}
	publishSnapshot({ ...snapshot, syncMode: mode })
	syncModePersistenceFailed = !persistSyncMode(mode)
	if (mode === 'auto') void reloadDurableEntriesAndFlush()
}

export const loadOutbox = async (): Promise<boolean> => {
	const entryIdsAtLoadStart = new Set(snapshot.entries.map((entry) => entry.id))
	const loaded = await loadOutboxEntries()
	if (loaded.status === 'unavailable') {
		scheduleLoadRetry()
		return false
	}
	clearLoadRetry()
	const entriesById = new Map(loaded.entries.map((entry) => [entry.id, entry]))
	// Durable state wins for everything that existed when the read began: another
	// tab may have sent/deleted it or advanced its status. Preserve only entries
	// this tab genuinely enqueued while the asynchronous read was in flight.
	for (const entry of snapshot.entries) {
		if (!entryIdsAtLoadStart.has(entry.id)) entriesById.set(entry.id, entry)
	}
	const entries = [...entriesById.values()]
	setEntries(entries)
	for (const entry of entries) {
		if (entry.status === 'sending') scheduleSendingReconciliation(entry.id)
		if (entry.status === 'cancelled') scheduleCancellationReconciliation(entry.id)
	}
	return true
}

// `id` lets the composer's online-submit fallback reuse the client_uuid its live
// request already carried, so a create whose response was lost dedupes on flush.
export const enqueuePost = async (input: EnqueueInput & { id?: string }): Promise<boolean> => {
	const entry: OutboxEntry = {
		...input,
		id: input.id ?? crypto.randomUUID(),
		createdAt: Date.now(),
		status: 'queued',
		attempts: 0,
		lastError: null,
		claimOwner: null,
		claimExpiresAt: null,
	}
	if (!(await saveOutboxEntry(entry))) return false

	setEntries([...snapshot.entries, entry])
	if (isOnline()) void flushOutbox()
	return true
}

export const flushOutbox = async (options?: { manual?: boolean }) => {
	if (!options?.manual && refreshSyncModeFromStorage() !== 'auto') return
	const ids = snapshot.entries
		.filter((entry) => entry.status === 'queued')
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((entry) => entry.id)
	await runFlush(ids, options)
}

export const flushEntry = async (id: string) => {
	await runFlush([id], { manual: true })
}

export const retryEntry = async (id: string) => {
	const entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (!entry || entry.status !== 'failed') return
	const reset = await resetFailedOutboxEntryForRetry(id)
	if (reset.status === 'unavailable') {
		toast.error(STORAGE_ACCESS_ERROR)
		return
	}
	if (reset.status === 'missing') {
		setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
		return
	}
	if (reset.status === 'conflict') {
		setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? reset.entry : candidate)))
		if (reset.entry.status === 'sending') scheduleSendingReconciliation(id)
		if (reset.entry.status === 'cancelled') scheduleCancellationReconciliation(id)
		return
	}
	setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? reset.entry : candidate)))
	await runFlush([id], { manual: true })
}

export type RemoveEntryResult = 'removed' | 'published' | 'pending' | 'failed'

export const removeEntry = async (id: string): Promise<RemoveEntryResult> => {
	const entry = snapshot.entries.find((candidate) => candidate.id === id)
	const cancellation = await cancelOutboxEntry(id, entry)
	if (cancellation.status === 'unavailable') {
		return 'failed'
	}
	if (cancellation.status === 'missing') {
		setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
		return 'removed'
	}
	setEntries([...snapshot.entries.filter((candidate) => candidate.id !== id), cancellation.entry])
	return reconcileCancelledEntry(id)
}

export const handleOutboxOnline = async () => {
	resetBackoff()
	if (!dependencies) return
	await reconcileCancelledEntries()
	await flushOutbox()
}

export const __resetOutboxForTests = () => {
	resetBackoff()
	clearLoadRetry()
	for (const id of sendingReconcileTimers.keys()) clearSendingReconcileTimer(id)
	for (const id of cancellationReconcileTimers.keys()) clearCancellationReconcileTimer(id)
	snapshot = { entries: [], flushing: false, syncMode: 'auto' }
	syncModePersistenceFailed = false
	dependencies = null
	flushLocked = false
	pendingFlush = null
	listeners.clear()
}
