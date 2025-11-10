import type React from 'react'
import { useId, useMemo, useState } from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, editPost, removePost, setPosts } = usePosts()
	const [filterText, setFilterText] = useState('')
	const filterInputId = useId()

	const filteredPosts = useMemo(() => {
		if (!filterText.trim()) {
			return posts
		}

		const normalizedFilter = filterText.trim().toLowerCase()

		return posts.filter((post) => {
			const fieldsToSearch: Array<string | undefined | null> = [
				post.head,
				post.body,
				post.media?.transcript,
				post.media?.alt_text,
			]

			return fieldsToSearch.some((field) => field?.toLowerCase().includes(normalizedFilter))
		})
	}, [filterText, posts])

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
		setPosts((prevPosts) =>
			prevPosts.map((post) => (post.id === updatedPost.id ? updatedPost : post))
		)
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

	const handleEditPost = async (
		id: number,
		head: string,
		body: string,
		transcript?: string,
		altText?: string
	) => {
		try {
			const post = posts.find((p) => p.id === id)
			if (!post) {
				throw new Error('Post not found')
			}
			editPost(id, { head, body, transcript, alt_text: altText })
			toast.success('Post updated successfully')
		} catch (error) {
			console.error('Failed to update post:', error)
			toast.error('Failed to update post')
		}
	}

	return (
		<div className="max-w-2xl mx-auto">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="my-6 max-w-lg mx-auto">
				<label
					className="block text-sm font-medium text-muted-foreground mb-2"
					htmlFor={filterInputId}
				>
					Filter posts
				</label>
				<input
					id={filterInputId}
					className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40"
					type="text"
					placeholder="Search posts by content..."
					value={filterText}
					onChange={(event) => setFilterText(event.target.value)}
					aria-label="Filter posts by text"
				/>
			</div>

			<div className="space-y-4 my-6">
				{isLoading ? (
					<div className="max-w-2xl mx-auto text-center py-8">Loading posts...</div>
				) : filteredPosts.length > 0 ? (
					filteredPosts.map((post) => (
						<Post
							key={post.id}
							post={post}
							onLike={handleLike}
							onDelete={handleDeletePost}
							onEdit={handleEditPost}
							onTranscribed={handlePostTranscribed}
						/>
					))
				) : (
					<div className="max-w-2xl mx-auto text-center py-8 text-muted-foreground">
						No posts match the current filter.
					</div>
				)}
			</div>
		</div>
	)
}

export default Feed
