import { QueryClient, type InfiniteData } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import * as postsApi from '@/lib/api/posts'
import {
	__resetOutboxForTests,
	configureOutbox,
	enqueuePost,
	flushEntry,
	flushOutbox,
	getEffectiveSyncMode,
	getOutboxSnapshot,
	handleOutboxOnline,
	loadOutbox,
	removeEntry,
	resolveInitialSyncMode,
	retryEntry,
	setSyncMode,
	subscribeOutbox,
	type OutboxAuthState,
} from '@/lib/outbox'
import type { PostsPage } from '@/lib/api/posts'
import * as outboxDb from '@/lib/utils/outboxDb'
import type { OutboxEntry } from '@/lib/utils/outboxDb'
import { makeMedia, makePost, makePostsPage, textOnlyPost } from '@/__tests__/data/mockPosts'
import { clearCsrfTokenCache } from '@/lib/utils/fetch'

const storedEntries = vi.hoisted(() => new Map<string, OutboxEntry>())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/lib/utils/outboxDb', () => ({
	OUTBOX_CLAIM_LEASE_MS: 300_000,
	loadOutboxEntries: vi.fn(async () => ({
		status: 'loaded' as const,
		entries: [...storedEntries.values()],
	})),
	saveOutboxEntry: vi.fn(async (entry: OutboxEntry) => {
		storedEntries.set(entry.id, entry)
		return true
	}),
	claimOutboxEntryForSend: vi.fn(async (id: string, owner: string) => {
		const entry = storedEntries.get(id)
		if (!entry) return { status: 'missing' as const }
		if (entry.status !== 'queued') return { status: 'not-queued' as const, entry }
		const claimed = {
			...entry,
			status: 'sending' as const,
			lastError: null,
			claimOwner: owner,
			claimExpiresAt: Date.now() + 300_000,
		}
		storedEntries.set(id, claimed)
		return { status: 'claimed' as const, entry: claimed }
	}),
	deleteOwnedOutboxEntryClaim: vi.fn(async (id: string, owner: string) => {
		const entry = storedEntries.get(id)
		if (!entry) return { status: 'missing' as const }
		if (entry.status !== 'sending' || entry.claimOwner !== owner) {
			return { status: 'lost' as const, entry }
		}
		storedEntries.delete(id)
		return { status: 'removed' as const }
	}),
	updateOwnedOutboxEntryClaim: vi.fn(
		async (id: string, owner: string, changes: Partial<OutboxEntry>) => {
			const entry = storedEntries.get(id)
			if (!entry) return { status: 'missing' as const }
			if (entry.status !== 'sending' || entry.claimOwner !== owner) {
				return { status: 'lost' as const, entry }
			}
			const updated = {
				...entry,
				...changes,
				...(changes.status && changes.status !== 'sending'
					? { claimOwner: null, claimExpiresAt: null }
					: {}),
			}
			storedEntries.set(id, updated)
			return { status: 'updated' as const, entry: updated }
		}
	),
	inspectOutboxEntry: vi.fn(async (id: string) => {
		const entry = storedEntries.get(id)
		return entry ? { status: 'found' as const, entry } : { status: 'missing' as const }
	}),
	removeOutboxEntryIfIdle: vi.fn(async (id: string) => {
		const entry = storedEntries.get(id)
		if (!entry) return { status: 'missing' as const }
		if (entry.status === 'sending') return { status: 'sending' as const, entry }
		storedEntries.delete(id)
		return { status: 'removed' as const }
	}),
	renewOutboxEntryClaim: vi.fn(async () => true),
	resetFailedOutboxEntryForRetry: vi.fn(async (id: string) => {
		const entry = storedEntries.get(id)
		if (!entry) return { status: 'missing' as const }
		if (entry.status !== 'failed') return { status: 'conflict' as const, entry }
		const reset = {
			...entry,
			status: 'queued' as const,
			attempts: 0,
			lastError: null,
			claimOwner: null,
			claimExpiresAt: null,
		}
		storedEntries.set(id, reset)
		return { status: 'reset' as const, entry: reset }
	}),
}))

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	getPost: vi.fn(),
	createPost: vi.fn(),
	findPostByClientUuid: vi.fn(),
	deletePost: vi.fn(),
	updatePost: vi.fn(),
	publishPost: vi.fn(),
	regenerateShareToken: vi.fn(),
	likePost: vi.fn(),
	unlikePost: vi.fn(),
	pinPost: vi.fn(),
	unpinPost: vi.fn(),
	transcribePost: vi.fn(),
}))

