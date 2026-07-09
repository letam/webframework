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
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Author, Post } from '@/types/post'

interface PostHeaderProps {
	post: Post
}

const AuthorHoverCard: React.FC<{ author: Author; children: React.ReactNode }> = ({
	author,
	children,
}) => (
	<HoverCard openDelay={300} closeDelay={100}>
		<HoverCardTrigger asChild>{children}</HoverCardTrigger>
		<HoverCardContent align="start" className="w-auto min-w-56">
			<div className="flex items-center gap-3">
				<Avatar className="h-12 w-12">
					<AvatarImage src={author.avatar} alt={author.username} />
					<AvatarFallback>
						{author.first_name[0]}
						{author.last_name[0]}
					</AvatarFallback>
				</Avatar>
				<div>
					<div className="font-semibold">
						{author.first_name} {author.last_name}
					</div>
					<div className="text-sm text-muted-foreground">@{author.username}</div>
				</div>
			</div>
		</HoverCardContent>
	</HoverCard>
)

const PostHeader: React.FC<PostHeaderProps> = ({ post }) => {
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
			<AuthorHoverCard author={post.author}>
				<Avatar className="h-10 w-10">
					<AvatarImage src={post.author.avatar} alt={post.author.username} />
					<AvatarFallback>
						{post.author.first_name[0]}
						{post.author.last_name[0]}
					</AvatarFallback>
				</Avatar>
			</AuthorHoverCard>
			<div className="flex-1">
				<div className="flex items-center gap-1">
					<AuthorHoverCard author={post.author}>
						<span className="font-semibold">
							{post.author.first_name} {post.author.last_name}
						</span>
					</AuthorHoverCard>
					<span className="text-muted-foreground">@{post.author.username}</span>
				</div>
				<TooltipProvider>
					<Tooltip>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<TooltipTrigger asChild>
									<button
										type="button"
										className="rounded-sm text-sm text-muted-foreground cursor-pointer ring-offset-background transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
							<p>{format(post.created, 'PPpp')}</p>
						</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>
		</div>
	)
}

export default PostHeader
