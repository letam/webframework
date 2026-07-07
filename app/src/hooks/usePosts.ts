import { useCallback, useEffect, useMemo } from 'react'
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
	type InfiniteData,
	type QueryKey,
} from '@tanstack/react-query'
import type { Post, CreatePostRequest, UpdatePostRequest } from '../types/post'
import {
	getPosts,
	createPost,
	deletePost,
	updatePost,
	likePost,
	unlikePost,
	type PostsPage,
	type PostsQueryScope,
} from '../lib/api/posts'
import type { TagInfo } from '../types/tag'
import { buildTagIndex } from '../utils/tags'

export const POSTS_QUERY_KEY = ['posts'] as const
export const POST_TAGS_QUERY_KEY = ['posts', 'tags'] as const

const DEFAULT_POSTS_SCOPE: PostsQueryScope = {}
const UNSCOPED_POSTS_QUERY_KEY = [...POSTS_QUERY_KEY, DEFAULT_POSTS_SCOPE] as const

export interface UsePostsOptions {
	enabled?: boolean
}

const normalizeScope = (scope: PostsQueryScope): PostsQueryScope => ({
	...(scope.author != null ? { author: scope.author } : {}),
	...(scope.liked ? { liked: true } : {}),
})

const getPostsQueryKey = (scope: PostsQueryScope) => [...POSTS_QUERY_KEY, scope] as const

const isPostsScope = (value: unknown): value is PostsQueryScope =>
	value != null && typeof value === 'object' && !Array.isArray(value)

const isPostsQueryKey = (queryKey: QueryKey) =>
	queryKey.length === 2 && queryKey[0] === POSTS_QUERY_KEY[0] && isPostsScope(queryKey[1])

const getScopeFromQueryKey = (queryKey: QueryKey): PostsQueryScope =>
	isPostsQueryKey(queryKey) ? (queryKey[1] as PostsQueryScope) : {}

const isUnscopedScope = (scope: PostsQueryScope) => scope.author == null && !scope.liked

const flattenPosts = (data?: InfiniteData<PostsPage>) =>
	data?.pages.flatMap((page) => page.posts) ?? []

const mapPages = (
	data: InfiniteData<PostsPage>,
	transform: (posts: Post[]) => Post[]
): InfiniteData<PostsPage> => ({
	...data,
	pages: data.pages.map((page) => ({
		...page,
		posts: transform(page.posts),
	})),
})

const shouldPrependPostToScope = (scope: PostsQueryScope, post: Post) => {
	if (scope.liked) {
		return false
	}

	return scope.author == null || scope.author === post.author.id
}

