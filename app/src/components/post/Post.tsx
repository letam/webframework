import type React from 'react'
import DOMPurify from 'dompurify'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import PostMenu from './PostMenu'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'
import type { Post as PostType } from '../../types/post'
import { toast } from '@/components/ui/sonner'
import { getMediaUrl, transcribePost } from '@/lib/api/posts'
import { getMimeTypeFromPath } from '@/lib/utils/file'

interface PostProps {
	post: PostType
	onLike: (id: number) => void
	onDelete: (id: number) => void
	onTranscribed?: (post: PostType) => void
}

const FormatText: React.FC<{ children: string }> = ({ children }) => {
	const content = DOMPurify.sanitize(children)
		.replace(/\n/g, '<br/>')
		.replace(/((?:https?:\/\/)?(?:www\.)?[^ ]+)( ?)/g, (match, url, space) => {
			const href = url.startsWith('www.') ? `http://${url}` : url
			return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; word-break: break-all;">${url}</a>${space}`
		})
	// biome-ignore lint/security/noDangerouslySetInnerHtml: we want to render URLs as href in html
	return <div dangerouslySetInnerHTML={{ __html: content }} />
}

export const Post: React.FC<PostProps> = ({ post, onLike, onDelete, onTranscribed }) => {
	const mediaUrl = post.media ? getMediaUrl(post) : undefined
	const mimeType = post.media
		? getMimeTypeFromPath(post.media.file || post.media.s3_file_key)
		: undefined

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
			className="bg-card rounded-lg shadow-xs p-4 border hover:border-primary/20 transition-colors"
			data-testid={`post-${post.id}`}
		>
			<div className="flex items-center gap-2">
				<PostHeader post={post} />
				<PostMenu post={post} onDelete={onDelete} />
			</div>

			<div className="ml-12">
				<div className="mt-2">
					{post.head && (
						<div className="mt-1">
							<FormatText>{post.head}</FormatText>
						</div>
					)}
				</div>

				{post.media?.media_type === 'audio' && mediaUrl && mimeType && (
					<AudioPlayer audioUrl={mediaUrl} mimeType={mimeType} />
				)}

				{post.media?.media_type === 'video' && mediaUrl && mimeType && (
					<VideoPlayer videoUrl={mediaUrl} mimeType={mimeType} />
				)}

				{post.body && (
					<div className="mt-2 whitespace-pre-line">
						<FormatText>{post.body}</FormatText>
					</div>
				)}

				<PostActions
					id={post.id}
					likes={post.likes}
					onLike={onLike}
					mediaType={post.media?.media_type}
					body={post.body}
					onTranscribe={handleTranscribe}
				/>
			</div>
		</div>
	)
}
