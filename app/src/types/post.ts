export interface Author {
	id: number
	username: string
	avatar: string // TODO: Implement
	first_name: string
	last_name: string
}

export interface Media {
	id: number
	media_type: 'audio' | 'video'
	file: string
	s3_file_key?: string
	mp3_file?: string
	duration?: string
	thumbnail?: string
	transcript?: string
	created: Date
	modified: Date
}

export interface Post {
	id: number
	url: string
	created: Date
	modified: Date
	author: Author
	head: string
	body: string
	media?: Media
	likes: number // TODO: Implement

	// Dynamically added by the client
	signedMediaUrl?: string
}

export interface CreatePostRequest {
	text?: string
	media_type?: 'audio' | 'video'
	media?: File
}

export interface UpdatePostRequest {
	head?: string
	body?: string
	transcript?: string
}
