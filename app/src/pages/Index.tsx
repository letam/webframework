import type React from 'react'
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import Feed from '@/components/Feed'
import PullToRefresh from '@/components/PullToRefresh'
import { POSTS_QUERY_KEY } from '@/hooks/usePosts'

const Index: React.FC = () => {
	const queryClient = useQueryClient()

	// Soft refresh: refetch the feed in place rather than reloading the SPA (the
	// component's fallback), which would throw away the whole query cache.
	const handleRefresh = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY })
	}, [queryClient])

	return (
		<PullToRefresh onRefresh={handleRefresh}>
			<div className="min-h-screen bg-background">
				<Navbar />
				<div className="container px-4 py-4">
					<Feed />
				</div>
			</div>
		</PullToRefresh>
	)
}

export default Index
