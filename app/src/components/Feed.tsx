import type React from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, updatePost } = usePosts()

	const handlePostCreated = async (postData: CreatePostRequest) => {
		try {
			await addPost(postData)
		} catch (error) {
			console.error('Failed to create post:', error)
		}
	}

	const handleLike = (id: number) => {
		// TODO: Implement like functionality with backend
		console.log('Like post:', id)
	}

	const handlePostTranscribed = (updatedPost: PostType) => {
		updatePost(updatedPost)
	}

	if (isLoading) {
		return <div className="max-w-2xl mx-auto text-center py-8">Loading posts...</div>
	}

	if (error) {
		return (
			<div className="max-w-2xl mx-auto text-center py-8 text-red-500">Error: {error.message}</div>
		)
	}

	return (
		<div className="max-w-2xl mx-auto">
			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="space-y-4 my-6">
				{posts.map((post) => (
					<Post
						key={post.id}
						post={post}
						onLike={handleLike}
						onTranscribed={handlePostTranscribed}
					/>
				))}
			</div>
		</div>
	)
}

export default Feed
