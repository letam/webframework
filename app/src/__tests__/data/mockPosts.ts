import type { Post } from '../../types/post'

export const mockPosts: Post[] = [
	{
		id: '1',
		text: 'Just recorded a new podcast episode! Check it out 🎧',
		mediaType: 'audio',
		mediaUrl:
			'https://citizen-dj.labs.loc.gov/audio/samplepacks/loc-fma/Mushrooms_fma-178531_001_00-00-01.mp3',
		timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
		username: 'audiophile',
		userAvatar: 'https://ui-avatars.com/api/?name=AP&background=7c3aed&color=fff',
		likes: 15,
	},
	{
		id: '2',
		text: 'Beautiful day here in San Francisco! #travel #workation',
		mediaType: 'video',
		mediaUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
		timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5), // 5 hours ago
		username: 'traveler',
		userAvatar: 'https://ui-avatars.com/api/?name=TR&background=3b82f6&color=fff',
		likes: 42,
	},
	{
		id: '3',
		text: 'Just launched our new product! So excited to share this with everyone. What do you think?',
		timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12), // 12 hours ago
		username: 'techfounder',
		userAvatar: 'https://ui-avatars.com/api/?name=TF&background=10b981&color=fff',
		likes: 7,
	},
]
