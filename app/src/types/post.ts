export interface Author {
	id: number
	username: string
	avatar: string // TODO: Implement
	first_name: string
	last_name: string
}

export interface Post {
	id: number
	url: string
	created: Date
	author: Author
	head: string
	body: string
	media?: string
	media_s3_file_key?: string
	media_type?: 'audio' | 'video'

	likes: number // TODO: Implement

	// Dynamically added by the client
	signedMediaUrl?: string
}

export interface CreatePostRequest {
	text?: string
	media_type?: 'audio' | 'video'
	media?: File
}
