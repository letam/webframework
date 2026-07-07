import { useCallback } from 'react'
import { toast } from '@/components/ui/sonner'
import type { PostsQueryScope } from '@/lib/api/posts'
import type { Post as PostType } from '@/types/post'
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

	const handlePostTranscribed = useCallback(
		(updatedPost: PostType) => {
			setPosts((prevPosts) =>
				prevPosts.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
		},
		[setPosts]
	)

	return {
		posts,
		isLoading,
		isFetching,
		error,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		addPost,
		handleLike,
		handleDeletePost,
		handleEditPost,
		handlePostTranscribed,
	}
}
