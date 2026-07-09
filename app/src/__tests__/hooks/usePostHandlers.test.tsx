import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/sonner'
import { usePostHandlers } from '@/hooks/usePostHandlers'
import * as postsApi from '@/lib/api/posts'
import type { PostsPage } from '@/lib/api/posts'
import { makeMedia, makePost, makePostsPage } from '../data/mockPosts'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
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
	transcribePost: vi.fn(),
	getShareUrl: vi.fn((post) => post.url),
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

const createWrapper =
	(queryClient: QueryClient) =>
	({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)

const infiniteData = (posts: PostsPage['posts']): InfiniteData<PostsPage> => ({
	pages: [makePostsPage(posts)],
	pageParams: [null],
})

const getCachedPosts = (queryClient: QueryClient) =>
	queryClient
		.getQueryData<InfiniteData<PostsPage>>(['posts', {}])
		?.pages.flatMap((page) => page.posts) ?? []

const setAutoTranscribe = (autoTranscribe: boolean) => {
	localStorage.setItem(
		'app-settings',
		JSON.stringify({ normalizeAudio: false, videoQuality: 'low', autoTranscribe })
	)
}

describe('usePostHandlers auto-transcribe create flow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		localStorage.clear()
		setAutoTranscribe(true)
		mockUseAuth.mockReturnValue({ isAuthenticated: true })
	})

	it('starts transcription after creating an authenticated audio post and updates caches', async () => {
		const queryClient = createQueryClient()
		const createdMedia = makeMedia({ media_type: 'audio', transcript_status: '' })
		const createdPost = makePost({
			id: 50,
			media: createdMedia,
		})
		const pendingPost = makePost({
			...createdPost,
			media: makeMedia({ ...createdMedia, transcript_status: 'pending' }),
		})
		queryClient.setQueryData(['posts', {}], infiniteData([]))
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(createdPost)
		vi.mocked(postsApi.transcribePost).mockResolvedValueOnce(pendingPost)

		const { result } = renderHook(() => usePostHandlers({}, { enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		await act(async () => {
			await result.current.addPost({ text: 'Audio', media_type: 'audio' })
		})

		expect(postsApi.transcribePost).toHaveBeenCalledTimes(1)
		expect(postsApi.transcribePost).toHaveBeenCalledWith(50)
		expect(getCachedPosts(queryClient)[0].media?.transcript_status).toBe('pending')
	})

	it.each([
		['setting off', false, true, makePost({ media: makeMedia({ media_type: 'audio' }) })],
		['anonymous', true, false, makePost({ media: makeMedia({ media_type: 'audio' }) })],
		['text post', true, true, makePost({ media: undefined })],
		['image post', true, true, makePost({ media: makeMedia({ media_type: 'image' }) })],
	] as const)('does not start transcription for %s', async (_label, settingOn, isAuthenticated, newPost) => {
		const queryClient = createQueryClient()
		setAutoTranscribe(settingOn)
		mockUseAuth.mockReturnValue({ isAuthenticated })
		queryClient.setQueryData(['posts', {}], infiniteData([]))
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(newPost)

		const { result } = renderHook(() => usePostHandlers({}, { enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		await act(async () => {
			await result.current.addPost({ text: 'Post' })
		})

		expect(postsApi.transcribePost).not.toHaveBeenCalled()
	})

	it('toasts when auto-transcription fails but keeps the created post cached', async () => {
		const queryClient = createQueryClient()
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const createdPost = makePost({
			id: 51,
			media: makeMedia({ media_type: 'video', transcript_status: '' }),
		})
		queryClient.setQueryData(['posts', {}], infiniteData([]))
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(createdPost)
		vi.mocked(postsApi.transcribePost).mockRejectedValueOnce(new Error('transcribe failed'))

		const { result } = renderHook(() => usePostHandlers({}, { enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		await act(async () => {
			await result.current.addPost({ text: 'Video', media_type: 'video' })
		})

		expect(toast.error).toHaveBeenCalledWith('Auto-transcription failed to start')
		expect(getCachedPosts(queryClient)[0]).toEqual(createdPost)
		consoleError.mockRestore()
	})
})
