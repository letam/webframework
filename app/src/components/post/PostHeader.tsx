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
	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(post.url)
		} catch (err) {
			console.error('Failed to copy link:', err)
		}
	}

	const handleOpenInNewTab = () => {
		window.open(post.url, '_blank', 'noopener,noreferrer')
	}

	return (
		<div className="flex min-w-0 items-center gap-3">
			{/* Avatar framed by a faint echo ring */}
			<div className="relative shrink-0">
				<span className="absolute -inset-1 rounded-full border border-border/70" />
				<Avatar className="h-10 w-10 border border-border">
					<AvatarImage src={post.author.avatar} alt={post.author.username} />
					<AvatarFallback className="bg-secondary font-display text-sm font-semibold text-secondary-foreground">
						{post.author.first_name[0]}
						{post.author.last_name[0]}
					</AvatarFallback>
				</Avatar>
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5">
					<span className="truncate font-semibold leading-tight text-foreground">
						{post.author.first_name} {post.author.last_name}
					</span>
					<span className="truncate font-mono text-xs text-muted-foreground">
						@{post.author.username}
					</span>
				</div>
				<TooltipProvider>
					<Tooltip>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<TooltipTrigger asChild>
									<button
										type="button"
										className="font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground/80 transition-colors hover:text-primary"
									>
										{formatDistanceToNow(post.created, { addSuffix: true })}
									</button>
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
							<p className="font-mono text-xs">{format(post.created, 'PPpp')}</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
		</div>
	)
}

export default PostHeader
