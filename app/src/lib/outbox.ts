import type { QueryClient } from '@tanstack/react-query'
import { toast } from '@/components/ui/sonner'
import { createPost, transcribePost } from '@/lib/api/posts'
import { ApiError } from '@/lib/api/errors'
import { applyCreatedPostToCaches, applyUpdatedPostToCaches } from '@/hooks/usePosts'
import { clearCsrfTokenCache } from '@/lib/utils/fetch'
import { getSettings } from '@/lib/utils/settings'
import {
	claimOutboxEntryForSend,
	deleteOutboxEntry,
	inspectOutboxEntry,
	loadOutboxEntries,
	OUTBOX_CLAIM_LEASE_MS,
	removeOutboxEntryIfIdle,
	renewOutboxEntryClaim,
	resetFailedOutboxEntryForRetry,
	saveOutboxEntry,
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
const outboxClaimOwner = crypto.randomUUID()

const getInitialSyncMode = (): SyncMode => {
	if (typeof localStorage === 'undefined') return 'auto'
	try {
		return localStorage.getItem('post-sync-mode') === 'local' ? 'local' : 'auto'
	} catch {
		return 'auto'
	}
}

export const resolveInitialSyncMode = (): SyncMode => {
	const postSyncDefault = getSettings().postSyncDefault
	return postSyncDefault === 'remember' ? getInitialSyncMode() : postSyncDefault
}

let snapshot: OutboxSnapshot = {
	entries: [],
	flushing: false,
	syncMode: resolveInitialSyncMode(),
}
let dependencies: OutboxDependencies | null = null
let retryTimer: number | undefined
let retryIndex = 0
const sendingReconcileTimers = new Map<string, number>()
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

const updateEntry = async (
	id: string,
	changes: Partial<OutboxEntry>,
	options?: { recoverFailedSend?: boolean }
) => {
	const current = snapshot.entries.find((entry) => entry.id === id)
	if (!current) return null
	const updated = {
		...current,
		...changes,
		...(changes.status && changes.status !== 'sending'
			? { claimOwner: null, claimExpiresAt: null }
			: {}),
	}
	setEntries(snapshot.entries.map((entry) => (entry.id === id ? updated : entry)))
	if (!(await saveOutboxEntry(updated))) {
		// Keep the reactive snapshot aligned with IndexedDB. Only roll back our own
		// optimistic update; a newer mutation may have replaced it while the write
		// was pending.
		if (snapshot.entries.find((entry) => entry.id === id) === updated) {
			const fallback =
				options?.recoverFailedSend && current.status === 'sending'
					? {
							...current,
							status: 'failed' as const,
							lastError: "Couldn't save this post's status. Try again.",
							claimOwner: null,
							claimExpiresAt: null,
						}
					: current
			setEntries(snapshot.entries.map((entry) => (entry.id === id ? fallback : entry)))
		}
		return null
	}
	return updated
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine

const clearSendingReconcileTimer = (id: string) => {
	const timer = sendingReconcileTimers.get(id)
	if (timer !== undefined && typeof window !== 'undefined') window.clearTimeout(timer)
	sendingReconcileTimers.delete(id)
}

const scheduleSendingReconciliation = (id: string) => {
	if (typeof window === 'undefined' || sendingReconcileTimers.has(id)) return
	const timer = window.setTimeout(async () => {
		sendingReconcileTimers.delete(id)
		const current = snapshot.entries.find((entry) => entry.id === id)
		if (current?.status !== 'sending') return

		const durable = await inspectOutboxEntry(id)
		if (durable.status === 'missing') {
			setEntries(snapshot.entries.filter((entry) => entry.id !== id))
			return
		}
		if (durable.status === 'found' && durable.entry.status !== 'sending') {
			setEntries(snapshot.entries.map((entry) => (entry.id === id ? durable.entry : entry)))
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

const buildCreateRequest = (entry: OutboxEntry) => ({
	text: entry.text,
	client_uuid: entry.id,
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

type SyncResult = 'synced' | 'network' | 'failed' | 'retryable' | 'skipped'

const markFailure = async (entry: OutboxEntry, error: unknown): Promise<SyncResult> => {
	if (error instanceof TypeError) {
		await updateEntry(entry.id, { status: 'queued', lastError: null }, { recoverFailedSend: true })
		return 'network'
	}

	if (error instanceof ApiError) {
		if (error.status === 401) {
			await updateEntry(
				entry.id,
				{
					status: 'failed',
					lastError: 'Sign in to post this.',
				},
				{ recoverFailedSend: true }
			)
			return 'failed'
		}
		if (error.status === 429 || error.status >= 500) {
			const attempts = entry.attempts + 1
			if (attempts < 5) {
				await updateEntry(
					entry.id,
					{ status: 'queued', attempts, lastError: null },
					{ recoverFailedSend: true }
				)
				return 'retryable'
			}
			await updateEntry(
				entry.id,
				{
					status: 'failed',
					attempts,
					lastError: 'The server had trouble with this post. Try again in a bit.',
				},
				{ recoverFailedSend: true }
			)
			return 'failed'
		}
		if (error.status < 500) {
			await updateEntry(
				entry.id,
				{
					status: 'failed',
					lastError: 'The server rejected this post.',
				},
				{ recoverFailedSend: true }
			)
			return 'failed'
		}
	}

	await updateEntry(
		entry.id,
		{
			status: 'failed',
			lastError: "Couldn't post this. Try again.",
		},
		{ recoverFailedSend: true }
	)
	return 'failed'
}

const syncEntry = async (id: string, auth: OutboxAuthState): Promise<SyncResult> => {
	let entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (!entry || !auth.isAuthResolved || !isOutboxEntryVisible(entry, auth)) return 'skipped'

	// Claim and verify the durable row in one transaction. This prevents a stale
	// snapshot in another tab from recreating and publishing a post that the user
	// already removed there.
	const claim = await claimOutboxEntryForSend(id, outboxClaimOwner)
	if (claim.status === 'unavailable') return 'failed'
	if (claim.status === 'missing') {
		setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
		return 'skipped'
	}
	if (claim.status === 'not-queued') {
		setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? claim.entry : candidate)))
		if (claim.entry.status === 'sending') scheduleSendingReconciliation(id)
		return 'skipped'
	}
	entry = claim.entry
	setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? entry : candidate)))
	if (!isOutboxEntryVisible(entry, auth)) {
		await updateEntry(id, { status: 'queued' })
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
				const post = await createPost(buildCreateRequest(entry))
				const deleted = await deleteOutboxEntry(entry.id)
				if (deleted) {
					setEntries(snapshot.entries.filter((candidate) => candidate.id !== entry?.id))
				} else {
					// Publication succeeded, so this entry must never return to the send queue.
					// Keep the durable copy visible as cleanup-only instead of silently allowing
					// it to reappear as a queued post after reload.
					await updateEntry(entry.id, {
						status: 'published',
						lastError: "This post was published, but its local copy couldn't be cleared.",
					})
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
						await updateEntry(entry.id, { status: 'queued' }, { recoverFailedSend: true })
						return 'network'
					}
					if (!isOutboxEntryVisible(entry, retryAuth)) {
						await updateEntry(entry.id, { status: 'queued' }, { recoverFailedSend: true })
						return 'skipped'
					}
					auth = retryAuth
					continue
				}
				if (error instanceof ApiError && error.status === 403) {
					await updateEntry(
						entry.id,
						{
							status: 'failed',
							lastError: "Couldn't post this. Try again.",
						},
						{ recoverFailedSend: true }
					)
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

	try {
		for (const id of ids) {
			// The user can flip auto-sync off while a pass is mid-flight; an automatic
			// pass stops at the next entry boundary (a manual "Post all" keeps going).
			if (!options?.manual && snapshot.syncMode !== 'auto') break
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
			const result = await syncEntry(id, latestAuth)
			if (result === 'synced') synced += 1
			if (result === 'failed') failed += 1
			if (result === 'retryable') shouldRetry = true
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
		// Ids latched during a failed auth check would otherwise replay from an
		// unrelated later pass. Auto mode's backoff below covers the whole queue.
		pendingFlush = null
		if (options?.manual) {
			toast.error("Couldn't reach the server — your posts are still on this device.")
		}
	}

	if (synced === 1) toast('Synced 1 queued post.')
	if (synced > 1) toast(`Synced ${synced} queued posts.`)
	if (failed > 0) {
		toast.error("A queued post couldn't be sent. It's still on this device.")
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

export const setSyncMode = (mode: SyncMode) => {
	if (snapshot.syncMode === mode) return
	publishSnapshot({ ...snapshot, syncMode: mode })
	try {
		localStorage.setItem('post-sync-mode', mode)
	} catch {
		// Storage can be unavailable in private or restricted browsing contexts.
	}
	if (mode === 'auto') void flushOutbox()
}

export const loadOutbox = async () => {
	const entriesById = new Map((await loadOutboxEntries()).map((entry) => [entry.id, entry]))
	for (const entry of snapshot.entries) entriesById.set(entry.id, entry)
	const entries = [...entriesById.values()]
	setEntries(entries)
	for (const entry of entries) {
		if (entry.status === 'sending') scheduleSendingReconciliation(entry.id)
	}
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
	if (snapshot.syncMode !== 'auto' && !options?.manual) return
	const ids = snapshot.entries
		.filter((entry) => entry.status === 'queued')
		.sort((a, b) => a.createdAt - b.createdAt)
		.map((entry) => entry.id)
	await runFlush(ids, options)
}

export const flushEntry = async (id: string) => {
	resetBackoff()
	await runFlush([id], { manual: true })
}

export const retryEntry = async (id: string) => {
	resetBackoff()
	const entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (!entry || entry.status !== 'failed') return
	const reset = await resetFailedOutboxEntryForRetry(id)
	if (reset.status === 'unavailable') return
	if (reset.status === 'missing') {
		setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
		return
	}
	if (reset.status === 'conflict') {
		setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? reset.entry : candidate)))
		if (reset.entry.status === 'sending') scheduleSendingReconciliation(id)
		return
	}
	setEntries(snapshot.entries.map((candidate) => (candidate.id === id ? reset.entry : candidate)))
	await runFlush([id], { manual: true })
}

export type RemoveEntryResult = 'removed' | 'sending' | 'failed'

export const removeEntry = async (id: string): Promise<RemoveEntryResult> => {
	// A 'sending' entry's POST is already in flight — deleting it here couldn't stop
	// publication, so refuse instead of pretending the post is gone.
	const entry = snapshot.entries.find((candidate) => candidate.id === id)
	if (entry?.status === 'sending') return 'sending'
	// Drop from the snapshot before awaiting the IDB delete: a flush trigger firing
	// inside that await (backoff timer, reconnect, another enqueue) would still find
	// the entry and publish the post the user just removed.
	setEntries(snapshot.entries.filter((candidate) => candidate.id !== id))
	const removal = await removeOutboxEntryIfIdle(id)
	if (removal.status === 'sending') {
		setEntries([...snapshot.entries.filter((candidate) => candidate.id !== id), removal.entry])
		scheduleSendingReconciliation(id)
		return 'sending'
	}
	if (removal.status === 'unavailable') {
		// The durable copy still exists and can return after a reload. Put it back in
		// the visible snapshot and make the caller report that removal did not happen.
		setEntries([...snapshot.entries.filter((candidate) => candidate.id !== id), entry])
		return 'failed'
	}
	return 'removed'
}

export const handleOutboxOnline = async () => {
	resetBackoff()
	if (!dependencies) return
	await flushOutbox()
}

export const __resetOutboxForTests = () => {
	resetBackoff()
	for (const id of sendingReconcileTimers.keys()) clearSendingReconcileTimer(id)
	snapshot = { entries: [], flushing: false, syncMode: 'auto' }
	dependencies = null
	flushLocked = false
	pendingFlush = null
	listeners.clear()
}
