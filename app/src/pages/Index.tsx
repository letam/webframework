import type React from 'react'
import Navbar from '@/components/Navbar'
import Feed from '@/components/Feed'
import PullToRefresh from '@/components/PullToRefresh'

const Index: React.FC = () => {
	return (
		<PullToRefresh>
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
