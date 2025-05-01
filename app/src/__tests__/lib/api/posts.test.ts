import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPosts, createPost } from '@/lib/api/posts'
import { mockPosts } from '@/__tests__/data/mockPosts'

// Mock fetch
global.fetch = vi.fn()

describe('posts API', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe('getPosts', () => {
		it('should fetch and return posts successfully', async () => {
			const mockResponse = {
				posts: mockPosts.map((post) => ({
					...post,
					timestamp: post.timestamp.toISOString(),
				})),
			}

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response)

			const result = await getPosts()

			expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/posts')
			expect(result).toHaveLength(3)
			expect(result[0].id).toBe('1')
			expect(result[0].timestamp).toBeInstanceOf(Date)
		})

		it('should throw an error when fetch fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 500,
			} as Response)

			await expect(getPosts()).rejects.toThrow('Failed to fetch posts')
		})
	})

	describe('createPost', () => {
		it('should create a new post successfully', async () => {
			const newPost = {
				text: 'New test post',
				mediaType: 'video' as const,
				mediaUrl: 'https://example.com/video.mp4',
			}

			const mockResponse = {
				...newPost,
				id: '4',
				timestamp: new Date().toISOString(),
				username: 'testuser',
				userAvatar: 'https://example.com/avatar.jpg',
				likes: 0,
			}

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response)

			const result = await createPost(newPost)

			expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/posts', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(newPost),
			})
			expect(result.id).toBe('4')
			expect(result.timestamp).toBeInstanceOf(Date)
		})

		it('should throw an error when post creation fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 400,
			} as Response)

			await expect(createPost({ text: 'Test post' })).rejects.toThrow('Failed to create post')
		})
	})
})
