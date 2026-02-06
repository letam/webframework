import type { Post } from '../../types/post'

export const mockPosts: Post[] = [
	{
		id: 1,
		url: 'http://localhost/p/1/',
		body: 'Just recorded a new podcast episode! Check it out',
		head: '',
		created: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
		modified: new Date(Date.now() - 1000 * 60 * 60 * 2),
		author: {
			id: 1,
			username: 'audiophile',
			avatar: '',
			first_name: 'Audio',
			last_name: 'Phil',
		},
		media: {
			id: 1,
			media_type: 'audio',
			file: 'posts/1/test.mp3',
			duration: '00:03:30',
			created: new Date(Date.now() - 1000 * 60 * 60 * 2),
			modified: new Date(Date.now() - 1000 * 60 * 60 * 2),
		},
		likes: 15,
	},
	{
		id: 2,
		url: 'http://localhost/p/2/',
		body: 'Beautiful day here in San Francisco! #travel #workation',
		head: '',
		created: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
		modified: new Date(Date.now() - 1000 * 60 * 60 * 5),
		author: {
			id: 2,
			username: 'traveler',
			avatar: '',
			first_name: 'Travel',
			last_name: 'Er',
		},
		media: {
			id: 2,
			media_type: 'video',
			file: 'posts/2/test.mp4',
			created: new Date(Date.now() - 1000 * 60 * 60 * 5),
			modified: new Date(Date.now() - 1000 * 60 * 60 * 5),
		},
		likes: 42,
	},
	{
		id: 3,
		url: 'http://localhost/p/3/',
		body: 'Just launched our new product! So excited to share this with everyone. What do you think?',
		head: 'Product Launch',
		created: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
		modified: new Date(Date.now() - 1000 * 60 * 60 * 12),
		author: {
			id: 3,
			username: 'techfounder',
			avatar: '',
			first_name: 'Tech',
			last_name: 'Founder',
		},
		likes: 7,
	},
]
