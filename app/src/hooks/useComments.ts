import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Comment, Post } from '../types/post'
import { getComments, createComment, deleteComment } from '../lib/api/posts'
import { POSTS_QUERY_KEY } from './usePosts'

const commentsQueryKey = (postId: number) => [...POSTS_QUERY_KEY, postId, 'comments'] as const

export const useComments = (postId: number, enabled = true) => {
	const queryClient = useQueryClient()

	const {
		data: comments = [],
		isLoading,
		error,
	} = useQuery<Comment[], Error>({
		queryKey: commentsQueryKey(postId),
		queryFn: () => getComments(postId),
		enabled,
		staleTime: 1000 * 30,
	})

	const adjustCommentCount = (delta: number) => {
		queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) =>
			prev.map((post) =>
				post.id === postId
					? { ...post, comment_count: Math.max(0, post.comment_count + delta) }
					: post
			)
		)
	}

	const addCommentMutation = useMutation({
		mutationFn: (body: string) => createComment(postId, body),
		onSuccess: (newComment) => {
			queryClient.setQueryData<Comment[]>(commentsQueryKey(postId), (prev = []) => [
				...prev,
				newComment,
			])
			adjustCommentCount(1)
		},
	})

	const removeCommentMutation = useMutation({
		mutationFn: (commentId: number) => deleteComment(postId, commentId),
		onSuccess: (_, commentId) => {
			queryClient.setQueryData<Comment[]>(commentsQueryKey(postId), (prev = []) =>
				prev.filter((comment) => comment.id !== commentId)
			)
			adjustCommentCount(-1)
		},
	})

	return {
		comments,
		isLoading,
		error,
		addComment: addCommentMutation.mutateAsync,
		removeComment: removeCommentMutation.mutateAsync,
		isAddingComment: addCommentMutation.isPending,
	}
}
