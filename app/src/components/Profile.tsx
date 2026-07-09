import type React from 'react'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Post } from './post/Post'
import { LoginModal } from './LoginModal'
import { useAuth } from '@/hooks/useAuth'
import { usePostHandlers } from '@/hooks/usePostHandlers'
import { getAuthorStats } from '@/lib/api/posts'
import { identityGradient } from '@/lib/utils/identity'
import type { Post as PostType } from '@/types/post'
import { InfiniteScrollSentinel } from './feed/InfiniteScrollSentinel'

const Profile: React.FC = () => {
	const { isAuthenticated, userId, username } = useAuth()
	const [publishAllOpen, setPublishAllOpen] = useState(false)
	const [isPublishingAll, setIsPublishingAll] = useState(false)
	const profileQueriesEnabled = isAuthenticated && userId != null
	const mine = usePostHandlers({ author: userId ?? undefined }, { enabled: profileQueriesEnabled })
	const liked = usePostHandlers({ liked: true }, { enabled: profileQueriesEnabled })
	const drafts = usePostHandlers({ drafts: true }, { enabled: profileQueriesEnabled })

	const myPosts = mine.posts
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
	const error = mine.error ?? liked.error ?? drafts.error

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
					list.map((post) => (
						<Post
							key={post.id}
							post={post}
							onLike={source.handleLike}
							onDelete={source.handleDeletePost}
							onEdit={source.handleEditPost}
							onPublish={source.handlePublishPost}
							onChangeVisibility={source.handleChangeVisibility}
							onCopyShareLink={source.handleCopyShareLink}
							onResetShareLink={source.handleResetShareLink}
							onTranscribed={source.handlePostTranscribed}
						/>
					))
				)}
				<InfiniteScrollSentinel
					onLoadMore={() => source.fetchNextPage()}
					hasMore={source.hasNextPage}
					loading={source.isFetchingNextPage}
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

	return (
		<div className="max-w-2xl mx-auto">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="bg-card rounded-lg shadow-xs overflow-hidden mb-4 border">
				<div className="h-32" style={{ background: identityGradient(username ?? '') }} />

				<div className="p-4 relative">
					<Avatar className="absolute -top-16 border-4 border-background w-24 h-24">
						<AvatarFallback
							className="text-2xl text-white"
							style={{ background: identityGradient(username ?? '') }}
						>
							{initials}
						</AvatarFallback>
					</Avatar>

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
					{renderPosts(myPosts, "You haven't posted anything yet.", mine)}
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
