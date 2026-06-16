import type React from 'react'
import { useState } from 'react'
import { Heart, MessageCircle, Share2, Mic, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
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

const actionBtn =
	'group/action inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card'

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
	const [popKey, setPopKey] = useState(0)

	const handleLike = () => {
		setPopKey((k) => k + 1)
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

	const liked = likes > 0

	return (
		<div className="mt-4 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2.5">
			<button
				type="button"
				className={cn(actionBtn, 'hover:text-primary')}
				onClick={handleLike}
				aria-label="Like"
			>
				<Heart
					key={popKey}
					className={cn(
						'h-4 w-4 transition-colors',
						popKey > 0 && 'animate-heart-pop',
						liked ? 'fill-primary text-primary' : 'group-hover/action:text-primary'
					)}
				/>
				<span className={cn('tabular-nums', liked && 'text-primary')}>{likes}</span>
			</button>

			<button type="button" className={actionBtn} aria-label="Comments">
				<MessageCircle className="h-4 w-4" />
				<span className="tabular-nums">0</span>
			</button>

			<button type="button" className={actionBtn} aria-label="Share">
				<Share2 className="h-4 w-4" />
			</button>

			{body && (
				<button
					type="button"
					className={cn(actionBtn, 'hover:text-primary')}
					onClick={handleCopy}
					aria-label="Copy text"
				>
					<Copy className="h-4 w-4" />
					<span className="hidden sm:inline">Copy</span>
				</button>
			)}

			{mediaType && !transcript && onTranscribe && (
				<button
					type="button"
					className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 font-mono text-xs font-medium uppercase tracking-wider text-gold transition-colors hover:bg-gold/20 disabled:opacity-60"
					onClick={handleTranscribe}
					disabled={isTranscribing}
				>
					<Mic className={cn('h-3.5 w-3.5', isTranscribing && 'animate-pulse')} />
					<span>{isTranscribing ? 'Transcribing…' : 'Transcribe'}</span>
				</button>
			)}
		</div>
	)
}

export default PostActions
