import type React from 'react'
import { useState } from 'react'
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
import { Post } from '@/components/post/Post'
import { InfiniteScrollSentinel } from '@/components/feed/InfiniteScrollSentinel'
import { usePostHandlers } from '@/hooks/usePostHandlers'

export const DRAFTS_EMPTY_MESSAGE = 'No drafts yet. Drafts you save from the composer land here.'

interface DraftsListProps {
	/** False while auth is unresolved or signed out, so the query stays idle. */
	enabled: boolean
}

/**
 * The drafts list, its publish-all action, and the confirmation dialog.
 *
 * Shared by the /drafts page and the profile's Drafts tab so the two cannot
 * drift apart; both mount the same `{ drafts: true }` query and therefore the
 * same TanStack cache entry.
 */
export const DraftsList: React.FC<DraftsListProps> = ({ enabled }) => {
	const drafts = usePostHandlers({ drafts: true }, { enabled })
	const [publishAllOpen, setPublishAllOpen] = useState(false)
	const [isPublishingAll, setIsPublishingAll] = useState(false)

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

	if (drafts.isLoading) {
		return (
			<div className="space-y-4">
				<Skeleton className="h-32 w-full max-w-lg mx-auto" />
				<Skeleton className="h-32 w-full max-w-lg mx-auto" />
			</div>
		)
	}

	return (
		<div className="space-y-4">
			{drafts.error && (
				<div className="text-center py-4 text-red-500">Error: {drafts.error.message}</div>
			)}

			{drafts.posts.length > 1 && (
				<div className="max-w-lg mx-auto flex justify-end">
					<Button type="button" variant="ghost" size="sm" onClick={() => setPublishAllOpen(true)}>
						Publish all
					</Button>
				</div>
			)}

			{drafts.posts.length === 0 ? (
				<div className="p-8 text-center text-muted-foreground">{DRAFTS_EMPTY_MESSAGE}</div>
			) : (
				<div className="-mx-4 sm:mx-0 space-y-0 sm:space-y-4">
					{drafts.posts.map((post) => (
						<Post
							key={post.id}
							post={post}
							onLike={drafts.handleLike}
							onDelete={drafts.handleDeletePost}
							onEdit={drafts.handleEditPost}
							onPublish={drafts.handlePublishPost}
							onChangeVisibility={drafts.handleChangeVisibility}
							onPinChange={drafts.handlePinPost}
							onCopyShareLink={drafts.handleCopyShareLink}
							onResetShareLink={drafts.handleResetShareLink}
							onTranscribed={drafts.handlePostTranscribed}
						/>
					))}
				</div>
			)}

			<InfiniteScrollSentinel
				onLoadMore={() => drafts.fetchNextPage()}
				hasMore={drafts.hasNextPage}
				loading={drafts.isFetchingNextPage}
			/>

			<AlertDialog open={publishAllOpen} onOpenChange={setPublishAllOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Publish {drafts.posts.length} drafts?</AlertDialogTitle>
						<AlertDialogDescription>
							This will publish each draft and move it into your public post list.
							{drafts.hasNextPage
								? ' Only the drafts loaded so far will be published — scroll the list to load the rest first.'
								: ''}
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
		</div>
	)
}
