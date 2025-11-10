import type React from 'react'
import { useCallback, useId } from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'
import { usePostFilters } from '@/hooks/usePostFilters'
import { FilterControls } from './feed/FilterControls'
import { ActiveFiltersList } from './feed/ActiveFiltersList'

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, editPost, removePost, setPosts } = usePosts()
	const filterInputId = useId()
	const matchModeFieldName = useId()

	const {
		filterText,
		setFilterText,
		filters,
		tagFilters,
		matchMode,
		setMatchMode,
		filteredPosts,
		postCountLabel,
		addFiltersFromText,
		removeFilter,
		clearFilters,
		toggleFilter,
		applyTagFilters,
	} = usePostFilters(posts)

	const handleAddFilters = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault()

			addFiltersFromText(filterText)

			// Focus back on input
			document.getElementById(filterInputId)?.focus()
		},
		[addFiltersFromText, filterInputId, filterText]
	)

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
				<FilterControls
					filterInputId={filterInputId}
					matchModeFieldName={matchModeFieldName}
					filterText={filterText}
					onFilterTextChange={setFilterText}
					onSubmit={handleAddFilters}
					matchMode={matchMode}
					onMatchModeChange={(mode) => setMatchMode(mode)}
					selectedTags={tagFilters.map((filter) => filter.token)}
					onTagsSubmit={applyTagFilters}
					disabled={isLoading}
				/>

				<ActiveFiltersList
					filters={filters}
					onToggleFilter={toggleFilter}
					onRemoveFilter={removeFilter}
					onClearFilters={clearFilters}
				/>
			</div>

			{!isLoading && postCountLabel && (
				<div className="text-sm text-muted-foreground mb-4 text-center">{postCountLabel}</div>
			)}

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
			{/* Bottom padding */}
			<div className="h-96"></div>
		</div>
	)
}

export default Feed
