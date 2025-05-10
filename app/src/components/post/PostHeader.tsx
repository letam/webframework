import type React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { MoreHorizontal, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { getFileExtension, downloadFile } from '@/lib/utils/file'

interface PostHeaderProps {
	username: string
	userAvatar: string
	timestamp: Date
	mediaUrl?: string
	mediaType?: 'audio' | 'video'
}

const PostHeader: React.FC<PostHeaderProps> = ({
	username,
	userAvatar,
	timestamp,
	mediaUrl,
	mediaType,
}) => {
	const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

	const handleDownload = () => {
		if (!mediaUrl) return

		const extension = getFileExtension(mediaUrl, mediaType)
		const formattedDateTime = format(timestamp, 'yyyy-MM-dd_HH-mm-ss')
		const filename = `${username}_${formattedDateTime}.${extension}`

		downloadFile({ url: mediaUrl, filename })
	}

	return (
		<div className="flex gap-3">
			<Avatar>
				<AvatarImage src={userAvatar} alt={username} />
				<AvatarFallback>{username[0]}</AvatarFallback>
			</Avatar>

			<div className="grow">
				<div className="flex items-center gap-2">
					<p className="font-semibold">{username}</p>
					<span className="text-muted-foreground text-sm">·</span>
					<p className="text-muted-foreground text-sm" title={timestamp.toLocaleString()}>
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
