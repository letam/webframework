import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePosts } from '@/hooks/usePosts'
import { mockPosts } from '@/__tests__/data/mockPosts'
import * as postsApi from '@/lib/api/posts'

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
	createPost: vi.fn(),
}))

describe('usePosts hook', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('should fetch posts on mount', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)

		const { result } = renderHook(() => usePosts())

		expect(result.current.isLoading).toBe(true)
		expect(result.current.error).toBeNull()

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		expect(result.current.isLoading).toBe(false)
		expect(result.current.error).toBeNull()
		expect(result.current.posts).toEqual(mockPosts)
		expect(postsApi.getPosts).toHaveBeenCalledTimes(1)
	})

	it('should handle fetch error', async () => {
		const error = new Error('Failed to fetch posts')
		vi.mocked(postsApi.getPosts).mockRejectedValueOnce(error)

		const { result } = renderHook(() => usePosts())

		expect(result.current.isLoading).toBe(true)

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		expect(result.current.isLoading).toBe(false)
		expect(result.current.error).toEqual(error)
		expect(result.current.posts).toHaveLength(0)
	})

	it('should add a new post', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		const newPost = {
			text: 'New test post',
			mediaType: 'video' as const,
			mediaUrl: 'https://example.com/video.mp4',
		}
		const createdPost = {
			...newPost,
			id: '4',
			timestamp: new Date(),
			username: 'testuser',
			userAvatar: 'https://example.com/avatar.jpg',
			likes: 0,
		}
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(createdPost)

		const { result } = renderHook(() => usePosts())

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		await act(async () => {
			await result.current.addPost(newPost)
		})

		expect(result.current.posts).toHaveLength(4)
		expect(result.current.posts[0]).toEqual(createdPost)
		expect(postsApi.createPost).toHaveBeenCalledWith(newPost)
	})

	it('should handle post creation error', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		const error = new Error('Failed to create post')
		vi.mocked(postsApi.createPost).mockRejectedValueOnce(error)

		const { result } = renderHook(() => usePosts())

		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})

		await expect(
			act(async () => {
				await result.current.addPost({ text: 'Test post' })
			})
		).rejects.toThrow('Failed to create post')

		expect(result.current.posts).toEqual(mockPosts)
	})
})
