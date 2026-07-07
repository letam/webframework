import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComments } from '@/hooks/useComments'
import * as postsApi from '@/lib/api/posts'
import type { PostsPage } from '@/lib/api/posts'
import type { Comment, Post } from '@/types/post'
import { makeAuthor, makePost, makePostsPage } from '../data/mockPosts'

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	getPost: vi.fn(),
	createPost: vi.fn(),
	deletePost: vi.fn(),
	updatePost: vi.fn(),
	likePost: vi.fn(),
	unlikePost: vi.fn(),
	getComments: vi.fn(),
	createComment: vi.fn(),
	deleteComment: vi.fn(),
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

const infiniteData = (posts: Post[]): InfiniteData<PostsPage> => ({
	pages: [makePostsPage(posts)],
	pageParams: [null],
})

const makeComment = (overrides: Partial<Comment> = {}): Comment => ({
	id: 1,
	author: makeAuthor({ id: 42, username: 'commenter' }),
	body: 'First!',
	created: new Date('2026-07-01T10:00:00.000Z'),
	...overrides,
})

const getCachedPost = (queryClient: QueryClient, postId: number) =>
	queryClient
		.getQueryData<InfiniteData<PostsPage>>(['posts', {}])
		?.pages.flatMap((page) => page.posts)
		.find((post) => post.id === postId)

describe('useComments hook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('adds a comment and bumps comment_count across post caches', async () => {
		const queryClient = createQueryClient()
		const post = makePost({ id: 11, comment_count: 1 })
		queryClient.setQueryData(['posts', {}], infiniteData([post]))
		vi.mocked(postsApi.getComments).mockResolvedValueOnce([makeComment()])
		vi.mocked(postsApi.createComment).mockResolvedValueOnce(
			makeComment({ id: 2, body: 'Second!' })
		)

		const { result } = renderHook(() => useComments(post.id), {
			wrapper: createWrapper(queryClient),
		})
		await waitFor(() => expect(result.current.comments).toHaveLength(1))

		await act(async () => {
			await result.current.addComment('Second!')
		})

		await waitFor(() => {
			expect(result.current.comments.map((comment) => comment.id)).toEqual([1, 2])
		})
		expect(getCachedPost(queryClient, post.id)?.comment_count).toBe(2)
	})

	it('removes a comment and decrements comment_count', async () => {
		const queryClient = createQueryClient()
		const post = makePost({ id: 12, comment_count: 1 })
		queryClient.setQueryData(['posts', {}], infiniteData([post]))
		vi.mocked(postsApi.getComments).mockResolvedValueOnce([makeComment()])
		vi.mocked(postsApi.deleteComment).mockResolvedValueOnce(undefined)

		const { result } = renderHook(() => useComments(post.id), {
			wrapper: createWrapper(queryClient),
		})
		await waitFor(() => expect(result.current.comments).toHaveLength(1))

		await act(async () => {
			await result.current.removeComment(1)
		})

		await waitFor(() => {
			expect(result.current.comments).toEqual([])
		})
		expect(getCachedPost(queryClient, post.id)?.comment_count).toBe(0)
	})
})
