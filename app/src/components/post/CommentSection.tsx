import type React from 'react'
import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAuth } from '@/hooks/useAuth'
import { useComments } from '@/hooks/useComments'
import type { Author } from '@/types/post'

const authorInitials = (author: Author) => {
	const initials = `${author.first_name?.[0] ?? ''}${author.last_name?.[0] ?? ''}`
	return initials || author.username[0]?.toUpperCase() || '?'
}

const authorDisplayName = (author: Author) => {
	const name = `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim()
	return name || author.username
}

interface CommentSectionProps {
	postId: number
}

const CommentSection: React.FC<CommentSectionProps> = ({ postId }) => {
	const { isAuthenticated, userId, isSuperuser } = useAuth()
	const { comments, isLoading, error, addComment, removeComment, isAddingComment } =
		useComments(postId)
	const [draft, setDraft] = useState('')

	const handleSubmit = async () => {
		const body = draft.trim()
		if (!body || isAddingComment) return
		try {
			await addComment(body)
			setDraft('')
		} catch (err) {
			console.error('Failed to add comment:', err)
			toast.error('Failed to add comment')
		}
	}

	const handleDelete = async (commentId: number) => {
		try {
			await removeComment(commentId)
		} catch (err) {
			console.error('Failed to delete comment:', err)
			toast.error('Failed to delete comment')
		}
	}

	const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault()
			handleSubmit()
		}
	}

	return (
		<div className="mt-3 border-t pt-3" data-testid={`comments-${postId}`}>
			{isLoading ? (
				<div className="space-y-3">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-3/4" />
				</div>
			) : error ? (
				<div className="text-sm text-muted-foreground">Failed to load comments.</div>
			) : comments.length === 0 ? (
				<div className="text-sm text-muted-foreground">No comments yet. Be the first!</div>
			) : (
				<TooltipProvider delayDuration={300}>
					<ul className="space-y-3">
						{comments.map((comment) => (
							<li key={comment.id} className="group flex items-start gap-2">
								<Avatar className="h-7 w-7 mt-0.5">
									<AvatarFallback className="text-xs">
										{authorInitials(comment.author)}
									</AvatarFallback>
								</Avatar>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-1 text-sm">
										<span className="font-semibold">{authorDisplayName(comment.author)}</span>
										<span className="text-muted-foreground">
											· {formatDistanceToNow(comment.created, { addSuffix: true })}
										</span>
									</div>
									<p className="text-sm break-words whitespace-pre-wrap">{comment.body}</p>
								</div>
								{(comment.author.id === userId || isSuperuser) && (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 md:opacity-0"
												onClick={() => handleDelete(comment.id)}
												aria-label="Delete comment"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Delete comment</TooltipContent>
									</Tooltip>
								)}
							</li>
						))}
					</ul>
				</TooltipProvider>
			)}

			{isAuthenticated ? (
				<div className="mt-3 flex items-end gap-2">
					<Textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Write a comment..."
						className="min-h-9 max-h-40 resize-none"
						rows={1}
						maxLength={2000}
						aria-label="Write a comment"
					/>
					<Button size="sm" onClick={handleSubmit} disabled={!draft.trim() || isAddingComment}>
						{isAddingComment ? 'Posting...' : 'Post'}
					</Button>
				</div>
			) : (
				<div className="mt-3 text-sm text-muted-foreground">Log in to join the conversation.</div>
			)}
		</div>
	)
}

export default CommentSection
