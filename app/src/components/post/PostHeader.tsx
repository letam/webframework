import type React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { Copy, ExternalLink } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Post } from '@/types/post'

interface PostHeaderProps {
	post: Post
}

const PostHeader: React.FC<PostHeaderProps> = ({ post }) => {
	console.log('derp post', post) // DEBUG
	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(post.url)
			// You could add a toast notification here if you have one
		} catch (err) {
			console.error('Failed to copy link:', err)
		}
	}

	const handleOpenInNewTab = () => {
		window.open(post.url, '_blank', 'noopener,noreferrer')
	}

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
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<TooltipTrigger asChild>
									<div className="text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
										{formatDistanceToNow(post.created, { addSuffix: true })}
									</div>
								</TooltipTrigger>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem onClick={handleCopyLink} className="cursor-pointer">
									<Copy className="mr-2 h-4 w-4" />
									Copy link to post
								</DropdownMenuItem>
								<DropdownMenuItem onClick={handleOpenInNewTab} className="cursor-pointer">
									<ExternalLink className="mr-2 h-4 w-4" />
									Open post in new tab
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
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
