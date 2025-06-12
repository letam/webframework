import type React from 'react'
import { useState } from 'react'
import { Heart, MessageCircle, Share2, Mic, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PostActionsProps {
	id: number
	likes: number
	onLike: (id: number) => void
	mediaType?: 'audio' | 'video' | 'image'
	body?: string
	transcript?: string
	onTranscribe?: (id: number) => void
}

const PostActions: React.FC<PostActionsProps> = ({
	id,
	likes,
	onLike,
	mediaType,
	body,
	transcript,
	onTranscribe,
}) => {
	const [isTranscribing, setIsTranscribing] = useState(false)

	const handleLike = () => {
		onLike(id)
	}

	const handleTranscribe = async () => {
		if (onTranscribe && !isTranscribing) {
			setIsTranscribing(true)
			try {
				await onTranscribe(id)
			} finally {
				setIsTranscribing(false)
			}
		}
	}

	const handleCopy = () => {
		if (body) {
			navigator.clipboard.writeText(body)
			toast.success('Text copied to clipboard')
		}
	}

	return (
		<div className="flex items-center mt-4 gap-2 sm:gap-6 flex-wrap">
			<Button
				variant="ghost"
				size="sm"
				className="text-muted-foreground hover:text-primary px-2 sm:px-3"
				onClick={handleLike}
			>
				<Heart className={`h-4 w-4 sm:mr-1 ${likes > 0 ? 'fill-primary text-primary' : ''}`} />
				<span className="hidden sm:inline">{likes}</span>
				<span className="sm:hidden">{likes}</span>
			</Button>

			<Button variant="ghost" size="sm" className="text-muted-foreground px-2 sm:px-3">
				<MessageCircle className="h-4 w-4 sm:mr-1" />
				<span className="hidden sm:inline">0</span>
				<span className="sm:hidden">0</span>
			</Button>

			<Button variant="ghost" size="sm" className="text-muted-foreground px-2 sm:px-3">
				<Share2 className="h-4 w-4 sm:mr-1" />
			</Button>

			{body && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-primary px-2 sm:px-3"
					onClick={handleCopy}
				>
					<Copy className="h-4 w-4 sm:mr-1" />
					<span className="hidden sm:inline">Copy</span>
				</Button>
			)}

			{mediaType && !transcript && onTranscribe && (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-primary px-2 sm:px-3"
					onClick={handleTranscribe}
					disabled={isTranscribing}
				>
					<Mic className="h-4 w-4 sm:mr-1" />
					<span className="hidden sm:inline">
						{isTranscribing ? 'Transcribing...' : 'Transcribe'}
					</span>
				</Button>
			)}
		</div>
	)
}

export default PostActions
