import type React from 'react'
import { useCallback } from 'react'
import { format } from 'date-fns'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'
import { usePostFilters } from '@/hooks/usePostFilters'
import { FilterControls } from './feed/FilterControls'
import { ActiveFiltersList } from './feed/ActiveFiltersList'

const Masthead: React.FC = () => (
	<header className="relative mb-6 overflow-hidden pt-6">
		<div
			className="echo-field pointer-events-none absolute -right-24 -top-10 h-64 w-64 opacity-80"
			style={{ ['--echo-x' as string]: '60%', ['--echo-y' as string]: '40%' }}
			aria-hidden
		/>
		<div className="relative">
			<div className="flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.24em] text-muted-foreground">
				<span>Est. 2025 · Vol. I</span>
				<span className="hidden sm:inline">{format(new Date(), 'EEE · dd MMM yyyy')}</span>
			</div>
			<h1 className="mt-2 font-display text-[2.6rem] font-light leading-[0.95] tracking-tight text-foreground sm:text-[3.25rem]">
				Field <span className="italic text-primary">Recordings</span>
			</h1>
			<p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
				Voice notes, transcripts &amp; dispatches — sound made legible.
			</p>
			<hr className="rule-double mt-4" />
		</div>
	</header>
)

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, editPost, removePost, setPosts } = usePosts()

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
		<div className="mx-auto max-w-2xl">
			<Masthead />

			{error && (
				<div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-center font-mono text-sm text-destructive">
					Error: {error.message}
				</div>
			)}

			<div className="my-4">
				<CreatePost onPostCreated={handlePostCreated} />
			</div>

			<div className="mx-auto my-6 max-w-lg">
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
				<div className="mx-auto mb-4 flex max-w-lg items-center gap-3 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
					<span className="h-px flex-1 bg-border" />
					<span>{postCountLabel}</span>
					<span className="h-px flex-1 bg-border" />
				</div>
			)}

			<div className="my-6 space-y-4">
				{isLoading ? (
					<div className="mx-auto flex max-w-2xl flex-col items-center gap-3 py-12 text-center">
						<span className="eq text-primary">
							<span className="eq-bar" />
							<span className="eq-bar" />
							<span className="eq-bar" />
						</span>
						<span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
							Loading posts...
						</span>
					</div>
				) : filteredPosts.length > 0 ? (
					filteredPosts.map((post, index) => (
						<div
							key={post.id}
							className="reveal"
							style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
						>
							<Post
								post={post}
								onLike={handleLike}
								onDelete={handleDeletePost}
								onEdit={handleEditPost}
								onTranscribed={handlePostTranscribed}
							/>
						</div>
					))
				) : (
					<div className="mx-auto max-w-lg rounded-xl border border-dashed border-border bg-card/40 py-12 text-center">
						<p className="font-display text-lg italic text-foreground">Silence on the wire.</p>
						<p className="mt-1 font-mono text-xs uppercase tracking-wider text-muted-foreground">
							No posts match the current filter.
						</p>
					</div>
				)}
			</div>
			{/* Bottom padding */}
			<div className="h-96"></div>
		</div>
	)
}

export default Feed
