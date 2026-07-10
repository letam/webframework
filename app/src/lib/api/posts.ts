import type {
	Post,
	Comment,
	CreatePostRequest,
	UpdatePostRequest,
	LikeResponse,
} from '../../types/post'
import { SERVER_API_URL, UPLOAD_FILES_TO_S3 } from '../constants'
import { getFetchOptions } from '../utils/fetch'

export interface PostsPage {
	posts: Post[]
	next: string | null
}

export interface PostsQueryScope {
	author?: number
	liked?: boolean
	drafts?: boolean
	pinned?: boolean
}

interface PaginatedPostsResponse {
	next: string | null
	previous?: string | null
	results: Post[]
}

export interface AuthorStats {
	post_count: number
	likes_received: number
}

const revivePost = (post: Post): Post => ({
	...post,
	created: new Date(post.created),
	modified: new Date(post.modified),
	media: post.media
		? {
				...post.media,
				created: new Date(post.media.created),
				modified: new Date(post.media.modified),
			}
		: undefined,
	link_previews: post.link_previews ?? [],
	url: `${window.location.origin}/p/${post.id}/`,
})

const buildPostsUrl = (scope: PostsQueryScope) => {
	const params = new URLSearchParams()

	if (scope.author != null) {
		params.set('author', String(scope.author))
	}

	if (scope.liked) {
		params.set('liked', 'true')
	}

	if (scope.drafts) {
		params.set('drafts', 'true')
	}

	if (scope.pinned) {
		params.set('pinned', 'true')
	}

	const query = params.toString()
	return `${SERVER_API_URL}/posts/${query ? `?${query}` : ''}`
}

export const getPosts = async (
	scope: PostsQueryScope = {},
	cursor?: string | null
): Promise<PostsPage> => {
	try {
		const response = await fetch(cursor ?? buildPostsUrl(scope))
		if (!response.ok) {
			throw new Error('Failed to fetch posts')
		}
		const data: PaginatedPostsResponse = await response.json()
		return {
			posts: data.results.map(revivePost),
			next: data.next,
		}
	} catch (error) {
		console.error('Error fetching posts:', error)
		throw error
	}
}

export const getPost = async (id: number): Promise<Post> => {
	try {
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/`)

		if (!response.ok) {
			throw new Error('Failed to fetch post')
		}

		const record: Post = await response.json()
		return revivePost(record)
	} catch (error) {
		console.error('Error fetching post:', error)
		throw error
	}
}

export const createPost = async (data: CreatePostRequest): Promise<Post> => {
	try {
		let response: Response
		const formData = new FormData()
		formData.append('body', data.text ?? '')
		if (data.visibility && data.visibility !== 'public') {
			formData.append('visibility', data.visibility)
		}
		if (data.is_draft) {
			formData.append('is_draft', 'true')
		}

		// // Debug logging
		// console.log('Creating post with data:', data)
		// console.log('FormData contents:', {
		// 	body: formData.get('body'),
		// 	media: data.media ? 'present' : 'absent',
		// 	media_type: data.media_type,
		// })

		// Check environment variable to see if we upload to S3 cloud-compatible storage or local storage
		if (data.media && UPLOAD_FILES_TO_S3) {
			// Get presigned url from backend
			const options = await getFetchOptions('POST', {
				file_name: data.media.name,
				content_type: data.media.type,
			})
			response = await fetch(`${SERVER_API_URL}/uploads/presign/`, options)
			if (!response.ok) {
				throw new Error('Failed to get an upload URL')
			}
			const presignedUrl = (await response.json()) as { url: string; file_path: string }

			// upload file to s3
			// NOTE: Must edit CORS settings for the bucket, refer to project's server/config/s3-cors.json
			// https://dash.cloudflare.com/<ACCOUNT_ID>/r2/default/buckets/<bucket_name>/cors/edit
			const uploadResponse = await fetch(presignedUrl.url, {
				method: 'PUT',
				headers: {
					'Content-Type': data.media.type,
				},
				body: data.media,
			})
			if (!uploadResponse.ok) {
				throw new Error('Failed to upload media')
			}

			// create post with file url
			formData.append('media_type', data.media_type || 'audio')
			formData.append('s3_file_key', presignedUrl.file_path)
			const postOptions = await getFetchOptions('POST', formData)

			response = await fetch(`${SERVER_API_URL}/posts/`, postOptions)
		} else {
			if (data.media) {
				formData.append('media_type', data.media_type || 'audio')
				formData.append('media', data.media)
			}

			const postOptions = await getFetchOptions('POST', formData)

			response = await fetch(`${SERVER_API_URL}/posts/`, postOptions)
		}

		if (!response.ok) {
			throw new Error('Failed to create post')
		}
		const record: Post = await response.json()
		return revivePost(record)
	} catch (error) {
		console.error('Error creating post:', error)
		throw error
	}
}

export const getShareUrl = (post: Post): string => {
	if (post.visibility !== 'unlisted' || !post.share_token) {
		return post.url
	}

	const url = new URL(post.url, window.location.origin)
	url.searchParams.set('token', post.share_token)
	return url.toString()
}

export const getMediaUrl = (post: Post): string => {
	if (post.media?.signed_url) {
		return post.media.signed_url
	}
	const streamUrl = `${SERVER_API_URL}/posts/${post.id}/media/`
	if (post.visibility !== 'unlisted' || !post.share_token) {
		return streamUrl
	}

	return `${streamUrl}?token=${encodeURIComponent(post.share_token)}`

	// NOTE: Use this to serve media files directly from media server in non-Safari browsers
	// const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
	// return isSafari ? `${SERVER_API_URL}/posts/${post.id}/media/` : post.media
}

export const publishPost = async (id: number): Promise<Post> => {
	const options = await getFetchOptions('POST')
	const response = await fetch(`${SERVER_API_URL}/posts/${id}/publish/`, options)

	if (!response.ok) {
		throw new Error('Failed to publish post')
	}

	const post: Post = await response.json()
	return revivePost(post)
}

export const regenerateShareToken = async (id: number): Promise<Post> => {
	const options = await getFetchOptions('POST')
	const response = await fetch(`${SERVER_API_URL}/posts/${id}/share-token/`, options)

	if (!response.ok) {
		throw new Error('Failed to reset share link')
	}

	const post: Post = await response.json()
	return revivePost(post)
}

export const transcribePost = async (id: number): Promise<Post> => {
	try {
		const options = await getFetchOptions('POST')
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/transcribe/`, options)

		if (!response.ok) {
			throw new Error('Failed to transcribe media')
		}

		const post: Post = await response.json()
		return revivePost(post)
	} catch (error) {
		console.error('Error transcribing post:', error)
		throw error
	}
}