export const usePosts = (
	scope: PostsQueryScope = DEFAULT_POSTS_SCOPE,
	options: UsePostsOptions = {}
) => {
	const queryClient = useQueryClient()
	const enabled = options.enabled ?? true
	const normalizedScope = useMemo(() => normalizeScope(scope), [scope.author, scope.liked])
	const queryKey = useMemo(() => getPostsQueryKey(normalizedScope), [normalizedScope])

	const updateTagsCacheFromPosts = useCallback(
		(posts: Post[]) => {
			queryClient.setQueryData<TagInfo[]>(POST_TAGS_QUERY_KEY, buildTagIndex(posts))
		},
		[queryClient]
	)

	const updateTagsCacheFromFeed = useCallback(() => {
		const feedData = queryClient.getQueryData<InfiniteData<PostsPage>>(UNSCOPED_POSTS_QUERY_KEY)
		updateTagsCacheFromPosts(flattenPosts(feedData))
	}, [queryClient, updateTagsCacheFromPosts])

	const updatePostsCaches = useCallback(
		(transform: (posts: Post[]) => Post[]) => {
			queryClient.setQueriesData<InfiniteData<PostsPage>>(
				{ queryKey: POSTS_QUERY_KEY, predicate: (query) => isPostsQueryKey(query.queryKey) },
				(data) => (data ? mapPages(data, transform) : data)
			)
			updateTagsCacheFromFeed()
		},
		[queryClient, updateTagsCacheFromFeed]
	)

	const {
		data,
		isLoading,
		isFetching,
		error,
		refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useInfiniteQuery<PostsPage, Error>({
		queryKey,
		queryFn: ({ pageParam }) => getPosts(normalizedScope, pageParam as string | null),
		initialPageParam: null,
		getNextPageParam: (last) => last.next,
		staleTime: 60_000,
		enabled,
	})

	const posts = useMemo(() => (enabled ? flattenPosts(data) : []), [data, enabled])

	useEffect(() => {
		if (enabled && isUnscopedScope(normalizedScope)) {
			updateTagsCacheFromPosts(posts)
		}
	}, [enabled, normalizedScope, posts, updateTagsCacheFromPosts])

	const addPostMutation = useMutation({
		mutationFn: (postData: CreatePostRequest) => createPost(postData),
		onSuccess: (newPost) => {
			const queries = queryClient.getQueriesData<InfiniteData<PostsPage>>({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) => isPostsQueryKey(query.queryKey),
			})

			for (const [cachedQueryKey, cachedData] of queries) {
				if (!cachedData || !shouldPrependPostToScope(getScopeFromQueryKey(cachedQueryKey), newPost)) {
					continue
				}

				queryClient.setQueryData<InfiniteData<PostsPage>>(cachedQueryKey, {
					...cachedData,
					pages: cachedData.pages.map((page, index) =>
						index === 0 ? { ...page, posts: [newPost, ...page.posts] } : page
					),
				})
			}

			updateTagsCacheFromFeed()
		},
	})

	const editPostMutation = useMutation({
		mutationFn: ({ id, data }: { id: number; data: UpdatePostRequest }) => updatePost(id, data),
		onSuccess: (updatedPost) => {
			updatePostsCaches((prev = []) =>
				prev.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
		},
	})

	const removePostMutation = useMutation({
		mutationFn: (id: number) => deletePost(id),
		onSuccess: (_, id) => {
			updatePostsCaches((prev = []) => prev.filter((post) => post.id !== id))
		},
	})

	const likeMutation = useMutation({
		mutationFn: ({ id, liked }: { id: number; liked: boolean }) =>
			liked ? likePost(id) : unlikePost(id),
		onMutate: async ({ id, liked }) => {
			await queryClient.cancelQueries({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) => isPostsQueryKey(query.queryKey),
			})
			const previousPosts = queryClient.getQueriesData<InfiniteData<PostsPage>>({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) => isPostsQueryKey(query.queryKey),
			})
			updatePostsCaches((prev = []) =>
				prev.map((post) =>
					post.id === id
						? { ...post, liked, like_count: Math.max(0, post.like_count + (liked ? 1 : -1)) }
						: post
				)
			)
			return { previousPosts }
		},
		onError: (_error, _variables, context) => {
			for (const [cachedQueryKey, cachedData] of context?.previousPosts ?? []) {
				queryClient.setQueryData(cachedQueryKey, cachedData)
			}
			updateTagsCacheFromFeed()
		},
		onSuccess: (result, { id }) => {
			updatePostsCaches((prev = []) =>
				prev.map((post) =>
					post.id === id ? { ...post, liked: result.liked, like_count: result.like_count } : post
				)
			)
			// Liked-scoped queries are a server-side filter, so a toggle changes
			// membership, not just the flag: drop unliked posts immediately and
			// refetch on like (the right cursor position is unknowable client-side).
			const likedScopeQueries = queryClient.getQueriesData<InfiniteData<PostsPage>>({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) =>
					isPostsQueryKey(query.queryKey) &&
					Boolean(getScopeFromQueryKey(query.queryKey).liked),
			})
			for (const [cachedQueryKey, cachedData] of likedScopeQueries) {
				if (result.liked) {
					queryClient.invalidateQueries({ queryKey: cachedQueryKey, exact: true })
				} else if (cachedData) {
					queryClient.setQueryData(
						cachedQueryKey,
						mapPages(cachedData, (posts) => posts.filter((post) => post.id !== id))
					)
				}
			}
		},
	})

	const setPosts = useCallback(
		(updater: (prevPosts: Post[]) => Post[]) => {
			updatePostsCaches(updater)
		},
		[updatePostsCaches]
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

	const findCachedPost = useCallback(
		(id: number) => {
			const queries = queryClient.getQueriesData<InfiniteData<PostsPage>>({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) => isPostsQueryKey(query.queryKey),
			})

			return queries
				.flatMap(([, cachedData]) => flattenPosts(cachedData))
				.find((post) => post.id === id)
		},
		[queryClient]
	)

	const toggleLike = useCallback(
		(id: number) => {
			const post = findCachedPost(id)
			if (!post) return
			likeMutation.mutate({ id, liked: !post.liked })
		},
		[findCachedPost, likeMutation]
	)

	return {
		posts,
		isLoading,
		error,
		fetchPosts: refetch,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
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
