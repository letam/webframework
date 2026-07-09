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
	publishPost as publishPostRequest,
	regenerateShareToken as regenerateShareTokenRequest,
	likePost,
	unlikePost,
	pinPost as pinPostRequest,
	unpinPost as unpinPostRequest,
	type PostsPage,
	type PostsQueryScope,
} from '../lib/api/posts'
import { toast } from '@/components/ui/sonner'
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
	...(scope.drafts ? { drafts: true } : {}),
	...(scope.drafts ? {} : scope.author != null ? { author: scope.author } : {}),
	...(scope.drafts ? {} : scope.liked ? { liked: true } : {}),
	...(scope.drafts ? {} : scope.pinned ? { pinned: true } : {}),
})

const shouldPrependPostToScope = (scope: PostsQueryScope, post: Post) => {
	if (scope.drafts) {
		return post.is_draft
	}

	if (post.is_draft || scope.liked) {
		return false
	}

	if (scope.pinned && !post.pinned_at) {
		return false
	}

	return scope.author == null || scope.author === post.author.id
}

const shouldAddPublishedPostToScope = (scope: PostsQueryScope, post: Post) => {
	if (scope.drafts || scope.liked) {
		return false
	}

	if (scope.pinned && !post.pinned_at) {
		return false
	}

	return scope.author == null || scope.author === post.author.id
}

const prependUniquePost = (posts: Post[], post: Post) => [
	post,
	...posts.filter((cachedPost) => cachedPost.id !== post.id),
]

const getPostsQueryKey = (scope: PostsQueryScope) => [...POSTS_QUERY_KEY, scope] as const

const isPostsScope = (value: unknown): value is PostsQueryScope =>
	value != null && typeof value === 'object' && !Array.isArray(value)

export const isPostsQueryKey = (queryKey: QueryKey) =>
	queryKey.length === 2 && queryKey[0] === POSTS_QUERY_KEY[0] && isPostsScope(queryKey[1])

const getScopeFromQueryKey = (queryKey: QueryKey): PostsQueryScope =>
	isPostsQueryKey(queryKey) ? (queryKey[1] as PostsQueryScope) : {}

const isUnscopedScope = (scope: PostsQueryScope) =>
	scope.author == null && !scope.liked && !scope.drafts && !scope.pinned

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

export const usePosts = (
	scope: PostsQueryScope = DEFAULT_POSTS_SCOPE,
	options: UsePostsOptions = {}
) => {
	const queryClient = useQueryClient()
	const enabled = options.enabled ?? true
	const { author, liked, drafts, pinned } = scope
	const normalizedScope = useMemo(
		() => normalizeScope({ author, liked, drafts, pinned }),
		[author, liked, drafts, pinned]
	)
	const queryKey = useMemo(() => getPostsQueryKey(normalizedScope), [normalizedScope])

	const updateTagsCacheFromPosts = useCallback(
		(posts: Post[]) => {
			queryClient.setQueryData<TagInfo[]>(POST_TAGS_QUERY_KEY, buildTagIndex(posts))
		},
		[queryClient]
	)

	const updateTagsCacheFromFeed = useCallback(() => {
		const feedData = queryClient.getQueryData<InfiniteData<PostsPage>>(UNSCOPED_POSTS_QUERY_KEY)
		// Mutating from a scoped view (e.g. Profile) before the feed has ever
		// loaded must not wipe the tag index with an empty post list.
		if (!feedData) return
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

	const invalidatePinnedScopes = useCallback(() => {
		queryClient.invalidateQueries({
			queryKey: POSTS_QUERY_KEY,
			predicate: (query) =>
				isPostsQueryKey(query.queryKey) && Boolean(getScopeFromQueryKey(query.queryKey).pinned),
		})
	}, [queryClient])

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
				if (
					!cachedData ||
					!shouldPrependPostToScope(getScopeFromQueryKey(cachedQueryKey), newPost)
				) {
					continue
				}

				queryClient.setQueryData<InfiniteData<PostsPage>>(cachedQueryKey, {
					...cachedData,
					pages: cachedData.pages.map((page, index) =>
						index === 0 ? { ...page, posts: prependUniquePost(page.posts, newPost) } : page
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

	const publishPostMutation = useMutation({
		mutationFn: (id: number) => publishPostRequest(id),
		onSuccess: (publishedPost) => {
			const queries = queryClient.getQueriesData<InfiniteData<PostsPage>>({
				queryKey: POSTS_QUERY_KEY,
				predicate: (query) => isPostsQueryKey(query.queryKey),
			})

			for (const [cachedQueryKey, cachedData] of queries) {
				if (!cachedData) {
					continue
				}

				const scope = getScopeFromQueryKey(cachedQueryKey)
				if (scope.drafts) {
					queryClient.setQueryData(
						cachedQueryKey,
						mapPages(cachedData, (posts) => posts.filter((post) => post.id !== publishedPost.id))
					)
					continue
				}

				if (!shouldAddPublishedPostToScope(scope, publishedPost)) {
					continue
				}

				queryClient.setQueryData<InfiniteData<PostsPage>>(cachedQueryKey, {
					...cachedData,
					pages: cachedData.pages.map((page, index) =>
						index === 0 ? { ...page, posts: prependUniquePost(page.posts, publishedPost) } : page
					),
				})
			}

			updateTagsCacheFromFeed()
		},
	})

	const regenerateShareTokenMutation = useMutation({
		mutationFn: (id: number) => regenerateShareTokenRequest(id),
		onSuccess: (updatedPost) => {
			updatePostsCaches((prev = []) =>
				prev.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
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
		onError: (error, _variables, context) => {
			for (const [cachedQueryKey, cachedData] of context?.previousPosts ?? []) {
				queryClient.setQueryData(cachedQueryKey, cachedData)
			}
			updateTagsCacheFromFeed()
			console.error('Failed to update like:', error)
			toast.error('Failed to update like')
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
					isPostsQueryKey(query.queryKey) && Boolean(getScopeFromQueryKey(query.queryKey).liked),
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

	const pinPostMutation = useMutation({
		mutationFn: ({ id, pinned }: { id: number; pinned: boolean }) =>
			pinned ? pinPostRequest(id) : unpinPostRequest(id),
		onSuccess: (updatedPost) => {
			updatePostsCaches((prev = []) =>
				prev.map((post) => (post.id === updatedPost.id ? updatedPost : post))
			)
			invalidatePinnedScopes()
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

	const publishPost = async (id: number) => {
		const publishedPost = await publishPostMutation.mutateAsync(id)
		return publishedPost
	}

	const regenerateShareToken = async (id: number) => {
		const updatedPost = await regenerateShareTokenMutation.mutateAsync(id)
		return updatedPost
	}

	const setPinned = async (id: number, pinned: boolean) => {
		const updatedPost = await pinPostMutation.mutateAsync({ id, pinned })
		return updatedPost
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
		publishPost,
		regenerateShareToken,
		setPinned,
		toggleLike,
		setPosts,
		isFetching,
		isMutating:
			addPostMutation.isPending ||
			editPostMutation.isPending ||
			removePostMutation.isPending ||
			publishPostMutation.isPending ||
			regenerateShareTokenMutation.isPending ||
			pinPostMutation.isPending,
	}
}
