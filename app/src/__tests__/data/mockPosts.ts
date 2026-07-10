import type { PostsPage } from '@/lib/api/posts'
import type { Author, LinkPreview, Media, Post } from '@/types/post'

export const makeAuthor = (overrides: Partial<Author> = {}): Author => ({
	id: 1,
	username: 'audiophile',
	avatar: 'https://example.com/avatar.jpg',
	first_name: 'Audio',
	last_name: 'Phile',
	...overrides,
})

export const makeMedia = (overrides: Partial<Media> = {}): Media => ({
	id: 10,
	media_type: 'audio',
	file: '',
	s3_file_key: 'uploads/audio.webm',
	signed_url: 'https://signed.example.com/audio.webm',
	duration: '00:01:23',
	thumbnail: '',
	transcript: '',
	alt_text: '',
	created: new Date('2026-01-01T00:00:00.000Z'),
	modified: new Date('2026-01-01T00:00:00.000Z'),
	...overrides,
})

export const makeLinkPreview = (overrides: Partial<LinkPreview> = {}): LinkPreview => ({
	id: 100,
	url: 'https://example.com/story',
	kind: 'generic',
	title: 'A useful linked story',
	description: 'A short description for the linked story.',
	site_name: 'Example',
	author_name: '',
	author_handle: '',
	embed_id: '',
	extra: {},
	published_at: null,
	image: null,
	...overrides,
})

export const makePost = (overrides: Partial<Post> = {}): Post => ({
	id: 1,
	url: 'http://localhost:3000/p/1/',
	created: new Date('2026-01-01T00:00:00.000Z'),
	modified: new Date('2026-01-01T00:00:00.000Z'),
	author: makeAuthor(),
	head: 'A useful post',
	body: 'Just recorded a new episode about web correctness.',
	media: undefined,
	link_previews: [],
	visibility: 'public',
	is_draft: false,
	link_previews_enabled: true,
	share_token: 'share-token-1',
	like_count: 2,
	comment_count: 1,
	view_count: 0,
	liked: false,
	...overrides,
})

export const makePostsPage = (posts: Post[], next: string | null = null): PostsPage => ({
	posts,
	next,
})

export const textOnlyPost = makePost()

export const s3AudioPost = makePost({
	id: 2,
	url: 'http://localhost:3000/p/2/',
	author: makeAuthor({ id: 2, username: 'sounddesk', first_name: 'Sound', last_name: 'Desk' }),
	head: 'S3 audio',
	body: 'Audio stored in object storage.',
	media: makeMedia({
		id: 20,
		media_type: 'audio',
		file: '',
		s3_file_key: 'uploads/s3-audio.webm',
		signed_url: 'https://signed.example.com/s3-audio.webm',
	}),
	like_count: 5,
	liked: true,
})

export const localImagePost = makePost({
	id: 3,
	url: 'http://localhost:3000/p/3/',
	author: makeAuthor({ id: 1, username: 'audiophile' }),
	head: 'Local image',
	body: 'Image stored locally.',
	media: makeMedia({
		id: 30,
		media_type: 'image',
		file: '/media/uploads/local-image.png',
		s3_file_key: undefined,
		signed_url: null,
		alt_text: 'A local image',
	}),
	like_count: 1,
})

export const mockPosts = [textOnlyPost, s3AudioPost, localImagePost]
