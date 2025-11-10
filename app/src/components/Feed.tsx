import type React from 'react'
import { useCallback, useId } from 'react'
import { cn } from '@/lib/utils'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'
import { TagFilterPopover } from './feed/TagFilterPopover'
import { usePostFilters } from '@/hooks/usePostFilters'

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
				<form onSubmit={handleAddFilters}>
					<label
						className="block text-sm font-medium text-muted-foreground mb-2"
						htmlFor={filterInputId}
					>
						Filter posts
					</label>
					<div className="flex flex-wrap items-center gap-2">
						<input
							id={filterInputId}
							className="flex-1 min-w-0 rounded-md border border-input bg-background px-3 py-2 text-base shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40 sm:text-sm"
							type="text"
							placeholder="Enter words to filter posts…"
							value={filterText}
							onChange={(event) => setFilterText(event.target.value)}
							aria-label="Add a filter term for posts"
						/>
						<button
							type="submit"
							className="inline-flex min-w-[96px] items-center justify-center rounded-md bg-primary px-5 py-2 text-base font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:px-3 sm:text-sm"
						>
							Apply
						</button>

						<div className="flex w-full flex-row items-center gap-2">
							<div className="flex items-center gap-2 rounded-md px-3 py-2 sm:bg-background/80 sm:px-2 sm:py-1">
								<button
									type="button"
									onClick={() => setMatchMode((prev) => (prev === 'and' ? 'or' : 'and'))}
									tabIndex={-1}
									className="text-xs font-medium tracking-wide text-muted-foreground transition-colors hover:text-foreground active:text-foreground sm:text-sm"
									aria-label={`Toggle match mode (currently ${
										matchMode === 'and' ? 'match all' : 'match any'
									})`}
								>
									Match on
								</button>
								<div
									className="flex items-center gap-1"
									role="radiogroup"
									aria-label="Filter match mode"
								>
									<label
										className={cn(
											'inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs sm:text-sm font-medium transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
											matchMode === 'and'
												? 'bg-primary text-primary-foreground hover:bg-primary/90'
												: 'bg-muted text-muted-foreground hover:bg-muted/70'
										)}
									>
										<input
											type="radio"
											name={matchModeFieldName}
											value="and"
											checked={matchMode === 'and'}
											onChange={() => setMatchMode('and')}
											className="sr-only"
										/>
										<span>All</span>
									</label>
									<label
										className={cn(
											'inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-xs sm:text-sm font-medium transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
											matchMode === 'or'
												? 'bg-primary text-primary-foreground hover:bg-primary/90'
												: 'bg-muted text-muted-foreground hover:bg-muted/70'
										)}
									>
										<input
											type="radio"
											name={matchModeFieldName}
											value="or"
											checked={matchMode === 'or'}
											onChange={() => setMatchMode('or')}
											className="sr-only"
										/>
										<span>Any</span>
									</label>
								</div>
							</div>
							<TagFilterPopover
								selectedTags={tagFilters.map((filter) => filter.token)}
								onSubmit={applyTagFilters}
							/>
						</div>
					</div>
				</form>

				<div className="space-y-3 mt-1">
					{filters.length > 0 && (
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Active filters{' '}
								<button
									type="button"
									onClick={clearFilters}
									className="text-sm font-medium text-primary hover:underline"
								>
									(Clear all)
								</button>
								:
							</span>
							{filters.map((filter) => (
								<div
									key={filter.token}
									className="relative inline-flex text-sm text-secondary-foreground"
								>
									<button
										type="button"
										onClick={() => toggleFilter(filter.token)}
										className={cn(
											'inline-flex items-center rounded-full px-3 py-1 pr-7 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
											filter.enabled
												? 'bg-primary text-primary-foreground hover:bg-primary/90'
												: 'bg-muted text-muted-foreground hover:bg-muted/70'
										)}
										aria-label={`${filter.enabled ? 'Disable' : 'Enable'} filter ${filter.token}`}
									>
										<span>{filter.token}</span>
									</button>
									<button
										type="button"
										onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
											event.stopPropagation()
											removeFilter(filter.token)
										}}
										className={cn(
											'absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-base leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
											filter.enabled
												? 'text-primary-foreground hover:bg-primary-foreground/80 hover:text-primary'
												: 'text-muted-foreground hover:bg-muted-foreground hover:text-background'
										)}
										aria-label={`Remove filter ${filter.token}`}
									>
										<span aria-hidden="true">&times;</span>
									</button>
								</div>
							))}
						</div>
					)}
				</div>
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
