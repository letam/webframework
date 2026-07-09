import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import PostMenu from './PostMenu'
import CommentSection from './CommentSection'
import type { Post as PostType } from '../../types/post'
import type { PostVisibility } from '../../types/post'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'
import { toast } from '@/components/ui/sonner'
import { useAuth } from '@/hooks/useAuth'
import { getMediaUrl, getPost, transcribePost } from '@/lib/api/posts'
import { getMimeTypeFromPath } from '@/lib/utils/file'
import { parseDurationString } from '@/lib/utils/media'

const TRANSCRIPTION_POLL_INTERVAL_MS = 3_000
const TRANSCRIPTION_TIMEOUT_MS = 3 * 60 * 1000

interface PostProps {
	post: PostType
	onLike: (id: number) => void
	onDelete: (id: number) => void
	onEdit: (
		id: number,
		head: string,
		body: string,
		transcript?: string,
		altText?: string
	) => Promise<void>
	onTranscribed?: (post: PostType) => void
	onPublish?: (id: number) => void
	onChangeVisibility?: (id: number, visibility: PostVisibility) => void
	onCopyShareLink?: (post: PostType) => void
	onResetShareLink?: (post: PostType) => void
	onTagClick?: (tag: string) => void
}

const FormatText: React.FC<{
	children: string
	className?: string
	onTagClick?: (tag: string) => void
}> = ({ children, className, onTagClick }) => {
	const content = DOMPurify.sanitize(children)
		.replace(/\n/g, '<br/>')
		.replace(/((?:https?:\/\/|www\.)[^\s<>"']+)/g, (_match, url) => {
			const href = url.startsWith('www.') ? `http://${url}` : url
			return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary underline break-words whitespace-pre-wrap inline-block max-w-full">${url}</a>`
		})
		.replace(/(^|[\s>])#([A-Za-z0-9_]+)/g, (_match, prefix, tag) =>
			onTagClick
				? `${prefix}<button type="button" data-tag="${tag}" class="hashtag">#${tag}</button>`
				: `${prefix}<span class="hashtag">#${tag}</span>`
		)

	const handleTagClick = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = (event.target as HTMLElement).closest('[data-tag]')
		const tag = target?.getAttribute('data-tag')
		if (tag && onTagClick) {
			onTagClick(tag)
		}
	}

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: click delegation for the <button data-tag> elements rendered via innerHTML below
		// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation fires a click on the delegated <button> elements natively
		<div
			className={cn('break-words', className)}
			onClick={onTagClick ? handleTagClick : undefined}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: we want to render URLs as href in html
			dangerouslySetInnerHTML={{ __html: content }}
		/>
	)
}