vi.mock('@/lib/utils/fetch', () => ({
	clearCsrfTokenCache: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({ toast: mockToast }))

const infiniteData = (posts: PostsPage['posts']): InfiniteData<PostsPage> => ({
	pages: [makePostsPage(posts)],
	pageParams: [null],
})

const setOnline = (online: boolean) => {
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
}

const enqueueText = (overrides: Partial<Parameters<typeof enqueuePost>[0]> = {}) =>
	enqueuePost({
		author: 1,
		text: 'Queued words',
		visibility: 'public',
		isDraft: false,
		linkPreviewsEnabled: true,
		autoTranscribe: false,
		mediaType: null,
		media: null,
		mediaName: null,
		...overrides,
	})

describe('outbox sync mode initialization', () => {
	afterEach(() => {
		localStorage.removeItem('app-settings')
		localStorage.removeItem('post-sync-mode')
		vi.restoreAllMocks()
	})

	it.each([
		['auto', 'auto', 'local'],
		['local', 'local', 'auto'],
	] as const)('resolves the %s setting as %s regardless of stored %s history', (setting, expected, stored) => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: setting }))
		localStorage.setItem('post-sync-mode', stored)

		expect(resolveInitialSyncMode()).toBe(expected)
	})

	it('resolves remember to local when the stored history is local', () => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: 'remember' }))
		localStorage.setItem('post-sync-mode', 'local')

		expect(resolveInitialSyncMode()).toBe('local')
	})

	it('honors stored history with no stored settings (the remember default)', () => {
		localStorage.setItem('post-sync-mode', 'local')

		expect(resolveInitialSyncMode()).toBe('local')
	})

	it('resolves remember to auto when stored history is absent', () => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: 'remember' }))

		expect(resolveInitialSyncMode()).toBe('auto')
	})

	it('resolves remember to auto when stored history is unexpected', () => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: 'remember' }))
		localStorage.setItem('post-sync-mode', 'unexpected')

		expect(resolveInitialSyncMode()).toBe('auto')
	})

	it('never persists stored history while resolving', () => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: 'remember' }))
		localStorage.setItem('post-sync-mode', 'local')
		const storageWrite = vi.spyOn(Storage.prototype, 'setItem')

		expect(resolveInitialSyncMode()).toBe('local')
		expect(storageWrite).not.toHaveBeenCalled()
	})

	it.each([
		['local', 'auto'],
		['auto', 'local'],
	] as const)('uses and persists the resolved %s setting over stale %s history', async (setting, staleMode) => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: setting }))
		localStorage.setItem('post-sync-mode', staleMode)
		vi.resetModules()

		const freshOutbox = await import('@/lib/outbox')

		expect(freshOutbox.getOutboxSnapshot().syncMode).toBe(setting)
		expect(localStorage.getItem('post-sync-mode')).toBe(setting)
		freshOutbox.__resetOutboxForTests()
	})

	it('falls back to auto when stored history cannot be read', () => {
		const storedSettings = JSON.stringify({ postSyncDefault: 'remember' })
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
			if (key === 'post-sync-mode') throw new Error('blocked')
			return key === 'app-settings' ? storedSettings : null
		})

		expect(resolveInitialSyncMode()).toBe('auto')
	})
})

