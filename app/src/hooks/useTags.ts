import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { getPosts, type PostsPage } from '../lib/api/posts'
import type { TagInfo } from '../types/tag'
import { buildTagIndex } from '../utils/tags'
import { POST_TAGS_QUERY_KEY, POSTS_QUERY_KEY } from './usePosts'

const FEED_POSTS_QUERY_KEY = [...POSTS_QUERY_KEY, {}] as const

const flattenPosts = (data?: InfiniteData<PostsPage>) =>
	data?.pages.flatMap((page) => page.posts) ?? []

export const useTags = () => {
	const queryClient = useQueryClient()

	const {
		data: tags = [],
		error,
		isFetching,
		isLoading,
		refetch,
	} = useQuery<TagInfo[]>({
		queryKey: POST_TAGS_QUERY_KEY,
		queryFn: async () => {
			const cachedFeed = queryClient.getQueryData<InfiniteData<PostsPage>>(FEED_POSTS_QUERY_KEY)

			if (cachedFeed) {
				return buildTagIndex(flattenPosts(cachedFeed))
			}

			const firstPage = await getPosts()
			return buildTagIndex(firstPage.posts)
		},
		placeholderData: () => {
			const cachedFeed = queryClient.getQueryData<InfiniteData<PostsPage>>(FEED_POSTS_QUERY_KEY)
			return cachedFeed ? buildTagIndex(flattenPosts(cachedFeed)) : []
		},
		staleTime: 1000 * 60,
	})

	return {
		tags,
		isLoading,
		error,
		refetch,
		isFetching,
	}
}
