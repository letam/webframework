import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePosts } from '@/hooks/usePosts'
import { mockPosts } from '@/__tests__/data/mockPosts'
import * as postsApi from '@/lib/api/posts'
import type React from 'react'

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	createPost: vi.fn(),
	deletePost: vi.fn(),
	updatePost: vi.fn(),
}))

vi.mock('@/utils/tags', () => ({
	buildTagIndex: vi.fn(() => []),
}))

const createWrapper = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	})
	return ({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)
}

describe('usePosts hook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('should fetch posts on mount', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(),
		})

		expect(result.current.isLoading).toBe(true)

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false)
		})

		expect(result.current.error).toBeNull()
		expect(result.current.posts).toEqual(mockPosts)
		expect(postsApi.getPosts).toHaveBeenCalledTimes(1)
	})

	it('should handle fetch error', async () => {
		const error = new Error('Failed to fetch posts')
		vi.mocked(postsApi.getPosts).mockRejectedValueOnce(error)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(),
		})

		expect(result.current.isLoading).toBe(true)

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false)
		})

		expect(result.current.error).toEqual(error)
		expect(result.current.posts).toEqual([])
	})

	it('should add a new post', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		const newPost = {
			...mockPosts[0],
			id: 4,
			body: 'New test post',
		}
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(newPost)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(),
		})

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false)
		})

		await result.current.addPost({ text: 'New test post' })

		await waitFor(() => {
			expect(result.current.posts).toHaveLength(4)
		})

		expect(result.current.posts[0]).toEqual(newPost)
		expect(postsApi.createPost).toHaveBeenCalledWith({ text: 'New test post' })
	})

	it('should remove a post', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		vi.mocked(postsApi.deletePost).mockResolvedValueOnce(undefined)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(),
		})

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false)
		})

		await result.current.removePost(1)

		await waitFor(() => {
			expect(result.current.posts).toHaveLength(2)
		})

		expect(result.current.posts.find((p) => p.id === 1)).toBeUndefined()
		expect(postsApi.deletePost).toHaveBeenCalledWith(1)
	})

	it('should edit a post', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		const updatedPost = { ...mockPosts[0], body: 'Updated body' }
		vi.mocked(postsApi.updatePost).mockResolvedValueOnce(updatedPost)

		const { result } = renderHook(() => usePosts(), {
			wrapper: createWrapper(),
		})

		await waitFor(() => {
			expect(result.current.isLoading).toBe(false)
		})

		await result.current.editPost(1, { body: 'Updated body' })

		await waitFor(() => {
			expect(result.current.posts.find((p) => p.id === 1)?.body).toBe('Updated body')
		})

		expect(postsApi.updatePost).toHaveBeenCalledWith(1, { body: 'Updated body' })
	})
})
