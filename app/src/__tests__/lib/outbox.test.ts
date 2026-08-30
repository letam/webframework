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
	getOutboxSnapshot,
	handleOutboxOnline,
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
import { makePost, makePostsPage, textOnlyPost } from '@/__tests__/data/mockPosts'
import { clearCsrfTokenCache } from '@/lib/utils/fetch'

const storedEntries = vi.hoisted(() => new Map<string, OutboxEntry>())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/lib/utils/outboxDb', () => ({
	loadOutboxEntries: vi.fn(async () => [...storedEntries.values()]),
	saveOutboxEntry: vi.fn(async (entry: OutboxEntry) => {
		storedEntries.set(entry.id, entry)
		return true
	}),
	deleteOutboxEntry: vi.fn(async (id: string) => {
		storedEntries.delete(id)
		return true
	}),
}))

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	getPost: vi.fn(),
	createPost: vi.fn(),
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

	it('uses the resolved setting for the module snapshot', async () => {
		localStorage.setItem('app-settings', JSON.stringify({ postSyncDefault: 'local' }))
		localStorage.setItem('post-sync-mode', 'auto')
		vi.resetModules()

		const freshOutbox = await import('@/lib/outbox')

		expect(freshOutbox.getOutboxSnapshot().syncMode).toBe('local')
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
				is_draft: false,
				link_previews_enabled: true,
			})
		)
	})

	it('keeps a published entry cleanup-only when its storage deletion fails', async () => {
		const created = makePost({ id: 107, body: 'Published words' })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(created)
		await enqueueText({ text: 'Published words' })
		const [entry] = getOutboxSnapshot().entries
		vi.mocked(outboxDb.deleteOutboxEntry).mockResolvedValueOnce(false)
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

	it('clears manual ids latched during an aborted auth verification', async () => {
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

	it('hides a removed entry before its storage deletion resolves', async () => {
		await enqueueText()
		const entryId = getOutboxSnapshot().entries[0].id
		let releaseDelete!: (deleted: boolean) => void
		vi.mocked(outboxDb.deleteOutboxEntry).mockImplementationOnce(
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

		releaseDelete(true)
		await expect(removal).resolves.toBe('removed')
	})

	it('restores a removed entry when its storage deletion fails', async () => {
		await enqueueText({ text: 'Keep me visible' })
		const entry = getOutboxSnapshot().entries[0]
		vi.mocked(outboxDb.deleteOutboxEntry).mockResolvedValueOnce(false)

		await expect(removeEntry(entry.id)).resolves.toBe('failed')

		expect(getOutboxSnapshot().entries).toEqual([entry])
		expect(storedEntries.has(entry.id)).toBe(true)
	})

	it('starts auto-transcription after an authenticated audio entry syncs', async () => {
		localStorage.setItem('app-settings', JSON.stringify({ autoTranscribe: true }))
		await enqueueText({
			autoTranscribe: true,
			mediaType: 'audio',
			media: new Blob(['audio'], { type: 'audio/webm' }),
			mediaName: 'queued.webm',
		})
		const created = makePost({ id: 96 })
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(created)
		vi.mocked(postsApi.transcribePost).mockResolvedValueOnce(created)
		setOnline(true)

		await flushOutbox()

		expect(postsApi.transcribePost).toHaveBeenCalledOnce()
		expect(postsApi.transcribePost).toHaveBeenCalledWith(96)
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
