import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePostHandlers } from '../hooks/usePostHandlers'
import type { CreatePostRequest } from '@/types/post'
import { usePostFilters } from '@/hooks/usePostFilters'
import { useFeedKeyboard } from '@/hooks/useFeedKeyboard'
import { EchoMark } from '@/components/EchoMark'
import { FilterControls } from './feed/FilterControls'
import { ActiveFiltersList } from './feed/ActiveFiltersList'
import { InfiniteScrollSentinel } from './feed/InfiniteScrollSentinel'
import { KeyboardShortcutsDialog } from './feed/KeyboardShortcutsDialog'

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
		handleChangeVisibility,
		handlePublishPost,
		handlePinPost,
		handleCopyShareLink,
		handleResetShareLink,
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
		applyFilterSet,
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

	const handleTagClick = useCallback(
		(tag: string) => {
			addFiltersFromText(`#${tag}`)
		},
		[addFiltersFromText]
	)

	const [shortcutsOpen, setShortcutsOpen] = useState(false)

	const focusComposer = useCallback(() => {
		const el = document.querySelector<HTMLTextAreaElement>('[data-composer-input]')
		el?.focus()
		el?.scrollIntoView({ block: 'nearest' })
	}, [])

	const focusFilter = useCallback(() => {
		const el = document.querySelector<HTMLInputElement>('[data-feed-filter-input]')
		el?.focus()
		el?.select()
		el?.scrollIntoView({ block: 'nearest' })
	}, [])

	const { focusedIndex, setFocusedIndex } = useFeedKeyboard({
		postCount: filteredPosts.length,
		onLike: (index) => {
			const post = filteredPosts[index]
			if (post) {
				handleLike(post.id)
			}
		},
		onOpen: (index) => {
			const post = filteredPosts[index]
			if (post) {
				window.open(`/p/${post.id}/`, '_blank', 'noopener')
			}
		},
		onCompose: focusComposer,
		onFocusFilter: focusFilter,
		onShowHelp: () => setShortcutsOpen(true),
		onJumpToTop: () => window.scrollTo({ top: 0, behavior: 'smooth' }),
		enabled: !shortcutsOpen,
	})

	// The selection tracks a position, so drop it when the filter set changes and
	// a different post would slide under the ring. filters/matchMode are change
	// triggers here, not values the effect reads.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional change triggers, not reads
	useEffect(() => {
		setFocusedIndex(-1)
	}, [filters, matchMode])

	return (
		<div className="max-w-[600px] mx-auto" data-testid="feed">
			{error && <div className="text-center py-4 text-red-500 mb-4">Error: {error.message}</div>}

			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="my-4 max-w-lg mx-auto">
				<FilterControls
					filterText={filterText}
					onFilterTextChange={setFilterText}
					onSubmit={handleAddFilters}
					matchMode={matchMode}
					onMatchModeChange={(mode) => setMatchMode(mode)}
					onApplyFilterSet={applyFilterSet}
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
				<div className="text-sm text-muted-foreground mb-4 text-center animate-rise-in">
					{postCountLabel}
				</div>
			)}

			<div className="my-6 -mx-4 sm:mx-0 space-y-0 sm:space-y-4">
				{isLoading ? (
					<div className="space-y-0 sm:space-y-4">
						<span className="sr-only">Loading posts...</span>
						{[0, 1, 2].map((n) => (
							<div
								key={n}
								className="bg-card border-b border-border/60 p-4 animate-pulse sm:rounded-lg sm:border sm:shadow-xs"
								style={{ animationDelay: `${n * 120}ms` }}
							>
								<div className="flex items-center gap-2">
									<div className="h-10 w-10 rounded-full bg-muted" />
									<div className="space-y-1.5">
										<div className="h-3 w-32 rounded bg-muted" />
										<div className="h-3 w-20 rounded bg-muted" />
									</div>
								</div>
								<div className="mt-4 space-y-2">
									<div className="h-3 w-full rounded bg-muted" />
									<div className="h-3 w-2/3 rounded bg-muted" />
								</div>
							</div>
						))}
					</div>
				) : filteredPosts.length > 0 ? (
					filteredPosts.map((post, index) => (
						<Post
							key={post.id}
							post={post}
							focused={index === focusedIndex}
							onLike={handleLike}
							onDelete={handleDeletePost}
							onEdit={handleEditPost}
							onPublish={handlePublishPost}
							onChangeVisibility={handleChangeVisibility}
							onPinChange={handlePinPost}
							onCopyShareLink={handleCopyShareLink}
							onResetShareLink={handleResetShareLink}
							onTranscribed={handlePostTranscribed}
							onTagClick={handleTagClick}
						/>
					))
				) : posts.length === 0 ? (
					<div className="max-w-lg mx-auto px-4 text-center py-12 animate-rise-in">
						<EchoMark muted className="mx-auto h-12 w-12 text-muted-foreground/50" />
						<p className="mt-4 font-medium">It's quiet in here</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Be the first to say something — text, voice, or video.
						</p>
					</div>
				) : (
					<div className="max-w-lg mx-auto px-4 text-center py-12 text-muted-foreground animate-rise-in">
						No posts match the current filters.
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
			{!isLoading && filteredPosts.length > 0 && (
				<div className="hidden pt-2 text-center sm:block">
					<button
						type="button"
						onClick={() => setShortcutsOpen(true)}
						className="text-xs text-muted-foreground/70 transition-colors hover:text-foreground"
					>
						Press{' '}
						<kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">
							?
						</kbd>{' '}
						for keyboard shortcuts
					</button>
				</div>
			)}

			{/* Bottom padding */}
			<div className="h-96"></div>

			<KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</div>
	)
}

export default Feed
