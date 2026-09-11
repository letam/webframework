import type React from 'react'
import { useQuery } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import { LoginModal } from '@/components/LoginModal'
import { DraftsList } from '@/components/drafts/DraftsList'
import { useAuth } from '@/hooks/useAuth'
import { getAuthorStats } from '@/lib/api/posts'
import { getProfileStatsQueryKey } from '@/hooks/usePosts'

const DraftsPage: React.FC = () => {
	const { isAuthenticated, userId } = useAuth()
	const enabled = isAuthenticated && userId != null

	// The list is paginated, so its length only counts loaded pages. The server
	// aggregate is the only honest total to put next to the heading.
	const { data: stats } = useQuery({
		queryKey: getProfileStatsQueryKey(userId),
		queryFn: () => getAuthorStats(userId as number),
		enabled,
	})

	return (
		<div className="min-h-screen bg-background">
			<Navbar />
			<div className="container px-4 py-4">
				{enabled ? (
					<div className="max-w-[600px] mx-auto">
						<div className="flex items-baseline justify-between mb-4">
							<h1 className="text-2xl font-bold">Drafts</h1>
							{stats != null && stats.draft_count > 0 && (
								<span className="text-sm text-muted-foreground">{stats.draft_count}</span>
							)}
						</div>
						<DraftsList enabled={enabled} />
						{/* Bottom padding */}
						<div className="h-96" />
					</div>
				) : (
					<div className="max-w-[600px] mx-auto">
						<div className="bg-card rounded-lg shadow-xs border p-8 mt-8 text-center">
							<h1 className="text-xl font-bold">Your drafts</h1>
							<p className="mt-2 text-muted-foreground">
								Log in to see the posts you have saved but not published.
							</p>
							<div className="mt-4 flex justify-center">
								<LoginModal />
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default DraftsPage
