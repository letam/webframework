import type React from 'react'
import { useState } from 'react'
import { Heart, MessageCircle, Share2, Mic, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

interface PostActionsProps {
	id: number
	likeCount: number
	liked: boolean
	onLike: (id: number) => void
	commentCount: number
	commentsOpen: boolean
	onToggleComments: () => void
	postUrl: string
	shareTitle?: string
	mediaType?: 'audio' | 'video' | 'image'
	body?: string
	transcript?: string
	onTranscribe?: (id: number) => void
}

const PostActions: React.FC<PostActionsProps> = ({
	id,
	likeCount,
	liked,
	onLike,
	commentCount,
	commentsOpen,
	onToggleComments,
	postUrl,
	shareTitle,
	mediaType,
	body,
	transcript,
	onTranscribe,
}) => {
	const [isTranscribing, setIsTranscribing] = useState(false)

	const handleLike = () => {
		onLike(id)
	}

	const handleShare = async () => {
		if (navigator.share) {
			try {
				await navigator.share({ title: shareTitle, url: postUrl })
			} catch (error) {
				// User dismissed the share sheet; not an error worth surfacing
				if ((error as DOMException)?.name !== 'AbortError') {
					console.error('Failed to share post:', error)
				}
			}
			return
		}
		try {
			await navigator.clipboard.writeText(postUrl)
			toast.success('Link copied to clipboard')
		} catch (error) {
			console.error('Failed to copy link:', error)
			toast.error('Failed to copy link')
		}
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
				aria-label={liked ? 'Unlike post' : 'Like post'}
				aria-pressed={liked}
			>
				<Heart className={`h-4 w-4 sm:mr-1 ${liked ? 'fill-primary text-primary' : ''}`} />
				<span>{likeCount}</span>
			</Button>

			<Button
				variant="ghost"
				size="sm"
				className="text-muted-foreground hover:text-primary px-2 sm:px-3"
				onClick={onToggleComments}
				aria-label={commentsOpen ? 'Hide comments' : 'Show comments'}
				aria-expanded={commentsOpen}
			>
				<MessageCircle className={`h-4 w-4 sm:mr-1 ${commentsOpen ? 'text-primary' : ''}`} />
				<span>{commentCount}</span>
			</Button>

			<Button
				variant="ghost"
				size="sm"
				className="text-muted-foreground hover:text-primary px-2 sm:px-3"
				onClick={handleShare}
				aria-label="Share post"
			>
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
