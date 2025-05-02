import type React from 'react'
import { Link } from 'react-router'
import { Calendar, MapPin, Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Post } from './post/Post'

interface ProfileProps {
	username?: string
}

const Profile: React.FC<ProfileProps> = ({ username = 'user1' }) => {
	const posts = [
		{
			id: '101',
			text: 'Just shared my thoughts on the latest tech trends in my new podcast episode!',
			mediaType: 'audio' as const,
			mediaUrl:
				'https://citizen-dj.labs.loc.gov/audio/samplepacks/loc-fma/Mushrooms_fma-178531_001_00-00-01.mp3',
			timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
			username: 'user1',
			userAvatar: 'https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff',
			likes: 24,
		},
		{
			id: '102',
			text: 'Check out this beautiful sunset I captured yesterday!',
			mediaType: 'video' as const,
			mediaUrl: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
			timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
			username: 'user1',
			userAvatar: 'https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff',
			likes: 37,
		},
	]

	const handleLike = (id: string) => {
		// In a real app, this would update the like count in the state
		console.log(`Liked post ${id}`)
	}

	return (
		<div className="max-w-2xl mx-auto">
			<div className="bg-card rounded-lg shadow-xs overflow-hidden mb-4 border">
				<div className="h-32 bg-linear-to-r from-primary to-secondary" />

				<div className="p-4 relative">
					<Avatar className="absolute -top-16 border-4 border-background w-24 h-24">
						<AvatarImage
							src="https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff"
							alt={username}
						/>
						<AvatarFallback>{username[0]}</AvatarFallback>
					</Avatar>

					<div className="mt-10 flex items-center justify-between">
						<div>
							<h1 className="text-xl font-bold">User Name</h1>
							<p className="text-muted-foreground">@{username}</p>
						</div>

						<Button>Edit Profile</Button>
					</div>

					<p className="mt-4">
						Digital content creator and audio enthusiast. Sharing thoughts, ideas, and sounds with
						the world.
					</p>

					<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
						<div className="flex items-center">
							<MapPin className="h-4 w-4 mr-1" />
							<span>San Francisco, CA</span>
						</div>
						<div className="flex items-center">
							<LinkIcon className="h-4 w-4 mr-1" />
							<a href="https://example.com" className="text-primary">
								example.com
							</a>
						</div>
						<div className="flex items-center">
							<Calendar className="h-4 w-4 mr-1" />
							<span>Joined April 2025</span>
						</div>
					</div>

					<div className="mt-4 flex gap-4">
						<Link to="#" className="hover:underline">
							<span className="font-semibold">248</span>{' '}
							<span className="text-muted-foreground">Following</span>
						</Link>
						<Link to="#" className="hover:underline">
							<span className="font-semibold">1,024</span>{' '}
							<span className="text-muted-foreground">Followers</span>
						</Link>
					</div>
				</div>
			</div>

			<Tabs defaultValue="posts">
				<TabsList className="w-full">
					<TabsTrigger value="posts" className="flex-1">
						Posts
					</TabsTrigger>
					<TabsTrigger value="media" className="flex-1">
						Media
					</TabsTrigger>
					<TabsTrigger value="likes" className="flex-1">
						Likes
					</TabsTrigger>
				</TabsList>

				<TabsContent value="posts" className="space-y-4 mt-4">
					{posts.map((post) => (
						<Post
							key={post.id}
							id={post.id}
							text={post.text}
							mediaType={post.mediaType}
							mediaUrl={post.mediaUrl}
							timestamp={post.timestamp}
							username={post.username}
							userAvatar={post.userAvatar}
							likes={post.likes}
							onLike={handleLike}
						/>
					))}
				</TabsContent>

				<TabsContent value="media">
					<div className="p-8 text-center text-muted-foreground">
						Media tab content will appear here
					</div>
				</TabsContent>

				<TabsContent value="likes">
					<div className="p-8 text-center text-muted-foreground">
						Likes tab content will appear here
					</div>
				</TabsContent>
			</Tabs>
		</div>
	)
}

export default Profile
