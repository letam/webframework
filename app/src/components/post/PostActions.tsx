import type React from 'react'
import { useState } from 'react'
import { Heart, MessageCircle, Share2, Mic, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const actionButtonClass =
	'text-muted-foreground rounded-full hover:text-primary hover:bg-primary/10 px-2 sm:px-3'

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
	transcriptStatus?: '' | 'pending' | 'done' | 'error'
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
	transcriptStatus,
	onTranscribe,
}) => {
	const [isTranscribing, setIsTranscribing] = useState(false)
	const [likePop, setLikePop] = useState(false)
	const transcribing = isTranscribing || transcriptStatus === 'pending'

	const handleLike = () => {
		// Only pop on the like action, never on load or when un-liking
		if (!liked) {
			setLikePop(true)
		}
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
		if (onTranscribe && !transcribing) {
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
		<TooltipProvider delayDuration={300}>
			<div className="flex items-center mt-4 gap-2 sm:gap-6 flex-wrap">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className={cn(
								actionButtonClass,
								'hover:text-rose-500 hover:bg-rose-500/10',
								liked && 'text-rose-500'
							)}
							onClick={handleLike}
							aria-label={liked ? 'Unlike post' : 'Like post'}
							aria-pressed={liked}
						>
							<span className="relative inline-flex">
								{likePop && (
									<span
										aria-hidden="true"
										className="absolute -inset-1 rounded-full border-2 border-rose-400 animate-echo-ring"
										onAnimationEnd={() => setLikePop(false)}
									/>
								)}
								<Heart
									className={cn(
										'h-4 w-4 transition-transform',
										liked && 'fill-rose-500 text-rose-500',
										likePop && 'animate-heart-pop'
									)}
								/>
							</span>
							<span className="tabular-nums">{likeCount}</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>{liked ? 'Unlike' : 'Like'}</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className={cn(
								actionButtonClass,
								'hover:text-sky-500 hover:bg-sky-500/10',
								commentsOpen && 'text-sky-500'
							)}
							onClick={onToggleComments}
							aria-label={commentsOpen ? 'Hide comments' : 'Show comments'}
							aria-expanded={commentsOpen}
						>
							<MessageCircle className="h-4 w-4" />
							<span className="tabular-nums">{commentCount}</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>{commentsOpen ? 'Hide comments' : 'Comments'}</TooltipContent>
				</Tooltip>

				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							className={actionButtonClass}
							onClick={handleShare}
							aria-label="Share post"
						>
							<Share2 className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Share</TooltipContent>
				</Tooltip>

				{body && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className={actionButtonClass}
								onClick={handleCopy}
								aria-label="Copy text"
							>
								<Copy className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Copy text</TooltipContent>
					</Tooltip>
				)}

				{mediaType && !transcript && onTranscribe && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className={actionButtonClass}
								onClick={handleTranscribe}
								disabled={transcribing}
								aria-label="Transcribe media"
							>
								<Mic className={cn('h-4 w-4 sm:mr-1', transcribing && 'animate-pulse')} />
								<span className="hidden sm:inline">
									{transcribing ? 'Transcribing...' : 'Transcribe'}
								</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>{transcribing ? 'Transcribing…' : 'Transcribe media'}</TooltipContent>
					</Tooltip>
				)}
			</div>
		</TooltipProvider>
	)
}

export default PostActions
