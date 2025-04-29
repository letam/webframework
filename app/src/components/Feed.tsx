import type React from 'react'
import { useState } from 'react'
import Post from './post'
import CreatePost from './post/create'

interface PostData {
	id: string
	text: string
	mediaType?: 'audio' | 'video'
	mediaUrl?: string
	timestamp: Date
	username: string
	userAvatar: string
	likes: number
}

const Feed: React.FC = () => {
	const [posts, setPosts] = useState<PostData[]>([
		{
			id: '1',
			text: 'Just recorded a new podcast episode! Check it out 🎧',
			mediaType: 'audio',
			mediaUrl: 'https://soundtakes.com/p/s/RkP/d8pHEkmMkk0w.mp3',
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
	])

	const handlePostCreated = (post: PostData) => {
		setPosts([post, ...posts])
	}

	const handleLike = (id: string) => {
		setPosts(
			posts.map((post) => {
				if (post.id === id) {
					return { ...post, likes: post.likes + 1 }
				}
				return post
			})
		)
	}

	return (
		<div className="max-w-2xl mx-auto">
			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="space-y-4 my-6">
				{posts.map((post) => (
					<Post
						key={post.id}
						id={post.id}
						text={post.text}
						mediaType={post.mediaType}
						mediaUrl={post.mediaUrl}
						timestamp={post.timestamp}
						username={post.username}
						userAvatar={post.userAvatar}
						likes={post.likes}
						onLike={handleLike}
					/>
				))}
			</div>
		</div>
	)
}

export default Feed
