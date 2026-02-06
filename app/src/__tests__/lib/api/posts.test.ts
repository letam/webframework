import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPosts, deletePost, updatePost, transcribePost, getMediaUrl } from '@/lib/api/posts'
import type { Post } from '@/types/post'

// Mock constants
vi.mock('@/lib/constants', () => ({
	SERVER_HOST: 'http://localhost',
	SERVER_API_URL: '/api',
	UPLOAD_FILES_TO_S3: false,
}))

// Mock fetch utility
vi.mock('@/lib/utils/fetch', () => ({
	getFetchOptions: vi.fn(async (method: string, body?: unknown) => {
		const options: RequestInit = { method, headers: { 'X-CSRFToken': 'test-token' } }
		if (body && !(body instanceof FormData)) {
			;(options.headers as Record<string, string>)['Content-Type'] = 'application/json'
			options.body = JSON.stringify(body)
		} else if (body) {
			options.body = body as BodyInit
		}
		return options
	}),
}))

const mockPostData: Post[] = [
	{
		id: 1,
		url: 'http://localhost/p/1/',
		head: '',
		body: 'Test post one',
		created: new Date('2025-01-01T00:00:00Z'),
		modified: new Date('2025-01-01T00:00:00Z'),
		author: { id: 1, username: 'user1', avatar: '', first_name: 'User', last_name: 'One' },
		likes: 5,
	},
	{
		id: 2,
		url: 'http://localhost/p/2/',
		head: 'Title',
		body: 'Test post two',
		created: new Date('2025-01-02T00:00:00Z'),
		modified: new Date('2025-01-02T00:00:00Z'),
		author: { id: 2, username: 'user2', avatar: '', first_name: 'User', last_name: 'Two' },
		likes: 10,
	},
]

describe('posts API', () => {
	beforeEach(() => {
		vi.restoreAllMocks()
		global.fetch = vi.fn()
	})

	describe('getPosts', () => {
		it('should fetch and return posts with parsed dates', async () => {
			const apiResponse = mockPostData.map((post) => ({
				...post,
				created: (post.created as Date).toISOString(),
				modified: (post.modified as Date).toISOString(),
			}))

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(apiResponse),
			} as Response)

			const result = await getPosts()

			expect(fetch).toHaveBeenCalledWith('/api/posts/')
			expect(result).toHaveLength(2)
			expect(result[0].id).toBe(1)
			expect(result[0].created).toBeInstanceOf(Date)
			expect(result[0].body).toBe('Test post one')
		})

		it('should throw an error when fetch fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 500,
			} as Response)

			await expect(getPosts()).rejects.toThrow('Failed to fetch posts')
		})
	})

	describe('deletePost', () => {
		it('should delete a post successfully', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
			} as Response)

			await deletePost(1)

			expect(fetch).toHaveBeenCalledWith(
				'/api/posts/1/',
				expect.objectContaining({ method: 'DELETE' })
			)
		})

		it('should throw an error when deletion fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 403,
			} as Response)

			await expect(deletePost(1)).rejects.toThrow('Failed to delete post')
		})
	})

	describe('updatePost', () => {
		it('should update a post successfully', async () => {
			const updatedPost = {
				...mockPostData[0],
				body: 'Updated body',
				created: (mockPostData[0].created as Date).toISOString(),
				modified: new Date().toISOString(),
			}

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(updatedPost),
			} as Response)

			const result = await updatePost(1, { body: 'Updated body' })

			expect(fetch).toHaveBeenCalledWith(
				'/api/posts/1/',
				expect.objectContaining({ method: 'PATCH' })
			)
			expect(result.body).toBe('Updated body')
			expect(result.created).toBeInstanceOf(Date)
			expect(result.modified).toBeInstanceOf(Date)
		})

		it('should throw an error when update fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 400,
			} as Response)

			await expect(updatePost(1, { body: 'test' })).rejects.toThrow('Failed to update post')
		})
	})

	describe('transcribePost', () => {
		it('should transcribe a post successfully', async () => {
			const transcribedPost = {
				...mockPostData[0],
				created: (mockPostData[0].created as Date).toISOString(),
				modified: new Date().toISOString(),
				media: {
					id: 1,
					media_type: 'audio',
					file: 'posts/1/test.mp3',
					transcript: 'Hello world',
					created: new Date().toISOString(),
					modified: new Date().toISOString(),
				},
			}

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(transcribedPost),
			} as Response)

			const result = await transcribePost(1)

			expect(fetch).toHaveBeenCalledWith(
				'/api/posts/1/transcribe/',
				expect.objectContaining({ method: 'POST' })
			)
			expect(result.created).toBeInstanceOf(Date)
		})

		it('should throw an error when transcription fails', async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 500,
			} as Response)

			await expect(transcribePost(1)).rejects.toThrow('Failed to transcribe media')
		})
	})

	describe('getMediaUrl', () => {
		it('should return signed URL when available', () => {
			const post: Post = {
				...mockPostData[0],
				signedMediaUrl: 'https://s3.example.com/signed-url',
			}

			expect(getMediaUrl(post)).toBe('https://s3.example.com/signed-url')
		})

		it('should return API media URL when no signed URL', () => {
			const result = getMediaUrl(mockPostData[0])

			expect(result).toBe('/api/posts/1/media/')
		})
	})
})
