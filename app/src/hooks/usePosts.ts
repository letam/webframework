import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Post, CreatePostRequest, UpdatePostRequest } from '../types/post'
import {
	getPosts,
	createPost,
	deletePost,
	updatePost,
	likePost,
	unlikePost,
} from '../lib/api/posts'
import type { TagInfo } from '../types/tag'
import { buildTagIndex } from '../utils/tags'

export const POSTS_QUERY_KEY = ['posts'] as const
export const POST_TAGS_QUERY_KEY = ['posts', 'tags'] as const

export const usePosts = () => {
	const queryClient = useQueryClient()

	const updateTagsCache = useCallback(
		(posts: Post[]) => {
			queryClient.setQueryData<TagInfo[]>(POST_TAGS_QUERY_KEY, buildTagIndex(posts))
		},
		[queryClient]
	)

	const updatePostsCache = useCallback(
		(updater: (prevPosts: Post[]) => Post[]) => {
			queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) => {
				const next = updater([...prev])
				updateTagsCache(next)
				return next
			})
		},
		[queryClient, updateTagsCache]
	)

	const {
		data: queryPosts = [],
		isLoading,
		isFetching,
		error,
		refetch,
	} = useQuery<Post[], Error>({
		queryKey: POSTS_QUERY_KEY,
		queryFn: getPosts,
		staleTime: 1000 * 60, // 1 minute
	})

	useEffect(() => {
		const existingTags = queryClient.getQueryData<TagInfo[]>(POST_TAGS_QUERY_KEY)

		if (!existingTags) {
			updateTagsCache(queryPosts)
		}
	}, [queryClient, queryPosts, updateTagsCache])

	const addPostMutation = useMutation({
		mutationFn: (postData: CreatePostRequest) => createPost(postData),
		onSuccess: (newPost) => {
			updatePostsCache((prev = []) => [newPost, ...prev])
		},
	})

	const editPostMutation = useMutation({
		mutationFn: ({ id, data }: { id: number; data: UpdatePostRequest }) => updatePost(id, data),
		onSuccess: (updatedPost) => {
			updatePostsCache((prev = []) =>
				prev.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
		},
	})

	const removePostMutation = useMutation({
		mutationFn: (id: number) => deletePost(id),
		onSuccess: (_, id) => {
			updatePostsCache((prev = []) => prev.filter((post) => post.id !== id))
		},
	})

	const likeMutation = useMutation({
		mutationFn: ({ id, liked }: { id: number; liked: boolean }) =>
			liked ? likePost(id) : unlikePost(id),
		onMutate: async ({ id, liked }) => {
			// Optimistically flip the heart; roll back from the snapshot on error
			await queryClient.cancelQueries({ queryKey: POSTS_QUERY_KEY })
			const previousPosts = queryClient.getQueryData<Post[]>(POSTS_QUERY_KEY)
			updatePostsCache((prev = []) =>
				prev.map((post) =>
					post.id === id
						? { ...post, liked, like_count: Math.max(0, post.like_count + (liked ? 1 : -1)) }
						: post
				)
			)
			return { previousPosts }
		},
		onError: (_error, _variables, context) => {
			if (context?.previousPosts) {
				queryClient.setQueryData(POSTS_QUERY_KEY, context.previousPosts)
			}
		},
		onSuccess: (result, { id }) => {
			// Reconcile with the server's authoritative count
			updatePostsCache((prev = []) =>
				prev.map((post) =>
					post.id === id ? { ...post, liked: result.liked, like_count: result.like_count } : post
				)
			)
		},
	})

	const setPosts = useCallback(
		(updater: (prevPosts: Post[]) => Post[]) => {
			updatePostsCache(updater)
		},
		[updatePostsCache]
	)

	const addPost = async (postData: CreatePostRequest) => {
		const newPost = await addPostMutation.mutateAsync(postData)
		return newPost
	}

	const editPost = async (id: number, data: UpdatePostRequest) => {
		await editPostMutation.mutateAsync({ id, data })
	}

	const removePost = async (id: number) => {
		await removePostMutation.mutateAsync(id)
	}

	const toggleLike = useCallback(
		(id: number) => {
			const post = queryClient.getQueryData<Post[]>(POSTS_QUERY_KEY)?.find((p) => p.id === id)
			if (!post) return
			likeMutation.mutate({ id, liked: !post.liked })
		},
		[queryClient, likeMutation]
	)

	return {
		posts: queryPosts,
		isLoading,
		error,
		fetchPosts: refetch,
		addPost,
		editPost,
		removePost,
		toggleLike,
		setPosts,
		isFetching,
		isMutating:
			addPostMutation.isPending || editPostMutation.isPending || removePostMutation.isPending,
	}
}
