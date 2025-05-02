import type React from 'react'
import { Heart, MessageCircle, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PostActionsProps {
	id: number
	likes: number
	onLike: (id: number) => void
}

const PostActions: React.FC<PostActionsProps> = ({ id, likes, onLike }) => {
	const handleLike = () => {
		onLike(id)
	}

	return (
		<div className="flex items-center mt-4 gap-6">
			<Button
				variant="ghost"
				size="sm"
				className="text-muted-foreground hover:text-primary"
				onClick={handleLike}
			>
				<Heart className={`h-4 w-4 mr-1 ${likes > 0 ? 'fill-primary text-primary' : ''}`} />
				<span>{likes}</span>
			</Button>

			<Button variant="ghost" size="sm" className="text-muted-foreground">
				<MessageCircle className="h-4 w-4 mr-1" />
				<span>0</span>
			</Button>

			<Button variant="ghost" size="sm" className="text-muted-foreground">
				<Share2 className="h-4 w-4 mr-1" />
			</Button>
		</div>
	)
}

export default PostActions
