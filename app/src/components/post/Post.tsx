import type React from 'react'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import PostMenu from './PostMenu'
import type { Post as PostType } from '../../types/post'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'
import { toast } from '@/components/ui/sonner'
import { getMediaUrl, transcribePost } from '@/lib/api/posts'
import { getMimeTypeFromPath } from '@/lib/utils/file'
import { parseDurationString } from '@/lib/utils/media'

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
}

const FormatText: React.FC<{ children: string; className?: string }> = ({
	children,
	className,
}) => {
	const content = DOMPurify.sanitize(children)
		.replace(/\n/g, '<br/>')
		.replace(/((?:https?:\/\/|www\.)[^\s<>"']+)/g, (_match, url) => {
			const href = url.startsWith('www.') ? `http://${url}` : url
			return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary underline decoration-primary/40 underline-offset-2 break-words whitespace-pre-wrap inline-block max-w-full">${url}</a>`
		})
	return (
		<div
			className={cn('break-words', className)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: we want to render URLs as href in html
			dangerouslySetInnerHTML={{ __html: content }}
		/>
	)
}

export const Post: React.FC<PostProps> = ({ post, onLike, onDelete, onEdit, onTranscribed }) => {
	const mediaUrl = post.media ? getMediaUrl(post) : undefined
	const mediaAltText = post.media ? post.media.alt_text : undefined
	const mimeType = post.media
		? getMimeTypeFromPath(post.media.file || post.media.s3_file_key)
		: undefined
	const mediaDuration = post.media ? parseDurationString(post.media.duration) : undefined

	const handleTranscribe = async (id: number) => {
		try {
			const updatedPost = await transcribePost(id)
			toast.success('Media transcribed successfully')
			if (onTranscribed) {
				onTranscribed(updatedPost)
			}
		} catch (error) {
			console.error('Error transcribing media:', error)
			toast.error('Failed to transcribe media')
		}
	}

	return (
		<article
			className="dispatch group relative mx-auto max-w-lg overflow-hidden rounded-xl border border-border bg-card px-4 py-3.5 shadow-[0_1px_0_hsl(var(--border))] sm:px-5"
			data-testid={`post-${post.id}`}
		>
			{/* Signal edge — lights up vermilion on hover */}
			<span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-primary/70 transition-transform duration-300 group-hover:scale-y-100" />

			<div className="flex items-start justify-between gap-2">
				<PostHeader post={post} />
				<PostMenu post={post} onDelete={onDelete} onEdit={onEdit} />
			</div>

			<div className="mt-3">
				{post.head && (
					<h2 className="font-display text-[1.45rem] font-semibold leading-snug text-foreground">
						<FormatText>{post.head}</FormatText>
					</h2>
				)}

				{post.body && (
					<div className="mt-2 text-[0.975rem] leading-relaxed text-foreground/90">
						<FormatText>{post.body}</FormatText>
					</div>
				)}

				{post.media?.media_type === 'audio' && mediaUrl && mimeType && (
					<div className="mt-3">
						<AudioPlayer audioUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
					</div>
				)}

				{post.media?.media_type === 'video' && mediaUrl && mimeType && (
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<VideoPlayer videoUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
					</div>
				)}

				{post.media?.media_type === 'image' && mediaUrl && mimeType && (
					<div className="mt-3 overflow-hidden rounded-lg border border-border">
						<img src={mediaUrl} alt={mediaAltText} className="h-auto w-full" />
					</div>
				)}

				{post.media?.transcript && (
					<div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 py-2.5 pl-3.5 pr-3">
						<div className="mb-1 flex items-center gap-1.5 font-mono text-[0.6rem] uppercase tracking-[0.2em] text-gold">
							<span className="eq text-gold">
								<span className="eq-bar" />
								<span className="eq-bar" />
								<span className="eq-bar" />
							</span>
							Transcript
						</div>
						<FormatText className="text-[0.925rem] leading-relaxed text-foreground/80">
							{post.media.transcript}
						</FormatText>
					</div>
				)}

				<PostActions
					id={post.id}
					likes={post.likes}
					onLike={onLike}
					mediaType={post.media?.media_type}
					body={post.body}
					transcript={post.media?.transcript}
					onTranscribe={handleTranscribe}
				/>
			</div>
		</article>
	)
}
