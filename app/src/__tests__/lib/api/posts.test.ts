import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localImagePost, makePost, mockPosts, s3AudioPost } from '@/__tests__/data/mockPosts'
import type { Post } from '@/types/post'

vi.mock('@/lib/utils/fetch', () => ({
	getFetchOptions: vi.fn(async (method: string, body?: BodyInit | Record<string, unknown>) => ({
		method,
		body,
		headers: { 'X-CSRFToken': 'test-token' },
	})),
}))

const fetchMock = vi.fn()

const response = (body: unknown, ok = true) =>
	Promise.resolve({
		ok,
		json: () => Promise.resolve(body),
	} as Response)

const importPostsApi = async (uploadToS3 = false) => {
	vi.resetModules()
	vi.stubEnv('VITE_UPLOAD_FILES_TO_S3', uploadToS3 ? 'true' : 'false')
	return import('@/lib/api/posts')
}

const toServerPost = (post: Post) => ({
	...post,
	created: post.created.toISOString(),
	modified: post.modified.toISOString(),
	media: post.media
		? {
				...post.media,
				created: post.media.created.toISOString(),
				modified: post.media.modified.toISOString(),
			}
		: undefined,
})

describe('posts API', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.unstubAllEnvs()
		globalThis.fetch = fetchMock
		fetchMock.mockReset()
	})

	describe('getPosts', () => {
		it('maps paginated results and does not fetch per-post signed URLs', async () => {
			const { getPosts } = await importPostsApi()
			fetchMock.mockResolvedValueOnce(
				await response({
					next: 'https://api.example.com/api/posts/?cursor=abc',
					previous: null,
					results: mockPosts.map(toServerPost),
				})
			)

			const result = await getPosts()

			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(fetchMock).toHaveBeenCalledWith('/api/posts/')
			expect(result.next).toBe('https://api.example.com/api/posts/?cursor=abc')
			expect(result.posts).toHaveLength(3)
			expect(result.posts[0].created).toBeInstanceOf(Date)
			expect(result.posts[0].modified).toBeInstanceOf(Date)
			expect(result.posts[0].url).toBe(`${window.location.origin}/p/${result.posts[0].id}/`)
			expect(result.posts[1].media?.signed_url).toBe('https://signed.example.com/s3-audio.webm')
		})

		it('adds author scope params and fetches cursor URLs verbatim', async () => {
			const { getPosts } = await importPostsApi()
			const cursor = 'https://api.example.com/api/posts/?cursor=next'
			fetchMock
				.mockResolvedValueOnce(await response({ next: cursor, previous: null, results: [] }))
				.mockResolvedValueOnce(await response({ next: null, previous: null, results: [] }))

			await getPosts({ author: 5 })
			await getPosts({ author: 5 }, cursor)

			expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/posts/?author=5')
			expect(fetchMock).toHaveBeenNthCalledWith(2, cursor)
		})

		it('throws on non-ok responses', async () => {
			const { getPosts } = await importPostsApi()
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
			fetchMock.mockResolvedValueOnce(await response({ error: 'nope' }, false))

			await expect(getPosts()).rejects.toThrow('Failed to fetch posts')
			consoleError.mockRestore()
		})
	})

	describe('createPost', () => {
		it('uploads media to S3, then creates the post with the returned file key', async () => {
			const { createPost } = await importPostsApi(true)
			const { getFetchOptions } = await import('@/lib/utils/fetch')
			const createdPost = makePost({ id: 9, body: 'Uploaded through S3.' })
			const file = new File(['audio'], 'clip.webm', { type: 'audio/webm' })
			fetchMock
				.mockResolvedValueOnce(
					await response({
						url: 'https://upload.example.com/signed-put',
						file_path: 'uploads/clip.webm',
					})
				)
				.mockResolvedValueOnce(await response({}))
				.mockResolvedValueOnce(await response(toServerPost(createdPost)))

			const result = await createPost({ text: 'Uploaded through S3.', media: file, media_type: 'audio' })

			expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
				'/api/uploads/presign/',
				'https://upload.example.com/signed-put',
				'/api/posts/',
			])
			expect(getFetchOptions).toHaveBeenNthCalledWith(1, 'POST', {
				file_name: 'clip.webm',
				content_type: 'audio/webm',
			})
			const createOptions = fetchMock.mock.calls[2][1] as RequestInit
			const formData = createOptions.body as FormData
			expect(formData.get('body')).toBe('Uploaded through S3.')
			expect(formData.get('media_type')).toBe('audio')
			expect(formData.get('s3_file_key')).toBe('uploads/clip.webm')
			expect(result.modified).toBeInstanceOf(Date)
			expect(result.url).toBe(`${window.location.origin}/p/9/`)
		})

		it('throws when the presign request fails and skips the upload', async () => {
			const { createPost } = await importPostsApi(true)
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
			const file = new File(['audio'], 'clip.webm', { type: 'audio/webm' })
			fetchMock.mockResolvedValueOnce(await response({ error: 'nope' }, false))

			await expect(
				createPost({ text: 'Doomed.', media: file, media_type: 'audio' })
			).rejects.toThrow('Failed to get an upload URL')
			expect(fetchMock).toHaveBeenCalledTimes(1)
			consoleError.mockRestore()
		})

		it('throws when the S3 upload fails and never creates the post', async () => {
			const { createPost } = await importPostsApi(true)
			const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
			const file = new File(['audio'], 'clip.webm', { type: 'audio/webm' })
			fetchMock
				.mockResolvedValueOnce(
					await response({
						url: 'https://upload.example.com/signed-put',
						file_path: 'uploads/clip.webm',
					})
				)
				.mockResolvedValueOnce(await response({}, false))

			await expect(
				createPost({ text: 'Doomed.', media: file, media_type: 'audio' })
			).rejects.toThrow('Failed to upload media')
			expect(fetchMock).toHaveBeenCalledTimes(2)
			consoleError.mockRestore()
		})

		it('appends media directly when S3 uploads are disabled', async () => {
			const { createPost } = await importPostsApi(false)
			const createdPost = makePost({ id: 10, body: 'Direct upload.' })
			const file = new File(['image'], 'image.png', { type: 'image/png' })
			fetchMock.mockResolvedValueOnce(await response(toServerPost(createdPost)))

			await createPost({ text: 'Direct upload.', media: file, media_type: 'image' })

			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(fetchMock).toHaveBeenCalledWith('/api/posts/', expect.any(Object))
			const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
			expect(formData.get('body')).toBe('Direct upload.')
			expect(formData.get('media_type')).toBe('image')
			expect(formData.get('media')).toBe(file)
		})
	})

	describe('getMediaUrl', () => {
		it('prefers signed media URLs and falls back to the stream endpoint', async () => {
			const { getMediaUrl } = await importPostsApi()

			expect(getMediaUrl(s3AudioPost)).toBe('https://signed.example.com/s3-audio.webm')
			expect(getMediaUrl(localImagePost)).toBe('/api/posts/3/media/')
		})
	})

	describe('getAuthorStats', () => {
		it('fetches aggregate totals for an author', async () => {
			const { getAuthorStats } = await importPostsApi()
			fetchMock.mockResolvedValueOnce(await response({ post_count: 45, likes_received: 300 }))

			const stats = await getAuthorStats(7)

			expect(fetchMock).toHaveBeenCalledWith('/api/posts/stats/?author=7')
			expect(stats).toEqual({ post_count: 45, likes_received: 300 })
		})
	})
})
