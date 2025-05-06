import type React from 'react'
import { Heart, MessageCircle, Share2, Mic, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PostActionsProps {
	id: number
	likes: number
	onLike: (id: number) => void
	mediaType?: 'audio' | 'video'
	body?: string
	onTranscribe?: (id: number) => void
}

const PostActions: React.FC<PostActionsProps> = ({
	id,
	likes,
	onLike,
	mediaType,
	body,
	onTranscribe,
}) => {
	const handleLike = () => {
		onLike(id)
	}

	const handleTranscribe = () => {
		if (onTranscribe) {
			onTranscribe(id)
		}
	}

	const handleCopy = () => {
		if (body) {
			navigator.clipboard.writeText(body)
			toast.success('Text copied to clipboard')
		}
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

			{body && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-primary"
					onClick={handleCopy}
				>
					<Copy className="h-4 w-4 mr-1" />
					<span>Copy</span>
				</Button>
			)}

			{mediaType && !body && onTranscribe && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-primary"
					onClick={handleTranscribe}
				>
					<Mic className="h-4 w-4 mr-1" />
					<span>Transcribe</span>
				</Button>
			)}
		</div>
	)
}

export default PostActions
