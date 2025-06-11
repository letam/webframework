import type { Post, CreatePostRequest, UpdatePostRequest } from '../../types/post'
import { SERVER_API_URL, UPLOAD_FILES_TO_S3 } from '../constants'
import { getFetchOptions } from '../utils/fetch'

export const getPosts = async (): Promise<Post[]> => {
	try {
		const response = await fetch(`${SERVER_API_URL}/posts/`)
		if (!response.ok) {
			throw new Error('Failed to fetch posts')
		}
		let data: Post[] = await response.json()
		data = data.map((post) => ({
			...post,
			created: new Date(post.created),
		}))

		// Get signed url for each post
		const getPostSignedUrl = async (postId: number) => {
			const response = await fetch(`${SERVER_API_URL}/uploads/presign/${postId}/`)
			return response.json()
		}
		// TODO: If signed url is was recently generated, then don't request again and use the cached value
		// TODO: Have single endpoint request for all signed urls
		const dataWithSignedUrl = await Promise.all(
			data.map(async (post) => {
				if (post.media?.s3_file_key) {
					const response = (await getPostSignedUrl(post.id)) as { url: string }
					// TODO: Cache the signed url
					return { ...post, signedMediaUrl: response.url }
				}
				return post
			})
		)
		return dataWithSignedUrl
	} catch (error) {
		console.error('Error fetching posts:', error)
		throw error
	}
}

export const createPost = async (data: CreatePostRequest): Promise<Post> => {
	try {
		let response: Response
		const formData = new FormData()
		formData.append('body', data.text)

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
			// get presigned url from response
			const presignedUrl = (await response.json()) as { url: string; file_path: string }

			// upload file to s3
			// NOTE: Must edit CORS settings for the bucket, refer to project's server/config/s3-cors.json
			// https://dash.cloudflare.com/<ACCOUNT_ID>/r2/default/buckets/<bucket_name>/cors/edit
			await fetch(presignedUrl.url, {
				method: 'PUT',
				headers: {
					'Content-Type': data.media.type,
				},
				body: data.media,
			})

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
		return {
			...record,
			created: new Date(record.created),
		}
	} catch (error) {
		console.error('Error creating post:', error)
		throw error
	}
}

export const getMediaUrl = (post: Post): string => {
	if (post.signedMediaUrl) {
		return post.signedMediaUrl
	}
	return `${SERVER_API_URL}/posts/${post.id}/media/`

	// NOTE: Use this to serve media files directly from media server in non-Safari browsers
	// const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
	// return isSafari ? `${SERVER_API_URL}/posts/${post.id}/media/` : post.media
}

export const transcribePost = async (id: number): Promise<Post> => {
	try {
		const options = await getFetchOptions('POST')
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/transcribe/`, options)

		if (!response.ok) {
			throw new Error('Failed to transcribe media')
		}

		const post: Post = await response.json()
		return {
			...post,
			created: new Date(post.created),
		}
	} catch (error) {
		console.error('Error transcribing post:', error)
		throw error
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

export const updatePost = async (id: number, data: UpdatePostRequest): Promise<Post> => {
	try {
		const options = await getFetchOptions('PATCH', Object.fromEntries(Object.entries(data)))
		const response = await fetch(`${SERVER_API_URL}/posts/${id}/`, options)

		if (!response.ok) {
			throw new Error('Failed to update post')
		}
		const post: Post = await response.json()
		return { ...post, created: new Date(post.created), modified: new Date(post.modified) }
	} catch (error) {
		console.error('Error updating post:', error)
		throw error
	}
}
