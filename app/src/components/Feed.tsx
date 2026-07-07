import type React from 'react'
import { useCallback } from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePostHandlers } from '../hooks/usePostHandlers'
import type { CreatePostRequest } from '@/types/post'
import { usePostFilters } from '@/hooks/usePostFilters'
import { FilterControls } from './feed/FilterControls'
import { ActiveFiltersList } from './feed/ActiveFiltersList'
import { InfiniteScrollSentinel } from './feed/InfiniteScrollSentinel'

const Feed: React.FC = () => {
	const {
		posts,
		isLoading,
		error,
		addPost,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		handleLike,
		handleDeletePost,
		handleEditPost,
		handlePostTranscribed,
	} = usePostHandlers()

	const {
		filterText,
		setFilterText,
		filters,
		tagFilters,
		matchMode,
		setMatchMode,
		filteredPosts,
		filteredPostCount,
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
		},
		[addFiltersFromText, filterText]
	)

	const handlePostCreated = async (postData: CreatePostRequest) => {
		try {
			await addPost(postData)
		} catch (error) {
			console.error('Failed to create post:', error)
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
					filterText={filterText}
					onFilterTextChange={setFilterText}
					onSubmit={handleAddFilters}
					matchMode={matchMode}
					onMatchModeChange={(mode) => setMatchMode(mode)}
					selectedTags={tagFilters.map((filter) => filter.token)}
					onTagsSubmit={applyTagFilters}
					disabled={isLoading}
					filters={filters}
					filteredPostCount={filteredPostCount}
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
				{!isLoading && (
					<InfiniteScrollSentinel
						onLoadMore={() => fetchNextPage()}
						hasMore={hasNextPage}
						loading={isFetchingNextPage}
					/>
				)}
			</div>
			{/* Bottom padding */}
			<div className="h-96"></div>
		</div>
	)
}

export default Feed
