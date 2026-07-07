import type React from 'react'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Post } from './post/Post'
import { LoginModal } from './LoginModal'
import { useAuth } from '@/hooks/useAuth'
import { usePostHandlers } from '@/hooks/usePostHandlers'
import { getAuthorStats } from '@/lib/api/posts'
import type { Post as PostType } from '@/types/post'
import { InfiniteScrollSentinel } from './feed/InfiniteScrollSentinel'

const Profile: React.FC = () => {
	const { isAuthenticated, userId, username } = useAuth()
	const profileQueriesEnabled = isAuthenticated && userId != null
	const mine = usePostHandlers(
		{ author: userId ?? undefined },
		{ enabled: profileQueriesEnabled }
	)
	const liked = usePostHandlers({ liked: true }, { enabled: profileQueriesEnabled })

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
	const error = mine.error ?? liked.error

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

	return (
		<div className="max-w-2xl mx-auto">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="bg-card rounded-lg shadow-xs overflow-hidden mb-4 border">
				<div className="h-32 bg-linear-to-r from-primary to-secondary" />

				<div className="p-4 relative">
					<Avatar className="absolute -top-16 border-4 border-background w-24 h-24">
						<AvatarFallback className="text-2xl">
							{(displayName[0] || username?.[0] || '?').toUpperCase()}
						</AvatarFallback>
					</Avatar>

					<div className="mt-10">
						<h1 className="text-xl font-bold">{displayName}</h1>
						<p className="text-muted-foreground">@{username}</p>
					</div>

					<div className="mt-4 flex gap-4 text-sm">
						<div>
							<span className="font-semibold">{postCount}</span>{' '}
							<span className="text-muted-foreground">
								{postCount === 1 ? 'Post' : 'Posts'}
							</span>
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
			</Tabs>

			{/* Bottom padding */}
			<div className="h-96"></div>
		</div>
	)
}

export default Profile
