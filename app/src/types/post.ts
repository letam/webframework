export interface Post {
	id: string
	text: string
	mediaType?: 'audio' | 'video'
	mediaUrl?: string
	timestamp: Date
	username: string
	userAvatar: string
	likes: number
}

export interface CreatePostRequest {
	text: string
	mediaType?: 'audio' | 'video'
	mediaUrl?: string
}

export interface CreatePostResponse extends Post {}

export interface GetPostsResponse {
	posts: Post[]
}
