import type React from 'react'
import { useState } from 'react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { Copy, ExternalLink, Link2, Lock } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { getAuthorStats, getShareUrl } from '@/lib/api/posts'
import { useAuth } from '@/hooks/useAuth'
import { identityGradient } from '@/lib/utils/identity'
import { formatShortTime } from '@/lib/utils/time'
import type { Author, Post } from '@/types/post'

interface PostHeaderProps {
	post: Post
}

const AuthorHoverCard: React.FC<{ author: Author; children: React.ReactNode }> = ({
	author,
	children,
}) => {
	const [open, setOpen] = useState(false)
	const { data: stats } = useQuery({
		queryKey: ['author-stats', author.id],
		queryFn: () => getAuthorStats(author.id),
		enabled: open,
		staleTime: 60_000,
	})

	return (
		<HoverCard openDelay={300} closeDelay={100} onOpenChange={setOpen}>
			<HoverCardTrigger asChild>{children}</HoverCardTrigger>
			<HoverCardContent align="start" className="w-64 overflow-hidden p-0">
				<div className="h-14" style={{ background: identityGradient(author.username) }} />
				<div className="p-3">
					<Avatar className="-mt-9 h-12 w-12 border-2 border-popover">
						<AvatarImage src={author.avatar} alt={author.username} />
						<AvatarFallback
							className="text-white"
							style={{ background: identityGradient(author.username) }}
						>
							{author.first_name[0]}
							{author.last_name[0]}
						</AvatarFallback>
					</Avatar>
					<div className="mt-2">
						<div className="font-semibold leading-tight">
							{author.first_name} {author.last_name}
						</div>
						<div className="text-sm text-muted-foreground">@{author.username}</div>
					</div>
					<div className="mt-2 flex gap-3 text-sm">
						<span>
							<span className="font-semibold tabular-nums">{stats?.post_count ?? '–'}</span>{' '}
							<span className="text-muted-foreground">
								{stats?.post_count === 1 ? 'post' : 'posts'}
							</span>
						</span>
						<span>
							<span className="font-semibold tabular-nums">{stats?.likes_received ?? '–'}</span>{' '}
							<span className="text-muted-foreground">
								{stats?.likes_received === 1 ? 'like' : 'likes'}
							</span>
						</span>
					</div>
				</div>
			</HoverCardContent>
		</HoverCard>
	)
}

const PostHeader: React.FC<PostHeaderProps> = ({ post }) => {
	const { isAuthenticated, userId, isSuperuser } = useAuth()
	const canSeeState = isAuthenticated && (userId === post.author.id || isSuperuser)
	const showVisibilityState = canSeeState && (post.is_draft || post.visibility !== 'public')
	const shareUrl = getShareUrl(post)

	const handleCopyLink = async () => {
		try {
			await navigator.clipboard.writeText(shareUrl)
			// You could add a toast notification here if you have one
		} catch (err) {
			console.error('Failed to copy link:', err)
		}
	}

	const handleOpenInNewTab = () => {
		window.open(shareUrl, '_blank', 'noopener,noreferrer')
	}

	return (
		<div className="flex items-center gap-2">
			<AuthorHoverCard author={post.author}>
				<Avatar className="h-10 w-10">
					<AvatarImage src={post.author.avatar} alt={post.author.username} />
					<AvatarFallback
						className="text-white"
						style={{ background: identityGradient(post.author.username) }}
					>
						{post.author.first_name[0]}
						{post.author.last_name[0]}
					</AvatarFallback>
				</Avatar>
			</AuthorHoverCard>
			<div className="flex-1">
				<div className="flex items-baseline gap-1.5">
					<AuthorHoverCard author={post.author}>
						<span className="text-[15px] font-semibold leading-tight">
							{post.author.first_name} {post.author.last_name}
						</span>
					</AuthorHoverCard>
					<span className="text-[13px] text-muted-foreground">@{post.author.username}</span>
				</div>
				<div className="flex items-center gap-1.5">
					<TooltipProvider>
						<Tooltip>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<TooltipTrigger asChild>
										<button
											type="button"
											className="rounded-sm text-[13px] text-muted-foreground cursor-pointer ring-offset-background transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
										>
											{formatShortTime(post.created)}
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
					{showVisibilityState &&
						(post.is_draft ? (
							<span className="rounded-full border px-1.5 py-0.5 text-[11px] font-medium leading-none text-muted-foreground">
								Draft
							</span>
						) : (
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<span className="inline-flex text-muted-foreground">
											{post.visibility === 'private' ? (
												<Lock className="h-3.5 w-3.5" />
											) : (
												<Link2 className="h-3.5 w-3.5" />
											)}
										</span>
									</TooltipTrigger>
									<TooltipContent>
										{post.visibility === 'private' ? 'Private' : 'Link only'}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						))}
				</div>
			</div>
		</div>
	)
}

export default PostHeader
