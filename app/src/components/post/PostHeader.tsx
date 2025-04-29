import type React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

interface PostHeaderProps {
	username: string
	userAvatar: string
	timestamp: Date
}

const PostHeader: React.FC<PostHeaderProps> = ({ username, userAvatar, timestamp }) => {
	const timeAgo = formatDistanceToNow(timestamp, { addSuffix: true })

	return (
		<div className="flex gap-3">
			<Avatar>
				<AvatarImage src={userAvatar} alt={username} />
				<AvatarFallback>{username[0]}</AvatarFallback>
			</Avatar>

			<div className="grow">
				<div className="flex items-center gap-2">
					<p className="font-semibold">@{username}</p>
					<span className="text-muted-foreground text-sm">·</span>
					<p className="text-muted-foreground text-sm">{timeAgo}</p>

					<Button variant="ghost" size="icon" className="ml-auto h-8 w-8">
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</div>
			</div>
		</div>
	)
}

export default PostHeader