export const Post: React.FC<PostProps> = ({
	post,
	onLike,
	onDelete,
	onEdit,
	onTranscribed,
	onPublish,
	onChangeVisibility,
	onCopyShareLink,
	onResetShareLink,
	onTagClick,
}) => {
	const { isAuthenticated, userId, isSuperuser } = useAuth()
	const [commentsOpen, setCommentsOpen] = useState(false)
	const timedOutTranscriptionsRef = useRef<Set<number>>(new Set())
	// The transcribe endpoint only allows the post author or an admin
	const canTranscribe = isAuthenticated && (userId === post.author.id || isSuperuser)
	const mediaUrl = post.media ? getMediaUrl(post) : undefined
	const mediaAltText = post.media ? post.media.alt_text : undefined
	const mimeType = post.media
		? getMimeTypeFromPath(post.media.file || post.media.s3_file_key)
		: undefined
	const mediaDuration = post.media ? parseDurationString(post.media.duration) : undefined

	const handleTranscribe = async (id: number) => {
		try {
			const updatedPost = await transcribePost(id)
			onTranscribed?.(updatedPost)
			if (updatedPost.media?.transcript_status === 'done') {
				toast.success('Media transcribed successfully')
			}
			if (updatedPost.media?.transcript_status === 'error') {
				toast.error('Failed to transcribe media')
			}
		} catch (error) {
			console.error('Error transcribing media:', error)
			toast.error('Failed to transcribe media')
		}
	}

	useEffect(() => {
		if (post.media?.transcript_status !== 'pending') {
			timedOutTranscriptionsRef.current.delete(post.id)
			return
		}
		if (!canTranscribe || timedOutTranscriptionsRef.current.has(post.id)) {
			return
		}

		let active = true
		let intervalId: number | undefined
		const startedAt = Date.now()
		const stopPolling = () => {
			active = false
			if (intervalId !== undefined) {
				window.clearInterval(intervalId)
			}
		}
		const pollPost = async () => {
			if (!active) {
				return
			}
			if (Date.now() - startedAt >= TRANSCRIPTION_TIMEOUT_MS) {
				timedOutTranscriptionsRef.current.add(post.id)
				toast.info('Transcription is taking longer than expected — it will appear when ready')
				stopPolling()
				return
			}

			try {
				const freshPost = await getPost(post.id)
				if (!active) {
					return
				}
				if (freshPost.media?.transcript_status === 'done') {
					timedOutTranscriptionsRef.current.delete(post.id)
					onTranscribed?.(freshPost)
					toast.success('Media transcribed successfully')
					stopPolling()
				}
				if (freshPost.media?.transcript_status === 'error') {
					timedOutTranscriptionsRef.current.delete(post.id)
					onTranscribed?.(freshPost)
					toast.error('Failed to transcribe media')
					stopPolling()
				}
			} catch {
				// Ignore transient fetch failures; the interval continues until timeout.
			}
		}

		intervalId = window.setInterval(() => {
			void pollPost()
		}, TRANSCRIPTION_POLL_INTERVAL_MS)
		void pollPost()

		return stopPolling
	}, [canTranscribe, onTranscribed, post.id, post.media?.transcript_status])

	return (
		<div
			className="group bg-card rounded-lg shadow-xs border transition-[border-color,box-shadow] duration-200 hover:border-primary/20 hover:shadow-sm max-w-lg mx-auto px-4 py-3 animate-rise-in"
			data-testid={`post-${post.id}`}
		>
			<div className="flex items-center gap-2">
				<PostHeader post={post} />
				<PostMenu
					post={post}
					onDelete={onDelete}
					onEdit={onEdit}
					onPublish={onPublish}
					onChangeVisibility={onChangeVisibility}
					onCopyShareLink={onCopyShareLink}
					onResetShareLink={onResetShareLink}
				/>
			</div>

			<div className="">
				<div className="mt-2 max-w-lg">
					{post.head && (
						<div className="mt-1 text-[17px] font-semibold leading-snug tracking-tight">
							<FormatText onTagClick={onTagClick}>{post.head}</FormatText>
						</div>
					)}

					{post.body && (
						<div className="mt-2 text-[15px] leading-relaxed">
							<FormatText onTagClick={onTagClick}>{post.body}</FormatText>
						</div>
					)}
				</div>

				{post.media?.media_type === 'audio' && mediaUrl && mimeType && (
					<AudioPlayer audioUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
				)}

				{post.media?.media_type === 'video' && mediaUrl && mimeType && (
					<VideoPlayer videoUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
				)}

				{post.media?.media_type === 'image' && mediaUrl && mimeType && (
					<div className="mt-2">
						<img src={mediaUrl} alt={mediaAltText} className="w-full h-auto" />
					</div>
				)}

				{post.media?.transcript && (
					<div className="mt-3 max-w-lg border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
						<FormatText>{post.media.transcript}</FormatText>
					</div>
				)}

				<PostActions
					post={post}
					likeCount={post.like_count}
					liked={post.liked}
					onLike={onLike}
					commentCount={post.comment_count}
					commentsOpen={commentsOpen}
					onToggleComments={() => setCommentsOpen((open) => !open)}
					shareTitle={post.head || undefined}
					mediaType={post.media?.media_type}
					body={post.body}
					transcript={post.media?.transcript}
					transcriptStatus={post.media?.transcript_status}
					onTranscribe={canTranscribe ? handleTranscribe : undefined}
					onPublish={onPublish}
				/>

				{commentsOpen && <CommentSection postId={post.id} />}
			</div>
		</div>
	)
}
