import type React from 'react'
import { useState, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import PostMenu from './PostMenu'
import type { Post as PostType } from '../../types/post'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'
import { ImageModal } from '../ImageModal'
import { toast } from '@/components/ui/sonner'
import { getMediaUrl, getCompressedMediaUrl, transcribePost } from '@/lib/api/posts'
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
			return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="text-primary underline break-words whitespace-pre-wrap inline-block max-w-full">${url}</a>`
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
	const [compressedImageUrl, setCompressedImageUrl] = useState<string | null>(null)
	const [isImageModalOpen, setIsImageModalOpen] = useState(false)
	const mediaUrl = post.media ? getMediaUrl(post) : undefined
	const mediaAltText = post.media ? post.media.alt_text : undefined
	const mimeType = post.media
		? getMimeTypeFromPath(post.media.file || post.media.s3_file_key)
		: undefined
	const mediaDuration = post.media ? parseDurationString(post.media.duration) : undefined

	// Load compressed image URL for images
	useEffect(() => {
		const loadCompressedImage = async () => {
			if (post.media?.media_type === 'image') {
				try {
					const compressedUrl = await getCompressedMediaUrl(post)
					setCompressedImageUrl(compressedUrl)
				} catch (error) {
					console.error('Error loading compressed image:', error)
					// Fall back to regular media URL
					setCompressedImageUrl(mediaUrl || null)
				}
			}
		}

		loadCompressedImage()
	}, [post, mediaUrl])

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
		<div
			className="bg-card rounded-lg shadow-xs border hover:border-primary/20 transition-colors max-w-lg mx-auto px-4 py-2"
			data-testid={`post-${post.id}`}
		>
			<div className="flex items-center gap-2">
				<PostHeader post={post} />
				<PostMenu post={post} onDelete={onDelete} onEdit={onEdit} />
			</div>

			<div className="">
				<div className="mt-2 max-w-lg">
					{post.head && (
						<div className="mt-1 text-lg font-bold">
							<FormatText>{post.head}</FormatText>
						</div>
					)}

					{post.body && (
						<div className="mt-2">
							<FormatText>{post.body}</FormatText>
						</div>
					)}
				</div>

				{post.media?.media_type === 'audio' && mediaUrl && mimeType && (
					<AudioPlayer audioUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
				)}

				{post.media?.media_type === 'video' && mediaUrl && mimeType && (
					<VideoPlayer videoUrl={mediaUrl} mimeType={mimeType} duration={mediaDuration} />
				)}

				{post.media?.media_type === 'image' && compressedImageUrl && mimeType && (
					<div className="mt-2">
						<button
							type="button"
							onClick={() => setIsImageModalOpen(true)}
							className="w-full p-0 border-0 bg-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-lg"
							aria-label="Open full resolution image"
						>
							<img
								src={compressedImageUrl}
								alt={mediaAltText}
								className="w-full h-auto hover:opacity-90 transition-opacity rounded-lg"
							/>
						</button>
						<div className="mt-1 text-xs text-muted-foreground text-center">
							Click to view full resolution
						</div>
					</div>
				)}

				{post.media?.transcript && (
					<div className="mt-2 max-w-lg">
						<FormatText>{post.media.transcript}</FormatText>
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

			{/* Image Modal */}
			<ImageModal
				post={post}
				isOpen={isImageModalOpen}
				onClose={() => setIsImageModalOpen(false)}
			/>
		</div>
	)
}
