import type React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Post } from '@/types/post'

interface PostHeaderProps {
	post: Post
}

const PostHeader: React.FC<PostHeaderProps> = ({ post }) => {
	return (
		<div className="flex items-center gap-2">
			<Avatar className="h-10 w-10">
				<AvatarImage src={post.author.avatar} alt={post.author.username} />
				<AvatarFallback>
					{post.author.first_name[0]}
					{post.author.last_name[0]}
				</AvatarFallback>
			</Avatar>
			<div className="flex-1">
				<div className="flex items-center gap-1">
					<span className="font-semibold">
						{post.author.first_name} {post.author.last_name}
					</span>
					<span className="text-muted-foreground">@{post.author.username}</span>
				</div>
				<TooltipProvider>
					<Tooltip>
						<TooltipTrigger asChild>
							<div className="text-sm text-muted-foreground cursor-help">
								{formatDistanceToNow(post.created, { addSuffix: true })}
							</div>
						</TooltipTrigger>
						<TooltipContent>
							<p>{format(post.created, 'PPpp')}</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
		</div>
	)
}

export default PostHeader
