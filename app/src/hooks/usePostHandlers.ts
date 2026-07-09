import { useCallback } from 'react'
import { toast } from '@/components/ui/sonner'
import { getShareUrl, transcribePost } from '@/lib/api/posts'
import type { PostsQueryScope } from '@/lib/api/posts'
import { getSettings } from '@/lib/utils/settings'
import type { CreatePostRequest, Post as PostType, PostVisibility } from '@/types/post'
import { useAuth } from './useAuth'
import { usePosts, type UsePostsOptions } from './usePosts'

/**
 * Shared post action handlers (like, delete, edit, transcribe) used by any
 * view that renders a list of posts (Feed, Profile).
 */
const DEFAULT_POSTS_SCOPE: PostsQueryScope = {}

export const usePostHandlers = (
	scope: PostsQueryScope = DEFAULT_POSTS_SCOPE,
	options: UsePostsOptions = {}
) => {
	const {
		posts,
		isLoading,
		isFetching,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		addPost,
		editPost,
		removePost,
		publishPost,
		regenerateShareToken,
		setPinned,
		toggleLike,
		setPosts,
	} = usePosts(scope, options)
	const { isAuthenticated } = useAuth()

	const handleLike = useCallback(
		(id: number) => {
			if (!isAuthenticated) {
				toast.info('Log in to like posts')
				return
			}
			toggleLike(id)
		},
		[isAuthenticated, toggleLike]
	)

	const handleDeletePost = useCallback(
		async (id: number) => {
			try {
				await removePost(id)
				toast.success('Post deleted successfully')
			} catch (error) {
				console.error('Failed to delete post:', error)
				toast.error('Failed to delete post')
			}
		},
		[removePost]
	)

	const handleEditPost = useCallback(
		async (id: number, head: string, body: string, transcript?: string, altText?: string) => {
			try {
				await editPost(id, { head, body, transcript, alt_text: altText })
				toast.success('Post updated successfully')
			} catch (error) {
				console.error('Failed to update post:', error)
				toast.error('Failed to update post')
			}
		},
		[editPost]
	)

	const handleChangeVisibility = useCallback(
		async (id: number, visibility: PostVisibility) => {
			try {
				await editPost(id, { visibility })
				toast.success('Visibility updated.')
			} catch (error) {
				console.error('Failed to update visibility:', error)
				toast.error('Failed to update visibility')
			}
		},
		[editPost]
	)

	const handlePublishPost = useCallback(
		async (id: number) => {
			try {
				await publishPost(id)
				toast.success('Post published.')
			} catch (error) {
				console.error('Failed to publish post:', error)
				toast.error('Failed to publish post')
			}
		},
		[publishPost]
	)

	const handleCopyShareLink = useCallback(async (post: PostType) => {
		try {
			await navigator.clipboard.writeText(getShareUrl(post))
			toast.success('Link copied to clipboard')
		} catch (error) {
			console.error('Failed to copy link:', error)
			toast.error('Failed to copy link')
		}
	}, [])

	const handleResetShareLink = useCallback(
		async (post: PostType) => {
			try {
				const updatedPost = await regenerateShareToken(post.id)
				await navigator.clipboard.writeText(getShareUrl(updatedPost))
				toast.success('New share link copied. Old links no longer work.')
			} catch (error) {
				console.error('Failed to reset share link:', error)
				toast.error('Failed to reset share link')
			}
		},
		[regenerateShareToken]
	)

	const handlePinPost = useCallback(
		async (id: number, pinned: boolean) => {
			try {
				await setPinned(id, pinned)
				toast.success(pinned ? 'Post pinned.' : 'Post unpinned.')
			} catch (error) {
				console.error('Failed to update pin:', error)
				toast.error(error instanceof Error ? error.message : 'Failed to update pin')
			}
		},
		[setPinned]
	)

	const handlePostTranscribed = useCallback(
		(updatedPost: PostType) => {
			setPosts((prevPosts) =>
				prevPosts.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
		},
		[setPosts]
	)

	const handleAddPost = useCallback(
		async (postData: CreatePostRequest) => {
			const newPost = await addPost(postData)
			const media = newPost.media
			const shouldAutoTranscribe =
				getSettings().autoTranscribe &&
				isAuthenticated &&
				media != null &&
				(media.media_type === 'audio' || media.media_type === 'video') &&
				!media.transcript_status

			if (shouldAutoTranscribe) {
				try {
					const updatedPost = await transcribePost(newPost.id)
					handlePostTranscribed(updatedPost)
				} catch (error) {
					console.error('Auto-transcription failed to start:', error)
					toast.error('Auto-transcription failed to start')
				}
			}
			return newPost
		},
		[addPost, handlePostTranscribed, isAuthenticated]
	)

	return {
		posts,
		isLoading,
		isFetching,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		addPost: handleAddPost,
		handleLike,
		handleDeletePost,
		handleEditPost,
		handleChangeVisibility,
		handlePublishPost,
		handlePinPost,
		handleCopyShareLink,
		handleResetShareLink,
		handlePostTranscribed,
	}
}