describe('outbox sync engine', () => {
	let queryClient: QueryClient
	let auth: OutboxAuthState

	beforeEach(() => {
		vi.clearAllMocks()
		localStorage.removeItem('post-sync-mode')
		storedEntries.clear()
		__resetOutboxForTests()
		setOnline(false)
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		})
		auth = { isAuthenticated: true, userId: 1, isAuthResolved: true }
		configureOutbox({
			queryClient,
			getAuthState: () => auth,
			refreshAuthStatus: vi.fn(async () => true),
		})
	})

	afterEach(() => {
		__resetOutboxForTests()
		localStorage.removeItem('post-sync-mode')
		setOnline(true)
		vi.useRealTimers()
	})

	it('persists mode changes and publishes a reactive snapshot', () => {
		const initial = getOutboxSnapshot()
		const listener = vi.fn()
		const unsubscribe = subscribeOutbox(listener)

		setSyncMode('local')

		expect(getOutboxSnapshot()).not.toBe(initial)
		expect(getOutboxSnapshot().syncMode).toBe('local')
		expect(localStorage.getItem('post-sync-mode')).toBe('local')
		expect(listener).toHaveBeenCalledTimes(1)

		setSyncMode('local')
		expect(listener).toHaveBeenCalledTimes(1)
		unsubscribe()
	})

	it('keeps an in-memory local choice authoritative when persistence fails', async () => {
		localStorage.setItem('post-sync-mode', 'auto')
		const storageWrite = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('quota exceeded')
		})

		try {
			setSyncMode('local')
			expect(getOutboxSnapshot().syncMode).toBe('local')
			expect(getEffectiveSyncMode()).toBe('local')

			await enqueueText({ text: 'Keep local after storage failure' })
			setOnline(true)
			await flushOutbox()

			expect(postsApi.createPost).not.toHaveBeenCalled()
			expect(getOutboxSnapshot().entries).toHaveLength(1)
		} finally {
			storageWrite.mockRestore()
		}
	})

	it('resets tests to auto without reading storage', () => {
		setSyncMode('local')
		const storageRead = vi.spyOn(Storage.prototype, 'getItem')

		__resetOutboxForTests()

		expect(getOutboxSnapshot().syncMode).toBe('auto')
		expect(storageRead).not.toHaveBeenCalled()
	})

	it('suppresses automatic passes and backoff while local', async () => {
		vi.useFakeTimers()
		setSyncMode('local')
		setOnline(true)
		vi.mocked(postsApi.createPost).mockRejectedValue(new TypeError('offline'))

		await enqueueText()
		await Promise.resolve()
		expect(postsApi.createPost).not.toHaveBeenCalled()

		await flushOutbox()
		expect(postsApi.createPost).not.toHaveBeenCalled()

		await flushOutbox({ manual: true })
		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		await vi.advanceTimersByTimeAsync(300_000)
		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
	})

	it('honors local mode selected in another tab before an automatic flush', async () => {
		await enqueueText({ text: 'Keep cross-tab local' })
		localStorage.setItem('post-sync-mode', 'local')
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().syncMode).toBe('local')
		expect(getOutboxSnapshot().entries).toHaveLength(1)
	})

	it('honors auto mode selected in another tab', async () => {
		setSyncMode('local')
		await enqueueText({ text: 'Resume cross-tab auto' })
		localStorage.setItem('post-sync-mode', 'auto')
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 114 }))
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().syncMode).toBe('auto')
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('manually posts all queued entries while local', async () => {
		setSyncMode('local')
		await enqueueText({ text: 'First local post' })
		await enqueueText({ text: 'Second local post' })
		vi.mocked(postsApi.createPost)
			.mockResolvedValueOnce(makePost({ id: 101 }))
			.mockResolvedValueOnce(makePost({ id: 102 }))
		setOnline(true)

		await flushOutbox({ manual: true })

		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('stops an automatic pass at the next entry after switching to local mode', async () => {
		await enqueueText({ text: 'First automatic post' })
		await enqueueText({ text: 'Second automatic post' })
		let releaseFirst!: (post: Awaited<ReturnType<typeof postsApi.createPost>>) => void
		vi.mocked(postsApi.createPost)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve
					})
			)
			.mockResolvedValueOnce(makePost({ id: 106 }))
		setOnline(true)

		const automaticPass = flushOutbox()
		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledTimes(1))
		setSyncMode('local')
		releaseFirst(makePost({ id: 105 }))
		await automaticPass

		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		expect(getOutboxSnapshot().entries.map((entry) => entry.text)).toEqual([
			'Second automatic post',
		])

		await flushOutbox({ manual: true })

		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('stops a batch when another tab switches to local mode', async () => {
		await enqueueText({ text: 'First cross-tab post' })
		await enqueueText({ text: 'Second cross-tab post' })
		let releaseFirst!: (post: Awaited<ReturnType<typeof postsApi.createPost>>) => void
		vi.mocked(postsApi.createPost).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseFirst = resolve
				})
		)
		setOnline(true)

		const automaticPass = flushOutbox()
		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledOnce())
		localStorage.setItem('post-sync-mode', 'local')
		releaseFirst(makePost({ id: 115 }))
		await automaticPass

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().syncMode).toBe('local')
		expect(getOutboxSnapshot().entries.map((entry) => entry.text)).toEqual([
			'Second cross-tab post',
		])
	})

	it('stops an automatic send when another tab selects local during auth refresh', async () => {
		await enqueueText({ text: 'Hold after auth refresh' })
		let releaseRefresh!: (verified: boolean) => void
		const refreshAuthStatus = vi.fn(
			() =>
				new Promise<boolean>((resolve) => {
					releaseRefresh = resolve
				})
		)
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		setOnline(true)

		const automaticPass = flushOutbox()
		await vi.waitFor(() => expect(refreshAuthStatus).toHaveBeenCalledOnce())
		localStorage.setItem('post-sync-mode', 'local')
		releaseRefresh(true)
		await automaticPass

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().syncMode).toBe('local')
		expect(getOutboxSnapshot().entries).toEqual([
			expect.objectContaining({ text: 'Hold after auth refresh', status: 'queued' }),
		])
	})

	it('manually posts one queued entry while local', async () => {
		setSyncMode('local')
		await enqueueText()
		const entryId = getOutboxSnapshot().entries[0].id
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 103 }))
		setOnline(true)

		await flushEntry(entryId)

		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('flushes automatically when local mode switches back to auto', async () => {
		setSyncMode('local')
		setOnline(true)
		await enqueueText()
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 104 }))

		setSyncMode('auto')

		await vi.waitFor(() => expect(getOutboxSnapshot().entries).toEqual([]))
		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
	})

	it('reloads durable entries from another tab before enabling auto-sync', async () => {
		setSyncMode('local')
		await enqueueText({ text: 'Queued in another tab' })
		const durableEntry = getOutboxSnapshot().entries[0]

		// Keep the shared IndexedDB row while simulating a second tab whose module
		// snapshot completed its initial load before that row existed.
		__resetOutboxForTests()
		configureOutbox({
			queryClient,
			getAuthState: () => auth,
			refreshAuthStatus: vi.fn(async () => true),
		})
		setSyncMode('local')
		expect(getOutboxSnapshot().entries).toEqual([])
		expect(storedEntries.get(durableEntry.id)).toEqual(durableEntry)
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 118 }))
		setOnline(true)

		setSyncMode('auto')

		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledOnce())
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('shows the pinned error when a manual pass cannot verify auth', async () => {
		setSyncMode('local')
		auth = { isAuthenticated: false, userId: null, isAuthResolved: false }
		configureOutbox({
			queryClient,
			getAuthState: () => auth,
			refreshAuthStatus: vi.fn(async () => false),
		})
		await enqueueText({ author: 'unknown' })
		setOnline(true)

		await flushOutbox({ manual: true })

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(mockToast.error).toHaveBeenCalledWith(
			"Couldn't reach the server — your posts are still on this device."
		)
	})

	it('removes a successful entry and prepends the server post to matching caches', async () => {
		queryClient.setQueryData(['posts', {}], infiniteData([textOnlyPost]))
		const created = makePost({ id: 50, body: 'Queued words' })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(created)
		await enqueueText()
		const [entry] = getOutboxSnapshot().entries
		setOnline(true)

		await flushOutbox()

		expect(getOutboxSnapshot().entries).toEqual([])
		expect(storedEntries.size).toBe(0)
		expect(
			queryClient
				.getQueryData<InfiniteData<PostsPage>>(['posts', {}])
				?.pages.flatMap((page) => page.posts)
				.map((post) => post.id)
		).toEqual([50, 1])
		expect(mockToast).toHaveBeenCalledWith('Synced 1 queued post.')
		expect(postsApi.createPost).toHaveBeenCalledWith(
			expect.objectContaining({
				client_uuid: entry.id,
				expected_author: 1,
				is_draft: false,
				link_previews_enabled: true,
			})
		)
	})

	it('does not delete or overwrite a claim acquired by another tab mid-request', async () => {
		await enqueueText({ text: 'Original owner request' })
		const entryId = getOutboxSnapshot().entries[0].id
		let newerClaim!: OutboxEntry
		vi.mocked(postsApi.createPost).mockImplementationOnce(async () => {
			newerClaim = {
				...(storedEntries.get(entryId) as OutboxEntry),
				claimOwner: 'newer-tab',
				claimExpiresAt: Date.now() + 300_000,
			}
			storedEntries.set(entryId, newerClaim)
			return makePost({ id: 112 })
		})
		setOnline(true)

		await flushOutbox()

		expect(storedEntries.get(entryId)).toEqual(newerClaim)
		expect(getOutboxSnapshot().entries).toEqual([newerClaim])
	})

	it('does not write a failure over a claim acquired by another tab', async () => {
		await enqueueText({ text: 'Original owner failure' })
		const entryId = getOutboxSnapshot().entries[0].id
		let newerClaim!: OutboxEntry
		vi.mocked(postsApi.createPost).mockImplementationOnce(async () => {
			newerClaim = {
				...(storedEntries.get(entryId) as OutboxEntry),
				claimOwner: 'newer-tab',
				claimExpiresAt: Date.now() + 300_000,
			}
			storedEntries.set(entryId, newerClaim)
			throw new ApiError('rejected', 400)
		})
		setOnline(true)

		await flushOutbox()

		expect(storedEntries.get(entryId)).toEqual(newerClaim)
		expect(getOutboxSnapshot().entries).toEqual([newerClaim])
	})

	it('keeps a published entry cleanup-only when its storage deletion fails', async () => {
		const created = makePost({ id: 107, body: 'Published words' })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(created)
		await enqueueText({ text: 'Published words' })
		const [entry] = getOutboxSnapshot().entries
		vi.mocked(outboxDb.deleteOwnedOutboxEntryClaim).mockResolvedValueOnce({
			status: 'unavailable',
		})
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([
			expect.objectContaining({
				id: entry.id,
				status: 'published',
				lastError: "This post was published, but its local copy couldn't be cleared.",
			}),
		])
		expect(storedEntries.get(entry.id)).toMatchObject({ status: 'published' })

		await flushOutbox()
		expect(postsApi.createPost).toHaveBeenCalledOnce()
	})

	it('returns false without publishing an entry when device storage fails', async () => {
		vi.mocked(outboxDb.saveOutboxEntry).mockResolvedValueOnce(false)

		expect(await enqueueText()).toBe(false)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('retries without posting when the durable send claim initially fails', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Keep the durable queue authoritative' })
		const queued = getOutboxSnapshot().entries[0]
		vi.mocked(outboxDb.claimOutboxEntryForSend).mockResolvedValueOnce({
			status: 'unavailable',
		})
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries).toEqual([queued])
		expect(storedEntries.get(queued.id)).toEqual(queued)

		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 113 }))
		await vi.advanceTimersByTimeAsync(15_000)

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('reports a durable claim failure during a manual local send', async () => {
		setSyncMode('local')
		await enqueueText({ text: 'Keep the manual post queued' })
		const queued = getOutboxSnapshot().entries[0]
		vi.mocked(outboxDb.claimOutboxEntryForSend).mockResolvedValueOnce({
			status: 'unavailable',
		})
		setOnline(true)

		await flushOutbox({ manual: true })

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries).toEqual([queued])
		expect(mockToast.error).toHaveBeenCalledWith(
			"Couldn't access a queued post on this device. Try again."
		)
	})

	it('recovers to an actionable failure when a post status write fails', async () => {
		await enqueueText({ text: 'Status write can fail' })
		const entryId = getOutboxSnapshot().entries[0].id
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('rejected', 400))
		vi.mocked(outboxDb.updateOwnedOutboxEntryClaim).mockResolvedValueOnce({
			status: 'unavailable',
		})
		setOnline(true)

		await flushOutbox()

		expect(getOutboxSnapshot().entries[0]).toMatchObject({
			id: entryId,
			status: 'failed',
			lastError: "Couldn't save this post's status. Try again.",
		})
		expect(storedEntries.get(entryId)?.status).toBe('sending')
	})

	it('does not post an entry removed from durable storage by another tab', async () => {
		await enqueueText({ text: 'Removed elsewhere' })
		const entryId = getOutboxSnapshot().entries[0].id
		storedEntries.delete(entryId)
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('returns a network failure to queued and aborts the FIFO pass', async () => {
		await enqueueText({ text: 'First' })
		await enqueueText({ text: 'Second' })
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new TypeError('offline'))
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		expect(getOutboxSnapshot().entries.map((entry) => entry.status)).toEqual(['queued', 'queued'])
		expect(getOutboxSnapshot().entries[0].attempts).toBe(0)
	})

	it('keeps retrying other queued entries after a manual single-entry success', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Send this one now' })
		await enqueueText({ text: 'Keep this retry scheduled' })
		const firstId = getOutboxSnapshot().entries[0].id
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new TypeError('offline'))
		setOnline(true)
		await flushOutbox()

		vi.mocked(postsApi.createPost).mockClear()
		vi.mocked(postsApi.createPost).mockResolvedValue(makePost({ id: 116 }))
		await flushEntry(firstId)

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries.map((entry) => entry.text)).toEqual([
			'Keep this retry scheduled',
		])

		await vi.advanceTimersByTimeAsync(15_000)

		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it.each([
		[401, 'Sign in to post this.'],
		[400, 'The server rejected this post.'],
	] as const)('marks an HTTP %s response failed with pinned copy', async (status, message) => {
		await enqueueText()
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('create failed', status))
		setOnline(true)

		await flushOutbox()

		expect(getOutboxSnapshot().entries[0]).toMatchObject({
			status: 'failed',
			lastError: message,
		})
		expect(mockToast.error).toHaveBeenCalledWith(
			"A queued post couldn't be sent. It's still on this device."
		)
	})

	it('clears the CSRF cache and retries one 403 immediately', async () => {
		await enqueueText()
		vi.mocked(postsApi.createPost)
			.mockRejectedValueOnce(new ApiError('csrf', 403))
			.mockResolvedValueOnce(makePost({ id: 51 }))
		setOnline(true)

		await flushOutbox()

		expect(clearCsrfTokenCache).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('revalidates identity before retrying a CSRF failure', async () => {
		await enqueueText({ author: 1, text: 'Do not cross accounts' })
		const refreshAuthStatus = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockImplementationOnce(async () => {
				auth = { isAuthenticated: true, userId: 2, isAuthResolved: true }
				return true
			})
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('csrf', 403))
		setOnline(true)

		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(2)
		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([
			expect.objectContaining({
				author: 1,
				status: 'queued',
				claimOwner: null,
				claimExpiresAt: null,
			}),
		])
	})

	it('marks a second 403 failed after the single CSRF retry', async () => {
		await enqueueText()
		vi.mocked(postsApi.createPost).mockRejectedValue(new ApiError('csrf', 403))
		setOnline(true)

		await flushOutbox()

		expect(clearCsrfTokenCache).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries[0]).toMatchObject({
			status: 'failed',
			lastError: "Couldn't post this. Try again.",
		})
	})

	it('fails after five consecutive server errors', async () => {
		await enqueueText()
		vi.mocked(postsApi.createPost).mockRejectedValue(new ApiError('server', 503))
		setOnline(true)

		for (let attempt = 0; attempt < 5; attempt += 1) {
			await flushOutbox()
		}

		expect(postsApi.createPost).toHaveBeenCalledTimes(5)
		expect(getOutboxSnapshot().entries[0]).toMatchObject({
			status: 'failed',
			attempts: 5,
			lastError: 'The server had trouble with this post. Try again in a bit.',
		})
	})

	it('gates entries by author while allowing unknown entries to use the resolved session', async () => {
		await enqueueText({ author: 1, text: 'User one' })
		await enqueueText({ author: 'anon', text: 'Anonymous' })
		await enqueueText({ author: 'unknown', text: 'Unknown session' })
		auth = { isAuthenticated: true, userId: 2, isAuthResolved: true }
		vi.mocked(postsApi.createPost).mockResolvedValue(makePost({ id: 60 }))
		setOnline(true)

		await flushOutbox()

		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Unknown session' })
		)
		expect(getOutboxSnapshot().entries.map((entry) => entry.text)).toEqual([
			'User one',
			'Anonymous',
		])

		auth = { isAuthenticated: true, userId: 1, isAuthResolved: true }
		await flushOutbox()
		expect(getOutboxSnapshot().entries.map((entry) => entry.text)).toEqual(['Anonymous'])

		auth = { isAuthenticated: false, userId: null, isAuthResolved: true }
		await flushOutbox()
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('flushes oldest first and emits one plural batch toast', async () => {
		const now = vi.spyOn(Date, 'now')
		now.mockReturnValueOnce(10).mockReturnValueOnce(20).mockReturnValueOnce(30)
		await enqueueText({ text: 'First' })
		await enqueueText({ text: 'Second' })
		await enqueueText({ text: 'Third' })
		vi.mocked(postsApi.createPost)
			.mockResolvedValueOnce(makePost({ id: 71 }))
			.mockResolvedValueOnce(makePost({ id: 72 }))
			.mockResolvedValueOnce(makePost({ id: 73 }))
		setOnline(true)

		await flushOutbox()

		expect(vi.mocked(postsApi.createPost).mock.calls.map(([request]) => request.text)).toEqual([
			'First',
			'Second',
			'Third',
		])
		expect(mockToast).toHaveBeenCalledWith('Synced 3 queued posts.')
	})

	it('refreshes unknown auth before deciding whether an entry may flush', async () => {
		auth = { isAuthenticated: false, userId: null, isAuthResolved: false }
		const refreshAuthStatus = vi.fn(async () => {
			auth = { isAuthenticated: false, userId: null, isAuthResolved: true }
			return true
		})
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		await enqueueText({ author: 'unknown' })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 80 }))
		setOnline(true)

		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(1)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('revalidates a resolved session before an automatic flush', async () => {
		await enqueueText({ author: 1, text: 'User one private queue' })
		const refreshAuthStatus = vi.fn(async () => {
			auth = { isAuthenticated: true, userId: 2, isAuthResolved: true }
			return true
		})
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		setOnline(true)

		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledOnce()
		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries).toEqual([
			expect.objectContaining({ author: 1, text: 'User one private queue', status: 'queued' }),
		])
	})

	it('revalidates identity before every entry in a multi-post pass', async () => {
		await enqueueText({ author: 1, text: 'First user-one post' })
		await enqueueText({ author: 1, text: 'Second user-one post' })
		const refreshAuthStatus = vi
			.fn()
			.mockResolvedValueOnce(true)
			.mockImplementationOnce(async () => {
				auth = { isAuthenticated: true, userId: 2, isAuthResolved: true }
				return true
			})
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 110 }))
		setOnline(true)

		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(2)
		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([
			expect.objectContaining({ author: 1, text: 'Second user-one post', status: 'queued' }),
		])
	})

	it('resets a failed entry before retrying it manually', async () => {
		await enqueueText()
		vi.mocked(postsApi.createPost)
			.mockRejectedValueOnce(new ApiError('bad request', 400))
			.mockResolvedValueOnce(makePost({ id: 81 }))
		setOnline(true)
		await flushOutbox()

		await retryEntry(getOutboxSnapshot().entries[0].id)

		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('reports a storage failure while resetting a manual retry', async () => {
		await enqueueText({ text: 'Retry remains failed' })
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('bad request', 400))
		setOnline(true)
		await flushOutbox()
		const failed = getOutboxSnapshot().entries[0]
		mockToast.error.mockClear()
		vi.mocked(outboxDb.resetFailedOutboxEntryForRetry).mockResolvedValueOnce({
			status: 'unavailable',
		})

		await retryEntry(failed.id)

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([failed])
		expect(mockToast.error).toHaveBeenCalledWith(
			"Couldn't access a queued post on this device. Try again."
		)
	})

	it('preserves other queued backoff when a retry reset is unavailable', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Failed retry card' })
		await enqueueText({ text: 'Queued behind backoff' })
		vi.mocked(postsApi.createPost)
			.mockRejectedValueOnce(new ApiError('bad request', 400))
			.mockRejectedValueOnce(new TypeError('offline'))
		setOnline(true)
		await flushOutbox()
		const [failed, queued] = getOutboxSnapshot().entries
		expect(failed.status).toBe('failed')
		expect(queued.status).toBe('queued')
		vi.mocked(outboxDb.resetFailedOutboxEntryForRetry).mockResolvedValueOnce({
			status: 'unavailable',
		})
		vi.mocked(postsApi.createPost).mockClear()
		vi.mocked(postsApi.createPost).mockResolvedValue(makePost({ id: 117 }))

		await retryEntry(failed.id)
		await vi.advanceTimersByTimeAsync(15_000)

		expect(postsApi.createPost).toHaveBeenCalledOnce()
		expect(getOutboxSnapshot().entries).toEqual([failed])
	})

	it('does not overwrite a live claim from a stale manual retry', async () => {
		await enqueueText({ text: 'Failed in both tabs' })
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('bad request', 400))
		setOnline(true)
		await flushOutbox()
		const failed = getOutboxSnapshot().entries[0]
		const sending = {
			...failed,
			status: 'sending' as const,
			claimOwner: 'another-tab',
			claimExpiresAt: Date.now() + 300_000,
		}
		storedEntries.set(failed.id, sending)
		vi.mocked(postsApi.createPost).mockClear()

		await retryEntry(failed.id)

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(storedEntries.get(failed.id)).toEqual(sending)
		expect(getOutboxSnapshot().entries).toEqual([sending])
	})

	it('replays a manual retry that arrives while a pass is in flight', async () => {
		await enqueueText({ text: 'Failing' })
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(new ApiError('bad request', 400))
		setOnline(true)
		await flushOutbox()
		const failedId = getOutboxSnapshot().entries[0].id

		setOnline(false)
		await enqueueText({ text: 'Slow' })
		setOnline(true)
		let release!: (post: Awaited<ReturnType<typeof postsApi.createPost>>) => void
		vi.mocked(postsApi.createPost)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve
					})
			)
			.mockResolvedValueOnce(makePost({ id: 91 }))

		const pass = flushOutbox()
		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledTimes(2))
		await retryEntry(failedId)
		release(makePost({ id: 90 }))
		await pass

		expect(postsApi.createPost).toHaveBeenCalledTimes(3)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('preserves a latched manual send while local mode is active', async () => {
		setSyncMode('local')
		await enqueueText({ text: 'First local post' })
		await enqueueText({ text: 'Second local post' })
		const [firstId, secondId] = getOutboxSnapshot().entries.map((entry) => entry.id)
		let releaseFirst!: (post: Awaited<ReturnType<typeof postsApi.createPost>>) => void
		vi.mocked(postsApi.createPost)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve
					})
			)
			.mockResolvedValueOnce(makePost({ id: 109 }))
		setOnline(true)

		const firstPass = flushEntry(firstId)
		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledTimes(1))
		await flushEntry(secondId)
		releaseFirst(makePost({ id: 108 }))
		await firstPass

		expect(postsApi.createPost).toHaveBeenCalledTimes(2)
		expect(postsApi.createPost).toHaveBeenLastCalledWith(
			expect.objectContaining({ text: 'Second local post' })
		)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('schedules a backoff retry when the auth check cannot complete', async () => {
		vi.useFakeTimers()
		auth = { isAuthenticated: false, userId: null, isAuthResolved: false }
		const refreshAuthStatus = vi.fn(async () => false)
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		await enqueueText({ author: 'unknown' })
		setOnline(true)

		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries[0].status).toBe('queued')

		refreshAuthStatus.mockImplementation(async () => {
			auth = { isAuthenticated: true, userId: 1, isAuthResolved: true }
			return true
		})
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 86 }))
		await vi.advanceTimersByTimeAsync(15_000)

		expect(refreshAuthStatus).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('reports and clears manual ids latched during an aborted auth verification', async () => {
		await enqueueText({ text: 'Latched manual post' })
		await enqueueText({ text: 'Unrelated manual post' })
		const [latchedId, unrelatedId] = getOutboxSnapshot().entries.map((entry) => entry.id)
		let releaseRefresh!: (verified: boolean) => void
		const refreshAuthStatus = vi
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise<boolean>((resolve) => {
						releaseRefresh = resolve
					})
			)
			.mockResolvedValue(true)
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		setOnline(true)

		const reconnectPass = handleOutboxOnline()
		await vi.waitFor(() => expect(refreshAuthStatus).toHaveBeenCalledTimes(1))
		auth = { isAuthenticated: false, userId: null, isAuthResolved: true }
		await flushEntry(latchedId)
		releaseRefresh(false)
		await reconnectPass

		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(mockToast.error).toHaveBeenCalledWith(
			"Couldn't reach the server — your posts are still on this device."
		)
		auth = { isAuthenticated: true, userId: 1, isAuthResolved: true }
		vi.mocked(postsApi.createPost).mockResolvedValue(makePost({ id: 87 }))

		await flushEntry(unrelatedId)
		await Promise.resolve()

		expect(postsApi.createPost).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Unrelated manual post' })
		)
		expect(getOutboxSnapshot().entries.map((entry) => entry.id)).toEqual([latchedId])
	})

	it('sends nothing after a reconnect until the identity re-check succeeds', async () => {
		await enqueueText()
		const refreshAuthStatus = vi.fn(async () => false)
		configureOutbox({ queryClient, getAuthState: () => auth, refreshAuthStatus })
		setOnline(true)

		await handleOutboxOnline()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(1)
		expect(postsApi.createPost).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries[0].status).toBe('queued')

		refreshAuthStatus.mockResolvedValue(true)
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 85 }))
		await flushOutbox()

		expect(refreshAuthStatus).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('refuses to remove an entry whose send is already in flight', async () => {
		await enqueueText()
		setOnline(true)
		let release!: (post: Awaited<ReturnType<typeof postsApi.createPost>>) => void
		vi.mocked(postsApi.createPost).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve
				})
		)

		const pass = flushOutbox()
		await vi.waitFor(() => expect(getOutboxSnapshot().entries[0]?.status).toBe('sending'))

		expect(await removeEntry(getOutboxSnapshot().entries[0].id)).toBe('sending')
		expect(getOutboxSnapshot().entries).toHaveLength(1)

		release(makePost({ id: 95 }))
		await pass
		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('refuses removal when another tab has durably claimed the entry', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Claimed elsewhere' })
		const queued = getOutboxSnapshot().entries[0]
		const sending = { ...queued, status: 'sending' as const }
		storedEntries.set(queued.id, sending)

		await expect(removeEntry(queued.id)).resolves.toBe('sending')

		expect(storedEntries.get(queued.id)).toEqual(sending)
		expect(getOutboxSnapshot().entries).toEqual([sending])
	})

	it('reconciles a send completed by another tab', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Sent elsewhere' })
		const entryId = getOutboxSnapshot().entries[0].id
		storedEntries.set(entryId, {
			...getOutboxSnapshot().entries[0],
			status: 'sending',
		})
		setOnline(true)

		await flushOutbox()
		expect(getOutboxSnapshot().entries[0].status).toBe('sending')
		storedEntries.delete(entryId)
		await vi.advanceTimersByTimeAsync(1_000)

		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('resumes auto-sync when another tab leaves a queued entry', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Retry after the other tab' })
		const entryId = getOutboxSnapshot().entries[0].id
		storedEntries.set(entryId, {
			...getOutboxSnapshot().entries[0],
			status: 'sending',
		})
		setOnline(true)
		await flushOutbox()
		storedEntries.set(entryId, {
			...getOutboxSnapshot().entries[0],
			status: 'queued',
		})
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(makePost({ id: 111 }))

		await vi.advanceTimersByTimeAsync(1_000)
		await vi.waitFor(() => expect(postsApi.createPost).toHaveBeenCalledOnce())

		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('preserves and reconciles a live claim loaded from another tab', async () => {
		vi.useFakeTimers()
		await enqueueText({ text: 'Already sending elsewhere' })
		const queued = getOutboxSnapshot().entries[0]
		const sending = {
			...queued,
			status: 'sending' as const,
			claimOwner: 'another-tab',
			claimExpiresAt: Date.now() + 300_000,
		}
		__resetOutboxForTests()
		configureOutbox({
			queryClient,
			getAuthState: () => auth,
			refreshAuthStatus: vi.fn(async () => true),
		})
		storedEntries.set(queued.id, sending)

		await loadOutbox()
		expect(getOutboxSnapshot().entries).toEqual([sending])
		storedEntries.delete(queued.id)
		await vi.advanceTimersByTimeAsync(1_000)

		expect(getOutboxSnapshot().entries).toEqual([])
	})

	it('retries a transient startup storage failure and loads durable entries', async () => {
		vi.useFakeTimers()
		const durable = {
			id: crypto.randomUUID(),
			createdAt: Date.now(),
			author: 1 as const,
			status: 'queued' as const,
			attempts: 0,
			lastError: null,
			text: 'Recovered after startup',
			visibility: 'public' as const,
			isDraft: false,
			linkPreviewsEnabled: true,
			autoTranscribe: false,
			mediaType: null,
			media: null,
			mediaName: null,
		}
		vi.mocked(outboxDb.loadOutboxEntries).mockResolvedValueOnce({ status: 'unavailable' })

		await expect(loadOutbox()).resolves.toBe(false)
		expect(getOutboxSnapshot().entries).toEqual([])
		storedEntries.set(durable.id, durable)

		await vi.advanceTimersByTimeAsync(1_000)

		expect(outboxDb.loadOutboxEntries).toHaveBeenCalledTimes(2)
		expect(getOutboxSnapshot().entries).toEqual([durable])
	})

	it('hides a removed entry before its storage deletion resolves', async () => {
		await enqueueText()
		const entryId = getOutboxSnapshot().entries[0].id
		let releaseDelete!: (
			result: Awaited<ReturnType<typeof outboxDb.removeOutboxEntryIfIdle>>
		) => void
		vi.mocked(outboxDb.removeOutboxEntryIfIdle).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseDelete = resolve
				})
		)

		const removal = removeEntry(entryId)

		expect(getOutboxSnapshot().entries).toEqual([])
		setOnline(true)
		await flushOutbox()
		expect(postsApi.createPost).not.toHaveBeenCalled()

		releaseDelete({ status: 'removed' })
		await expect(removal).resolves.toBe('removed')
	})

	it('restores a removed entry when its storage deletion fails', async () => {
		await enqueueText({ text: 'Keep me visible' })
		const entry = getOutboxSnapshot().entries[0]
		vi.mocked(outboxDb.removeOutboxEntryIfIdle).mockResolvedValueOnce({
			status: 'unavailable',
		})

		await expect(removeEntry(entry.id)).resolves.toBe('failed')

		expect(getOutboxSnapshot().entries).toEqual([entry])
		expect(storedEntries.has(entry.id)).toBe(true)
	})

	it('reconciles a response-lost create before removing its durable fallback', async () => {
		await enqueueText({ text: 'May already exist', mayHavePublished: true })
		const entry = getOutboxSnapshot().entries[0]
		const published = makePost({ id: 144, body: 'May already exist' })
		vi.mocked(postsApi.findPostByClientUuid).mockResolvedValueOnce(published)
		queryClient.setQueryData(['posts', {}], infiniteData([]))
		setOnline(true)

		await expect(removeEntry(entry.id)).resolves.toBe('published')

		expect(postsApi.findPostByClientUuid).toHaveBeenCalledWith(entry.id, 1)
		expect(storedEntries.has(entry.id)).toBe(false)
		expect(
			queryClient.getQueryData<InfiniteData<PostsPage>>(['posts', {}])?.pages[0].posts[0].id
		).toBe(144)
	})

	it('retains a response-lost fallback when it cannot reconcile with the server', async () => {
		await enqueueText({ text: 'Keep the UUID', mayHavePublished: true })
		const entry = getOutboxSnapshot().entries[0]

		await expect(removeEntry(entry.id)).resolves.toBe('failed')

		expect(postsApi.findPostByClientUuid).not.toHaveBeenCalled()
		expect(getOutboxSnapshot().entries).toEqual([entry])
		expect(storedEntries.get(entry.id)).toEqual(entry)
	})

	it('starts auto-transcription after an authenticated audio entry syncs', async () => {
		localStorage.setItem('app-settings', JSON.stringify({ autoTranscribe: true }))
		await enqueueText({
			autoTranscribe: true,
			mediaType: 'audio',
			media: new Blob(['audio'], { type: 'audio/webm' }),
			mediaName: 'queued.webm',
		})
		const created = makePost({ id: 96, media: makeMedia({ transcript_status: '' }) })
		const transcriptionStarted = makePost({
			id: 96,
			media: makeMedia({ transcript_status: 'pending' }),
		})
		queryClient.setQueryData(['posts', {}], infiniteData([]))
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(created)
		vi.mocked(postsApi.transcribePost).mockResolvedValueOnce(transcriptionStarted)
		setOnline(true)

		await flushOutbox()

		expect(postsApi.transcribePost).toHaveBeenCalledOnce()
		expect(postsApi.transcribePost).toHaveBeenCalledWith(96)
		await vi.waitFor(() =>
			expect(
				queryClient.getQueryData<InfiniteData<PostsPage>>(['posts', {}])?.pages[0].posts[0].media
					?.transcript_status
			).toBe('pending')
		)
	})

	it('does not auto-transcribe text, disabled, or anonymous entries', async () => {
		vi.mocked(postsApi.createPost).mockResolvedValue(makePost({ id: 97 }))

		localStorage.setItem('app-settings', JSON.stringify({ autoTranscribe: true }))
		await enqueueText({ autoTranscribe: true })
		setOnline(true)
		await flushOutbox()

		setOnline(false)
		localStorage.setItem('app-settings', JSON.stringify({ autoTranscribe: false }))
		await enqueueText({
			autoTranscribe: false,
			mediaType: 'audio',
			media: new Blob(['audio'], { type: 'audio/webm' }),
			mediaName: 'disabled.webm',
		})
		setOnline(true)
		await flushOutbox()

		setOnline(false)
		localStorage.setItem('app-settings', JSON.stringify({ autoTranscribe: true }))
		auth = { isAuthenticated: false, userId: null, isAuthResolved: true }
		await enqueueText({
			author: 'anon',
			autoTranscribe: true,
			mediaType: 'audio',
			media: new Blob(['audio'], { type: 'audio/webm' }),
			mediaName: 'anonymous.webm',
		})
		setOnline(true)
		await flushOutbox()

		expect(postsApi.createPost).toHaveBeenCalledTimes(3)
		expect(postsApi.transcribePost).not.toHaveBeenCalled()
	})
})
