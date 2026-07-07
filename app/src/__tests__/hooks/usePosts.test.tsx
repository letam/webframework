import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/sonner'
import { usePosts } from '@/hooks/usePosts'
import * as postsApi from '@/lib/api/posts'
import type { PostsPage } from '@/lib/api/posts'
import { makeAuthor, makePost, makePostsPage, s3AudioPost, textOnlyPost } from '../data/mockPosts'

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	getPost: vi.fn(),
	createPost: vi.fn(),
	deletePost: vi.fn(),
	updatePost: vi.fn(),
	likePost: vi.fn(),
	unlikePost: vi.fn(),
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

const infiniteData = (posts: PostsPage['posts'], next: string | null = null): InfiniteData<PostsPage> => ({
	pages: [makePostsPage(posts, next)],
	pageParams: [null],
})

const getCachedPosts = (queryClient: QueryClient, queryKey: readonly unknown[]) =>
	queryClient
		.getQueryData<InfiniteData<PostsPage>>(queryKey)
		?.pages.flatMap((page) => page.posts) ?? []

describe('usePosts hook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('loads the first page and appends the next page', async () => {
		const queryClient = createQueryClient()
		const next = 'https://api.example.com/api/posts/?cursor=next'
		vi.mocked(postsApi.getPosts)
			.mockResolvedValueOnce(makePostsPage([textOnlyPost], next))
			.mockResolvedValueOnce(makePostsPage([s3AudioPost], null))

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.posts).toEqual([textOnlyPost]))

		await act(async () => {
			await result.current.fetchNextPage()
		})

		await waitFor(() => expect(result.current.posts.map((post) => post.id)).toEqual([1, 2]))
		expect(postsApi.getPosts).toHaveBeenNthCalledWith(1, {}, null)
		expect(postsApi.getPosts).toHaveBeenNthCalledWith(2, {}, next)
	})

	it('prepends a created post to the feed cache', async () => {
		const queryClient = createQueryClient()
		const newPost = makePost({ id: 4, head: 'Fresh post' })
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(makePostsPage([textOnlyPost], null))
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(newPost)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.posts).toEqual([textOnlyPost]))

		await act(async () => {
			await result.current.addPost({ text: 'Fresh post' })
		})

		await waitFor(() => {
			expect(result.current.posts.map((post) => post.id)).toEqual([4, 1])
		})
	})

	it('rolls back an optimistic like when the API rejects', async () => {
		const queryClient = createQueryClient()
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		const post = makePost({ id: 5, liked: false, like_count: 2 })
		let rejectLike: (error: Error) => void = () => {}
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(makePostsPage([post], null))
		vi.mocked(postsApi.likePost).mockImplementationOnce(
			() =>
				new Promise((_, reject) => {
					rejectLike = reject
				})
		)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.posts).toEqual([post]))

		act(() => {
			result.current.toggleLike(post.id)
		})

		await waitFor(() => {
			expect(result.current.posts[0]).toMatchObject({ liked: true, like_count: 3 })
		})

		await act(async () => {
			rejectLike(new Error('like failed'))
		})

		await waitFor(() => {
			expect(result.current.posts[0]).toMatchObject({ liked: false, like_count: 2 })
		})
		expect(toast.error).toHaveBeenCalledWith('Failed to update like')
		consoleError.mockRestore()
	})

	it('reconciles optimistic like state with the server response', async () => {
		const queryClient = createQueryClient()
		const post = makePost({ id: 6, liked: false, like_count: 2 })
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(makePostsPage([post], null))
		vi.mocked(postsApi.likePost).mockResolvedValueOnce({ liked: true, like_count: 10 })

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(queryClient),
		})

		await waitFor(() => expect(result.current.posts).toEqual([post]))

		act(() => {
			result.current.toggleLike(post.id)
		})

		await waitFor(() => {
			expect(result.current.posts[0]).toMatchObject({ liked: true, like_count: 10 })
		})
	})

	it('drops an unliked post from liked-scoped caches', async () => {
		const queryClient = createQueryClient()
		const post = makePost({ id: 9, liked: true, like_count: 3 })
		queryClient.setQueryData(['posts', {}], infiniteData([post]))
		queryClient.setQueryData(['posts', { liked: true }], infiniteData([post]))
		vi.mocked(postsApi.unlikePost).mockResolvedValueOnce({ liked: false, like_count: 2 })

		const { result } = renderHook(() => usePosts({}, { enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		act(() => {
			result.current.toggleLike(post.id)
		})

		await waitFor(() => {
			expect(getCachedPosts(queryClient, ['posts', { liked: true }])).toEqual([])
		})
		expect(getCachedPosts(queryClient, ['posts', {}])[0]).toMatchObject({
			liked: false,
			like_count: 2,
		})
	})

	it('removes posts across author-scoped caches', async () => {
		const queryClient = createQueryClient()
		const author = makeAuthor({ id: 42, username: 'scoped' })
		const scopedPost = makePost({ id: 7, author })
		const otherPost = makePost({ id: 8, author: makeAuthor({ id: 99 }) })
		queryClient.setQueryData(['posts', {}], infiniteData([scopedPost, otherPost]))
		queryClient.setQueryData(['posts', { author: 42 }], infiniteData([scopedPost]))
		vi.mocked(postsApi.deletePost).mockResolvedValueOnce(undefined)

		const { result } = renderHook(() => usePosts({}, { enabled: false }), {
			wrapper: createWrapper(queryClient),
		})

		await act(async () => {
			await result.current.removePost(scopedPost.id)
		})

		expect(getCachedPosts(queryClient, ['posts', {}]).map((post) => post.id)).toEqual([8])
		expect(getCachedPosts(queryClient, ['posts', { author: 42 }])).toEqual([])
	})
})
