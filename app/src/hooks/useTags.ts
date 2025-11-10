import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Post } from '../types/post'
import { getPosts } from '../lib/api/posts'
import type { TagInfo } from '../types/tag'
import { buildTagIndex } from '../utils/tags'
import { POST_TAGS_QUERY_KEY, POSTS_QUERY_KEY } from './usePosts'

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
			const posts = await queryClient.ensureQueryData<Post[]>({
				queryKey: POSTS_QUERY_KEY,
				queryFn: getPosts,
			})
			return buildTagIndex(posts)
		},
		placeholderData: () => {
			const posts = queryClient.getQueryData<Post[]>(POSTS_QUERY_KEY)
			return posts ? buildTagIndex(posts) : []
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
