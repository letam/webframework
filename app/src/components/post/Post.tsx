import type React from 'react'
import DOMPurify from 'dompurify'
import PostHeader from './PostHeader'
import PostActions from './PostActions'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'
import type { Post as PostType } from '../../types/post'
import { toast } from '@/components/ui/sonner'
import { getMediaUrl, transcribePost, useGetPostMediaMimeType } from '@/lib/api/posts'

interface PostProps {
	post: PostType
	onLike: (id: number) => void
	onTranscribed?: (post: PostType) => void
}

function FormatText({ children }: { children: React.ReactNode }): React.ReactElement {
	const content = DOMPurify.sanitize(children as string)
		.replace(/\n/g, '<br/>')
		.replace(
			/(https?:[^ ]+)( ?)/g,
			'<a href="$1" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; word-break: break-all;">$1</a>$2'
		)
	// biome-ignore lint/security/noDangerouslySetInnerHtml: we intentionally want to use html, but
	return <div dangerouslySetInnerHTML={{ __html: content }} />
}

export const Post: React.FC<PostProps> = ({ post, onLike, onTranscribed }) => {
	const mediaUrl = getMediaUrl(post)
	const mediaMimeTypeService = useGetPostMediaMimeType(post)

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

	if (post.media_type && mediaMimeTypeService.isLoading) {
		return <div>Loading...</div>
	}

	if (post.media_type && mediaMimeTypeService.error) {
		return <div>Error: {mediaMimeTypeService.error.message}</div>
	}

	return (
		<div
			className="bg-card rounded-lg shadow-xs p-4 border hover:border-primary/20 transition-colors"
			data-testid={`post-${post.id}`}
		>
			<PostHeader
				username={post.author.username}
				userAvatar={post.author.avatar}
				timestamp={post.created}
			/>

			<div className="ml-12">
				<div className="mt-2">
					{post.head && (
						<div className="mt-1">
							<FormatText>{post.head}</FormatText>
						</div>
					)}
				</div>

				{post.media_type === 'audio' && (
					<AudioPlayer audioUrl={mediaUrl} mimeType={mediaMimeTypeService.data} />
				)}

				{post.media_type === 'video' && (
					<VideoPlayer videoUrl={mediaUrl} mimeType={mediaMimeTypeService.data} />
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
					mediaType={post.media_type}
					body={post.body}
					onTranscribe={handleTranscribe}
				/>
			</div>
		</div>
	)
}
