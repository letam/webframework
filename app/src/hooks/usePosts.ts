import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Post, CreatePostRequest, UpdatePostRequest } from '../types/post'
import { getPosts, createPost, deletePost, updatePost } from '../lib/api/posts'

const POSTS_QUERY_KEY = ['posts']

export const usePosts = () => {
	const queryClient = useQueryClient()

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

	const addPostMutation = useMutation({
		mutationFn: (postData: CreatePostRequest) => createPost(postData),
		onSuccess: (newPost) => {
			queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) => [newPost, ...prev])
		},
	})

	const editPostMutation = useMutation({
		mutationFn: ({ id, data }: { id: number; data: UpdatePostRequest }) => updatePost(id, data),
		onSuccess: (updatedPost) => {
			queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) =>
				prev.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
		},
	})

	const removePostMutation = useMutation({
		mutationFn: (id: number) => deletePost(id),
		onSuccess: (_, id) => {
			queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) =>
				prev.filter((post) => post.id !== id)
			)
		},
	})

	const setPosts = useCallback(
		(updater: (prevPosts: Post[]) => Post[]) => {
			queryClient.setQueryData<Post[]>(POSTS_QUERY_KEY, (prev = []) => updater([...prev]))
		},
		[queryClient]
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

	return {
		posts: queryPosts,
		isLoading,
		error,
		fetchPosts: refetch,
		addPost,
		editPost,
		removePost,
		setPosts,
		isFetching,
		isMutating:
			addPostMutation.isPending || editPostMutation.isPending || removePostMutation.isPending,
	}
}
