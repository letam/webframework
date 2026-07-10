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
	thumbnail?: string | null
	waveform?: number[] | null
	transcript?: string
	transcript_status?: '' | 'pending' | 'done' | 'error'
	alt_text?: string
	created: Date
	modified: Date
}

export type LinkPreviewKind = 'youtube' | 'twitter' | 'generic'

export interface LinkPreview {
	id: number
	url: string
	kind: LinkPreviewKind
	title: string
	description: string
	site_name: string
	author_name: string
	author_handle: string
	embed_id: string
	published_at: string | null
	image: string | null
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
	link_previews?: LinkPreview[]
	visibility: PostVisibility
	is_draft: boolean
	link_previews_enabled: boolean
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
	link_previews_enabled?: boolean
}

export interface UpdatePostRequest {
	head?: string
	body?: string
	transcript?: string
	alt_text?: string
	thumbnail?: File | null
	visibility?: PostVisibility
}
