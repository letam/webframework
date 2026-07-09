export interface Author {
	id: number
	username: string
	avatar: string | null
	first_name: string
	last_name: string
}

export type PostVisibility = 'public' | 'unlisted' | 'private'

export interface Media {
	id: number
	media_type: 'audio' | 'video' | 'image'
	file: string
	s3_file_key?: string
	signed_url?: string | null
	mp3_file?: string
	duration?: string
	thumbnail?: string
	transcript?: string
	transcript_status?: '' | 'pending' | 'done' | 'error'
	alt_text?: string
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
	visibility: PostVisibility
	is_draft: boolean
	pinned_at?: string | null
	share_token?: string | null
	like_count: number
	comment_count: number
	view_count: number
	liked: boolean
}

export interface Comment {
	id: number
	author: Author
	body: string
	created: Date
}

export interface LikeResponse {
	liked: boolean
	like_count: number
}

export interface CreatePostRequest {
	text?: string
	media_type?: 'audio' | 'video' | 'image'
	media?: File
	visibility?: PostVisibility
	is_draft?: boolean
}

export interface UpdatePostRequest {
	head?: string
	body?: string
	transcript?: string
	alt_text?: string
	visibility?: PostVisibility
}
