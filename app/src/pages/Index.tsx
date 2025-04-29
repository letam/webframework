import type React from 'react'
import Navbar from '@/components/Navbar'
import Feed from '@/components/Feed'

const Index: React.FC = () => {
	return (
		<div className="min-h-screen bg-background">
			<Navbar />
			<div className="container px-4 py-4">
				<Feed />
			</div>
		</div>
	)
}

export default Index
