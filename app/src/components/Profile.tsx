import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Loader2, MoreHorizontal, Pin, Trash2 } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/sonner'
import { Post } from './post/Post'
import { LoginModal } from './LoginModal'
import { useAuth } from '@/hooks/useAuth'
import { usePostHandlers } from '@/hooks/usePostHandlers'
import { getAuthorStats } from '@/lib/api/posts'
import { removeAvatar, uploadAvatar } from '@/lib/api/users'
import { identityGradient } from '@/lib/utils/identity'
import { cn } from '@/lib/utils'
import type { Post as PostType } from '@/types/post'
import { groupPostsByDate, type PostGroupMode } from '@/utils/postGroups'
import { InfiniteScrollSentinel } from './feed/InfiniteScrollSentinel'

type ProfilePostView = 'all' | PostGroupMode

const profilePostViewLabels: Record<ProfilePostView, string> = {
	all: 'All',
	weeks: 'Weeks',
	months: 'Months',
}

const Profile: React.FC = () => {
	const { isAuthenticated, userId, username, avatar, refreshAuthStatus } = useAuth()
	const queryClient = useQueryClient()
	const avatarInputRef = useRef<HTMLInputElement | null>(null)
	const [publishAllOpen, setPublishAllOpen] = useState(false)
	const [isPublishingAll, setIsPublishingAll] = useState(false)
	const [isAvatarUploading, setIsAvatarUploading] = useState(false)
	const [postView, setPostView] = useState<ProfilePostView>('all')
	const profileQueriesEnabled = isAuthenticated && userId != null
	const mine = usePostHandlers({ author: userId ?? undefined }, { enabled: profileQueriesEnabled })
	const pinned = usePostHandlers(
		{ author: userId ?? undefined, pinned: true },
		{ enabled: profileQueriesEnabled }
	)
	const liked = usePostHandlers({ liked: true }, { enabled: profileQueriesEnabled })
	const drafts = usePostHandlers({ drafts: true }, { enabled: profileQueriesEnabled })

	const myPosts = mine.posts
	const pinnedIds = useMemo(() => new Set(pinned.posts.map((post) => post.id)), [pinned.posts])
	const unpinnedPosts = useMemo(
		() => myPosts.filter((post) => !pinnedIds.has(post.id)),
		[myPosts, pinnedIds]
	)
	const groupedPosts = useMemo(
		() => (postView === 'all' ? [] : groupPostsByDate(myPosts, postView)),
		[myPosts, postView]
	)
	const mediaPosts = useMemo(() => myPosts.filter((post) => post.media), [myPosts])

	// The feed is paginated, so loaded posts undercount for prolific authors:
	// header totals come from a server aggregate, with the loaded pages as a
	// fallback while it loads.
	const { data: stats } = useQuery({
		queryKey: ['profile-stats', userId],
		queryFn: () => getAuthorStats(userId as number),
		enabled: profileQueriesEnabled,
		staleTime: 60_000,
	})
	const postCount = stats?.post_count ?? myPosts.length
	const likesReceived =
		stats?.likes_received ?? myPosts.reduce((total, post) => total + post.like_count, 0)

	const displayName = useMemo(() => {
		const author = myPosts[0]?.author
		const name = author ? `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim() : ''
		return name || username || ''
	}, [myPosts, username])
	const initials = useMemo(() => {
		const parts = displayName.split(/\s+/).filter(Boolean)
		const letters = parts
			.slice(0, 2)
			.map((part) => part[0])
			.join('')
		return (letters || username?.[0] || '?').toUpperCase()
	}, [displayName, username])
	const profileAvatar = avatar ?? myPosts[0]?.author.avatar ?? null
	const error = mine.error ?? pinned.error ?? liked.error ?? drafts.error

	if (!isAuthenticated) {
		return (
			<div className="max-w-2xl mx-auto">
				<div className="bg-card rounded-lg shadow-xs border p-8 mt-8 text-center">
					<h1 className="text-xl font-bold">Your profile</h1>
					<p className="mt-2 text-muted-foreground">
						Log in to see your posts, media, and likes in one place.
					</p>
					<div className="mt-4 flex justify-center">
						<LoginModal />
					</div>
				</div>
			</div>
		)
	}

	const renderPostCard = (post: PostType, source: typeof mine) => (
		<Post
			key={post.id}
			post={post}
			onLike={source.handleLike}
			onDelete={source.handleDeletePost}
			onEdit={source.handleEditPost}
			onPublish={source.handlePublishPost}
			onChangeVisibility={source.handleChangeVisibility}
			onPinChange={source.handlePinPost}
			onCopyShareLink={source.handleCopyShareLink}
			onResetShareLink={source.handleResetShareLink}
			onTranscribed={source.handlePostTranscribed}
		/>
	)

	const renderPosts = (list: PostType[], emptyMessage: string, source: typeof mine) => {
		if (source.isLoading) {
			return (
				<div className="space-y-4">
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
				</div>
			)
		}

		return (
			<>
				{list.length === 0 ? (
					<div className="p-8 text-center text-muted-foreground">{emptyMessage}</div>
				) : (
					list.map((post) => renderPostCard(post, source))
				)}
				<InfiniteScrollSentinel
					onLoadMore={() => source.fetchNextPage()}
					hasMore={source.hasNextPage}
					loading={source.isFetchingNextPage}
				/>
			</>
		)
	}

	const renderGroupedPosts = () => {
		if (mine.isLoading) {
			return (
				<div className="space-y-4">
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
				</div>
			)
		}

		return (
			<>
				{myPosts.length === 0 ? (
					<div className="p-8 text-center text-muted-foreground">
						You haven't posted anything yet.
					</div>
				) : (
					groupedPosts.map((group) => (
						<section key={group.label} className="space-y-3">
							<div className="max-w-lg mx-auto flex items-center gap-2 text-sm font-medium text-muted-foreground">
								<span>{group.label}</span>
								<span className="text-xs">
									{group.posts.length} {group.posts.length === 1 ? 'post' : 'posts'}
								</span>
							</div>
							{group.posts.map((post) => renderPostCard(post, mine))}
						</section>
					))
				)}
				<InfiniteScrollSentinel
					onLoadMore={() => mine.fetchNextPage()}
					hasMore={mine.hasNextPage}
					loading={mine.isFetchingNextPage}
				/>
			</>
		)
	}

	const renderAllPosts = () => {
		if (mine.isLoading) {
			return (
				<div className="space-y-4">
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
					<Skeleton className="h-32 w-full max-w-lg mx-auto" />
				</div>
			)
		}

		const hasPosts = pinned.posts.length > 0 || unpinnedPosts.length > 0

		return (
			<>
				{pinned.posts.length > 0 && (
					<div className="space-y-3">
						<div className="max-w-lg mx-auto flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
							<Pin className="h-3.5 w-3.5" />
							<span>Pinned</span>
						</div>
						{pinned.posts.map((post) => renderPostCard(post, pinned))}
					</div>
				)}
				{hasPosts ? (
					unpinnedPosts.map((post) => renderPostCard(post, mine))
				) : (
					<div className="p-8 text-center text-muted-foreground">
						You haven't posted anything yet.
					</div>
				)}
				<InfiniteScrollSentinel
					onLoadMore={() => mine.fetchNextPage()}
					hasMore={mine.hasNextPage}
					loading={mine.isFetchingNextPage}
				/>
			</>
		)
	}

	const handlePublishAll = async () => {
		setIsPublishingAll(true)
		try {
			for (const draft of drafts.posts) {
				await drafts.handlePublishPost(draft.id)
			}
			setPublishAllOpen(false)
		} finally {
			setIsPublishingAll(false)
		}
	}

	const refreshProfileAvatar = async () => {
		await refreshAuthStatus()
		await queryClient.invalidateQueries({ queryKey: ['profile-stats', userId] })
	}

	const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		setIsAvatarUploading(true)
		try {
			await uploadAvatar(file)
			await refreshProfileAvatar()
			toast.success('Profile photo updated.')
		} catch (error) {
			console.error('Failed to update profile photo:', error)
			toast.error('Failed to update profile photo')
		} finally {
			setIsAvatarUploading(false)
			event.target.value = ''
		}
	}

	const handleRemoveAvatar = async () => {
		setIsAvatarUploading(true)
		try {
			await removeAvatar()
			await refreshProfileAvatar()
			toast.success('Profile photo removed.')
		} catch (error) {
			console.error('Failed to remove profile photo:', error)
			toast.error('Failed to remove profile photo')
		} finally {
			setIsAvatarUploading(false)
		}
	}

	return (
		<div className="max-w-2xl mx-auto">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="bg-card rounded-lg shadow-xs overflow-hidden mb-4 border">
				<div className="h-32" style={{ background: identityGradient(username ?? '') }} />

				<div className="p-4 relative">
					<div className="group/avatar absolute -top-16 h-24 w-24">
						<Avatar className="h-24 w-24 border-4 border-background">
							<AvatarImage src={profileAvatar ?? undefined} alt={username ?? 'Profile photo'} />
							<AvatarFallback
								className="text-2xl text-white"
								style={{ background: identityGradient(username ?? '') }}
							>
								{initials}
							</AvatarFallback>
						</Avatar>
						{profileQueriesEnabled && (
							<>
								<button
									type="button"
									className="absolute inset-0 z-10 flex items-center justify-center rounded-full opacity-0 transition-opacity group-hover/avatar:opacity-100 focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-100"
									aria-label="Change profile photo"
									onClick={() => avatarInputRef.current?.click()}
									disabled={isAvatarUploading}
								>
									<span className="absolute inset-0 rounded-full bg-black/45" />
									{isAvatarUploading ? (
										<Loader2 className="relative h-5 w-5 animate-spin text-white" />
									) : (
										<Camera className="relative h-5 w-5 text-white" />
									)}
								</button>
								<input
									ref={avatarInputRef}
									type="file"
									accept="image/*"
									className="hidden"
									onChange={handleAvatarFileChange}
								/>
								{profileAvatar && (
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												type="button"
												variant="secondary"
												size="icon"
												className="absolute -bottom-1 -right-1 z-20 h-7 w-7 rounded-full shadow-sm"
												aria-label="Profile photo options"
												disabled={isAvatarUploading}
											>
												<MoreHorizontal className="h-4 w-4" />
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end">
											<DropdownMenuItem onClick={() => void handleRemoveAvatar()}>
												<Trash2 className="mr-2 h-4 w-4" />
												Remove photo
											</DropdownMenuItem>
										</DropdownMenuContent>
									</DropdownMenu>
								)}
							</>
						)}
					</div>

					<div className="mt-10">
						<h1 className="text-xl font-bold">{displayName}</h1>
						<p className="text-muted-foreground">@{username}</p>
					</div>

					<div className="mt-4 flex gap-4 text-sm">
						<div>
							<span className="font-semibold">{postCount}</span>{' '}
							<span className="text-muted-foreground">{postCount === 1 ? 'Post' : 'Posts'}</span>
						</div>
						<div>
							<span className="font-semibold">{likesReceived}</span>{' '}
							<span className="text-muted-foreground">
								{likesReceived === 1 ? 'Like received' : 'Likes received'}
							</span>
						</div>
					</div>
				</div>
			</div>

			<Tabs defaultValue="posts">
				<TabsList className="w-full">
					<TabsTrigger value="posts" className="flex-1">
						Posts
					</TabsTrigger>
					<TabsTrigger value="media" className="flex-1">
						Media
					</TabsTrigger>
					<TabsTrigger value="likes" className="flex-1">
						Likes
					</TabsTrigger>
					<TabsTrigger value="drafts" className="flex-1">
						Drafts
					</TabsTrigger>
				</TabsList>

				<TabsContent value="posts" className="space-y-4 mt-4">
					<div
						className="max-w-lg mx-auto flex items-center gap-1 rounded-full bg-muted p-1"
						role="radiogroup"
						aria-label="Post timeline grouping"
					>
						{(['all', 'weeks', 'months'] as const).map((mode) => (
							<label
								key={mode}
								className={cn(
									'inline-flex flex-1 cursor-pointer items-center justify-center rounded-full px-3 py-1 text-xs font-medium ring-offset-background transition-colors focus-within:outline-hidden focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
									postView === mode
										? 'bg-background text-foreground shadow-xs'
										: 'text-muted-foreground hover:text-foreground'
								)}
							>
								<input
									type="radio"
									value={mode}
									checked={postView === mode}
									onChange={() => setPostView(mode)}
									className="sr-only"
								/>
								<span>{profilePostViewLabels[mode]}</span>
							</label>
						))}
					</div>
					{postView === 'all' ? renderAllPosts() : renderGroupedPosts()}
				</TabsContent>

				<TabsContent value="media" className="space-y-4 mt-4">
					{renderPosts(mediaPosts, "You haven't posted any media yet.", mine)}
				</TabsContent>

				<TabsContent value="likes" className="space-y-4 mt-4">
					{renderPosts(liked.posts, 'Posts you like will show up here.', liked)}
				</TabsContent>

				<TabsContent value="drafts" className="space-y-4 mt-4">
					{drafts.posts.length > 1 && (
						<div className="max-w-lg mx-auto flex justify-end">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={() => setPublishAllOpen(true)}
							>
								Publish all
							</Button>
						</div>
					)}
					{renderPosts(
						drafts.posts,
						'No drafts yet. Drafts you save from the composer land here.',
						drafts
					)}
				</TabsContent>
			</Tabs>

			<AlertDialog open={publishAllOpen} onOpenChange={setPublishAllOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Publish {drafts.posts.length} drafts?</AlertDialogTitle>
						<AlertDialogDescription>
							This will publish each draft and move it into your public post list.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPublishingAll}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => void handlePublishAll()} disabled={isPublishingAll}>
							Publish
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Bottom padding */}
			<div className="h-96"></div>
		</div>
	)
}

export default Profile
