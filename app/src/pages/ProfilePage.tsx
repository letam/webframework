import type React from 'react'
import Navbar from '@/components/Navbar'
import Profile from '@/components/Profile'

const ProfilePage: React.FC = () => {
	return (
		<div className="min-h-screen bg-background">
			<Navbar />
			<div className="container px-4 py-4">
				<Profile />
			</div>
		</div>
	)
}

export default ProfilePage
