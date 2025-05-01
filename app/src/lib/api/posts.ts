import type {
	Post,
	CreatePostRequest,
	CreatePostResponse,
	GetPostsResponse,
} from '../../types/post'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api'

export const getPosts = async (): Promise<Post[]> => {
	try {
		const response = await fetch(`${API_BASE_URL}/posts`)
		if (!response.ok) {
			throw new Error('Failed to fetch posts')
		}
		const data: GetPostsResponse = await response.json()
		return data.posts.map((post) => ({
			...post,
			timestamp: new Date(post.timestamp),
		}))
	} catch (error) {
		console.error('Error fetching posts:', error)
		throw error
	}
}

export const createPost = async (postData: CreatePostRequest): Promise<Post> => {
	try {
		const response = await fetch(`${API_BASE_URL}/posts`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(postData),
		})
		if (!response.ok) {
			throw new Error('Failed to create post')
		}
		const data: CreatePostResponse = await response.json()
		return {
			...data,
			timestamp: new Date(data.timestamp),
		}
	} catch (error) {
		console.error('Error creating post:', error)
		throw error
	}
}
