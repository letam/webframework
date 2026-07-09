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

		it('adds drafts scope params', async () => {
			const { getPosts } = await importPostsApi()
			fetchMock.mockResolvedValueOnce(await response({ next: null, previous: null, results: [] }))

			await getPosts({ drafts: true })

			expect(fetchMock).toHaveBeenCalledWith('/api/posts/?drafts=true')
		})

		it('adds pinned scope params', async () => {
			const { getPosts } = await importPostsApi()
			fetchMock.mockResolvedValueOnce(await response({ next: null, previous: null, results: [] }))

			await getPosts({ author: 5, pinned: true })

			expect(fetchMock).toHaveBeenCalledWith('/api/posts/?author=5&pinned=true')
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

			const result = await createPost({
				text: 'Uploaded through S3.',
				media: file,
				media_type: 'audio',
				visibility: 'unlisted',
				is_draft: true,
			})

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
			expect(formData.get('visibility')).toBe('unlisted')
			expect(formData.get('is_draft')).toBe('true')
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

			await createPost({
				text: 'Direct upload.',
				media: file,
				media_type: 'image',
				visibility: 'private',
			})

			expect(fetchMock).toHaveBeenCalledTimes(1)
			expect(fetchMock).toHaveBeenCalledWith('/api/posts/', expect.any(Object))
			const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
			expect(formData.get('body')).toBe('Direct upload.')
			expect(formData.get('media_type')).toBe('image')
			expect(formData.get('media')).toBe(file)
			expect(formData.get('visibility')).toBe('private')
			expect(formData.get('is_draft')).toBeNull()
		})
	})

	describe('getShareUrl', () => {
		it('adds the share token only for unlisted posts', async () => {
			const { getShareUrl } = await importPostsApi()
			const unlisted = makePost({
				id: 30,
				url: 'http://localhost:3000/p/30/',
				visibility: 'unlisted',
				share_token: 'secret-token',
			})
			const privatePost = makePost({
				id: 31,
				url: 'http://localhost:3000/p/31/',
				visibility: 'private',
				share_token: 'secret-token',
			})

			expect(getShareUrl(unlisted)).toBe('http://localhost:3000/p/30/?token=secret-token')
			expect(getShareUrl(privatePost)).toBe('http://localhost:3000/p/31/')
		})
	})

	describe('getMediaUrl', () => {
		it('prefers signed media URLs and falls back to the stream endpoint', async () => {
			const { getMediaUrl } = await importPostsApi()
			const unlistedLocal = makePost({
				id: 11,
				visibility: 'unlisted',
				share_token: 'media-token',
				media: localImagePost.media,
			})

			expect(getMediaUrl(s3AudioPost)).toBe('https://signed.example.com/s3-audio.webm')
			expect(getMediaUrl(localImagePost)).toBe('/api/posts/3/media/')
			expect(getMediaUrl(unlistedLocal)).toBe('/api/posts/11/media/?token=media-token')
		})
	})

	describe('getPost', () => {
		it('fetches and revives a single post', async () => {
			const { getPost } = await importPostsApi()
			const post = makePost({ id: 7, body: 'Post detail.' })
			fetchMock.mockResolvedValueOnce(await response(toServerPost(post)))

			const result = await getPost(7)

			expect(fetchMock).toHaveBeenCalledWith('/api/posts/7/')
			expect(result.modified).toBeInstanceOf(Date)
			expect(result.url).toBe(`${window.location.origin}/p/7/`)
		})
	})

	describe('recordPostViews', () => {
		it('posts view ids with CSRF options and keepalive', async () => {
			const { recordPostViews } = await importPostsApi()
			const { getFetchOptions } = await import('@/lib/utils/fetch')
			fetchMock.mockResolvedValueOnce(await response(null))

			await recordPostViews([1, 2])

			expect(getFetchOptions).toHaveBeenCalledWith('POST', { post_ids: [1, 2] })
			expect(fetchMock).toHaveBeenCalledWith(
				'/api/posts/views/',
				expect.objectContaining({
					method: 'POST',
					keepalive: true,
				})
			)
		})
	})

	describe('updatePost', () => {
		it('sends thumbnail updates as multipart PATCH data', async () => {
			const { updatePost } = await importPostsApi()
			const updatedPost = makePost({ id: 9, head: 'Updated' })
			const poster = new File(['poster'], 'poster.jpg', { type: 'image/jpeg' })
			fetchMock.mockResolvedValueOnce(await response(toServerPost(updatedPost)))

			await updatePost(9, {
				head: 'Updated',
				body: 'Body',
				thumbnail: poster,
			})

			expect(fetchMock).toHaveBeenCalledWith('/api/posts/9/', expect.any(Object))
			const formData = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
			expect(formData.get('head')).toBe('Updated')
			expect(formData.get('body')).toBe('Body')
			expect(formData.get('thumbnail')).toBe(poster)
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

	describe('post actions', () => {
		it('publishes posts and regenerates share tokens', async () => {
			const { publishPost, regenerateShareToken } = await importPostsApi()
			const published = makePost({ id: 40, is_draft: false })
			const rotated = makePost({
				id: 40,
				visibility: 'unlisted',
				share_token: 'new-token',
			})
			fetchMock
				.mockResolvedValueOnce(await response(toServerPost(published)))
				.mockResolvedValueOnce(await response(toServerPost(rotated)))

			await expect(publishPost(40)).resolves.toMatchObject({ id: 40, is_draft: false })
			await expect(regenerateShareToken(40)).resolves.toMatchObject({
				id: 40,
				share_token: 'new-token',
			})

			expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
				'/api/posts/40/publish/',
				'/api/posts/40/share-token/',
			])
		})

		it('pins and unpins posts', async () => {
			const { pinPost, unpinPost } = await importPostsApi()
			const pinned = makePost({ id: 41, pinned_at: '2026-07-09T12:00:00Z' })
			const unpinned = makePost({ id: 41, pinned_at: null })
			fetchMock
				.mockResolvedValueOnce(await response(toServerPost(pinned)))
				.mockResolvedValueOnce(await response(toServerPost(unpinned)))

			await expect(pinPost(41)).resolves.toMatchObject({
				id: 41,
				pinned_at: '2026-07-09T12:00:00Z',
			})
			await expect(unpinPost(41)).resolves.toMatchObject({ id: 41, pinned_at: null })

			expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
				'/api/posts/41/pin/',
				'/api/posts/41/pin/',
			])
		})

		it('throws the server message when pinning fails', async () => {
			const { pinPost } = await importPostsApi()
			fetchMock.mockResolvedValueOnce(await response({ error: 'You can pin up to 3 posts' }, false))

			await expect(pinPost(42)).rejects.toThrow('You can pin up to 3 posts')
		})
	})
})
