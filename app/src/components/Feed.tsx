import type React from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, updatePost, removePost } = usePosts()

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

	const handleDeletePost = async (id: number) => {
		try {
			await removePost(id)
			toast.success('Post deleted successfully')
		} catch (error) {
			console.error('Failed to delete post:', error)
			toast.error('Failed to delete post')
		}
	}

	if (isLoading) {
		return <div className="max-w-2xl mx-auto text-center py-8">Loading posts...</div>
	}

	return (
		<div className="max-w-2xl mx-auto">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="space-y-4 my-6">
				{posts.map((post) => (
					<Post
						key={post.id}
						post={post}
						onLike={handleLike}
						onDelete={handleDeletePost}
						onTranscribed={handlePostTranscribed}
					/>
				))}
			</div>
		</div>
	)
}

export default Feed
