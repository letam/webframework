import type React from 'react'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'

interface PostProps {
	id: string
	text: string
	mediaType?: 'audio' | 'video'
	mediaUrl?: string
	timestamp: Date
	username: string
	userAvatar: string
	likes: number
	onLike: (id: string) => void
}

const Post: React.FC<PostProps> = ({
	id,
	text,
	mediaType,
	mediaUrl,
	timestamp,
	username,
	userAvatar,
	likes,
	onLike,
}) => {
	return (
		<div className="bg-card rounded-lg shadow-xs p-4 border hover:border-primary/20 transition-colors">
			<PostHeader username={username} userAvatar={userAvatar} timestamp={timestamp} />

			<div className="ml-12">
				<div className="mt-2">
					<p className="whitespace-pre-line">{text}</p>
				</div>

				{mediaType === 'audio' && mediaUrl && <AudioPlayer audioUrl={mediaUrl} />}

				{mediaType === 'video' && mediaUrl && <VideoPlayer videoUrl={mediaUrl} />}

				<PostActions id={id} likes={likes} onLike={onLike} />
			</div>
		</div>
	)
}

export default Post
