import type React from 'react'
import { useState, useEffect } from 'react'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Post } from '@/types/post'

interface EditPostModalProps {
	post: Post
	open: boolean
	onOpenChange: (open: boolean) => void
	onSave: (
		postId: number,
		head: string,
		body: string,
		transcript?: string,
		altText?: string
	) => Promise<void>
}

export const EditPostModal: React.FC<EditPostModalProps> = ({
	post,
	open,
	onOpenChange,
	onSave,
}) => {
	const [head, setHead] = useState(post.head)
	const [body, setBody] = useState(post.body)
	const [transcript, setTranscript] = useState(post.media?.transcript || '')
	const [altText, setAltText] = useState(post.media?.alt_text || '')
	const [isSubmitting, setIsSubmitting] = useState(false)

	// Update state when post changes
	useEffect(() => {
		setHead(post.head)
		setBody(post.body)
		setTranscript(post.media?.transcript || '')
		setAltText(post.media?.alt_text || '')
	}, [post])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setIsSubmitting(true)
		try {
			await onSave(post.id, head, body, transcript, altText)
			onOpenChange(false)
		} catch (error) {
			console.error('Failed to update post:', error)
		} finally {
			setIsSubmitting(false)
		}
	}

	// Handle keyboard shortcuts
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
			e.preventDefault()
			handleSubmit(e)
		} else if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
			e.preventDefault()
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Edit Post</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="space-y-4" onKeyDown={handleKeyDown}>
					<div className="space-y-2">
						<Label htmlFor="head">Title</Label>
						<Input
							id="head"
							value={head}
							onChange={(e) => setHead(e.target.value)}
							placeholder="Enter post title"
							onKeyDown={handleKeyDown}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="body">Content</Label>
						<Textarea
							id="body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							placeholder="Enter post content"
							className="min-h-[100px]"
							onKeyDown={handleKeyDown}
						/>
					</div>
					{post.media && post.media.media_type !== 'image' && (
						<div className="space-y-2">
							<Label htmlFor="transcript">Transcript</Label>
							<Textarea
								id="transcript"
								value={transcript}
								onChange={(e) => setTranscript(e.target.value)}
								placeholder="Enter media transcript"
								className="min-h-[100px]"
								onKeyDown={handleKeyDown}
							/>
						</div>
					)}
					{post.media && post.media.media_type === 'image' && (
						<div className="space-y-2">
							<Label htmlFor="altText">Alt Text</Label>
							<Textarea
								id="altText"
								value={altText}
								onChange={(e) => setAltText(e.target.value)}
								placeholder="Enter media alt text"
								className="min-h-[100px]"
								onKeyDown={handleKeyDown}
							/>
						</div>
					)}

					<DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-4 sm:gap-2">
						<Button type="submit" disabled={isSubmitting} className="order-1 sm:order-2">
							{isSubmitting ? 'Saving...' : 'Save Changes'}
						</Button>
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={isSubmitting}
							className="order-2 sm:order-1"
						>
							Cancel
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