export const recordPostViews = async (ids: number[]): Promise<void> => {
	if (ids.length === 0) {
		return
	}

	try {
		const options = await getFetchOptions('POST', { post_ids: ids })
		const response = await fetch(`${SERVER_API_URL}/posts/views/`, {
			...options,
			keepalive: true,
		})

		if (!response.ok) {
			throw new Error('Failed to record post views')
		}
	} catch (error) {
		console.error('Error recording post views:', error)
	}
}

export const deletePost = async (id: number): Promise<void> => {
	try {
		const options = await getFetchOptions('DELETE')
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/`, options)

		if (!response.ok) {
			throw new Error('Failed to delete post')
		}
	} catch (error) {
		console.error('Error deleting post:', error)
		throw error
	}
}

const setPostLike = async (id: number, liked: boolean): Promise<LikeResponse> => {
	const options = await getFetchOptions(liked ? 'POST' : 'DELETE')
	const response = await fetch(`${SERVER_API_URL}/posts/${id}/like/`, options)

	if (!response.ok) {
		throw new Error(liked ? 'Failed to like post' : 'Failed to unlike post')
	}
	return response.json()
}

export const likePost = (id: number): Promise<LikeResponse> => setPostLike(id, true)

export const unlikePost = (id: number): Promise<LikeResponse> => setPostLike(id, false)

const parsePostActionError = async (response: Response, fallback: string) => {
	try {
		const data = (await response.json()) as { error?: string }
		return data.error || fallback
	} catch {
		return fallback
	}
}

const setPostPinned = async (id: number, pinned: boolean): Promise<Post> => {
	const options = await getFetchOptions(pinned ? 'POST' : 'DELETE')
	const response = await fetch(`${SERVER_API_URL}/posts/${id}/pin/`, options)

	if (!response.ok) {
		throw new Error(
			await parsePostActionError(response, pinned ? 'Failed to pin post' : 'Failed to unpin post')
		)
	}

	const post: Post = await response.json()
	return revivePost(post)
}

export const pinPost = (id: number): Promise<Post> => setPostPinned(id, true)

export const unpinPost = (id: number): Promise<Post> => setPostPinned(id, false)

export const getComments = async (postId: number): Promise<Comment[]> => {
	const response = await fetch(`${SERVER_API_URL}/posts/${postId}/comments/`)

	if (!response.ok) {
		throw new Error('Failed to fetch comments')
	}
	const comments: Comment[] = await response.json()
	return comments.map((comment) => ({ ...comment, created: new Date(comment.created) }))
}

export const createComment = async (postId: number, body: string): Promise<Comment> => {
	const options = await getFetchOptions('POST', { body })
	const response = await fetch(`${SERVER_API_URL}/posts/${postId}/comments/`, options)

	if (!response.ok) {
		throw new Error('Failed to add comment')
	}
	const comment: Comment = await response.json()
	return { ...comment, created: new Date(comment.created) }
}

export const deleteComment = async (postId: number, commentId: number): Promise<void> => {
	const options = await getFetchOptions('DELETE')
	const response = await fetch(`${SERVER_API_URL}/posts/${postId}/comments/${commentId}/`, options)

	if (!response.ok) {
		throw new Error('Failed to delete comment')
	}
}

export const updatePost = async (id: number, data: UpdatePostRequest): Promise<Post> => {
	try {
		const thumbnail = data.thumbnail
		let body: FormData | Record<string, unknown>

		if (thumbnail instanceof File) {
			const formData = new FormData()
			for (const [key, value] of Object.entries(data)) {
				if (value == null) {
					continue
				}
				if (key === 'thumbnail') {
					formData.append(key, value)
				} else {
					formData.append(key, String(value))
				}
			}
			body = formData
		} else {
			body = Object.fromEntries(
				Object.entries(data).filter(([, value]) => value !== undefined && value !== null)
			)
		}

		const options = await getFetchOptions('PATCH', body)
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/`, options)

		if (!response.ok) {
			throw new Error('Failed to update post')
		}
		const post: Post = await response.json()
		return revivePost(post)
	} catch (error) {
		console.error('Error updating post:', error)
		throw error
	}
}

export const getAuthorStats = async (authorId: number): Promise<AuthorStats> => {
	const response = await fetch(`${SERVER_API_URL}/posts/stats/?author=${authorId}`)

	if (!response.ok) {
		throw new Error('Failed to fetch profile stats')
	}
	return response.json()
}
