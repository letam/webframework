import type React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { MoreHorizontal, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { downloadFile, getFileExtension } from '@/lib/utils/file'
import { getMediaUrl } from '@/lib/api/posts'
import type { Post } from '@/types/post'

interface PostHeaderProps {
	post: Post
}

const PostHeader: React.FC<PostHeaderProps> = ({ post }) => {
	const mediaUrl = post.media ? getMediaUrl(post) : undefined
	const timeAgo = formatDistanceToNow(post.created, { addSuffix: true })

	const handleDownload = () => {
		if (!mediaUrl || !post.media) return

		const formattedDateTime = format(post.created, 'yyyy-MM-dd_HH-mm-ss')
		const mediaFileExtension = getFileExtension(post.media.file || post.media.s3_file_key)
		const filename = `${post.author.username}_${formattedDateTime}.${mediaFileExtension}`

		downloadFile({ url: mediaUrl, filename })
	}

	return (
		<div className="flex gap-3">
			<Avatar>
				<AvatarImage src={post.author.avatar} alt={post.author.username} />
				<AvatarFallback>{post.author.username[0]}</AvatarFallback>
			</Avatar>

			<div className="grow">
				<div className="flex items-center gap-2">
					<p className="font-semibold">{post.author.username}</p>
					<span className="text-muted-foreground text-sm">·</span>
					<p className="text-muted-foreground text-sm" title={post.created.toLocaleString()}>
						{timeAgo}
					</p>

					{mediaUrl && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8"
							onClick={handleDownload}
							title="Download media"
						>
							<Download className="h-4 w-4" />
						</Button>
					)}

					<Button variant="ghost" size="icon" className="ml-auto h-8 w-8">
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	)
}

export default PostHeader
