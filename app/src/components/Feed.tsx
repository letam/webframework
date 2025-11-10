import type React from 'react'
import { useCallback, useId, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Post } from './post/Post'
import CreatePost from './post/create'
import { usePosts } from '../hooks/usePosts'
import type { CreatePostRequest, Post as PostType } from '@/types/post'
import { toast } from '@/components/ui/sonner'

const Feed: React.FC = () => {
	const { posts, isLoading, error, addPost, editPost, removePost, setPosts } = usePosts()
	const [filterText, setFilterText] = useState('')
	const [filters, setFilters] = useState<Array<{ token: string; enabled: boolean }>>([])
	const [matchMode, setMatchMode] = useState<'and' | 'or'>('and')
	const filterInputId = useId()
	const matchModeFieldName = useId()

	const filteredPosts = useMemo(() => {
		const activeFilters = filters.filter((filter) => filter.enabled)

		if (activeFilters.length === 0) {
			return posts
		}

		return posts.filter((post) => {
			const fieldsToSearch: Array<string | undefined | null> = [
				post.head,
				post.body,
				post.media?.transcript,
				post.media?.alt_text,
			]

			const matcher =
				matchMode === 'and'
					? (fn: (filter: { token: string; enabled: boolean }) => boolean) =>
							activeFilters.every(fn)
					: (fn: (filter: { token: string; enabled: boolean }) => boolean) => activeFilters.some(fn)

			return matcher((filter) => {
				const normalizedFilter = filter.token.toLowerCase()
				return fieldsToSearch.some((field) => field?.toLowerCase().includes(normalizedFilter))
			})
		})
	}, [filters, matchMode, posts])

	const totalPostCount = posts.length
	const filteredPostCount = filteredPosts.length

	const postCountLabel = useMemo(() => {
		if (isLoading) {
			return null
		}

		const baseCountText = `${filteredPostCount} ${filteredPostCount === 1 ? 'post' : 'posts'}`

		if (filteredPostCount === totalPostCount) {
			return `Showing ${baseCountText}`
		}

		return `Showing ${baseCountText} (filtered)`
	}, [filteredPostCount, isLoading, totalPostCount])

	const handleAddFilters = useCallback(
		(event: React.FormEvent<HTMLFormElement>) => {
			event.preventDefault()

			const normalizedInput = filterText.trim()

			if (!normalizedInput) {
				return
			}

			const tokens = Array.from(
				new Set(
					normalizedInput
						.split(/\s+/)
						.map((token) => token.trim())
						.filter(Boolean)
				)
			)

			if (tokens.length === 0) {
				return
			}

			setFilters((prev) => {
				const existingMap = new Map(prev.map((filter) => [filter.token.toLowerCase(), filter]))
				const updatedFilters = prev.map((filter) =>
					tokens.some((token) => token.toLowerCase() === filter.token.toLowerCase())
						? { ...filter, enabled: true }
						: filter
				)

				const nextTokens = tokens.filter((token) => !existingMap.has(token.toLowerCase()))

				return nextTokens.length > 0
					? [
							...updatedFilters,
							...nextTokens.map((token) => ({
								token,
								enabled: true,
							})),
						]
					: updatedFilters
			})

			setFilterText('')
		},
		[filterText]
	)

	const handleRemoveFilter = useCallback((tokenToRemove: string) => {
		setFilters((prev) => prev.filter((filter) => filter.token !== tokenToRemove))
	}, [])

	const handleClearFilters = useCallback(() => {
		setFilters([])
	}, [])

	const handleToggleFilter = useCallback((tokenToToggle: string) => {
		setFilters((prev) =>
			prev.map((filter) =>
				filter.token === tokenToToggle ? { ...filter, enabled: !filter.enabled } : filter
			)
		)
	}, [])

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
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
						<input
							id={filterInputId}
							className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40 sm:flex-1"
							type="text"
							placeholder="Enter words to filter posts…"
							value={filterText}
							onChange={(event) => setFilterText(event.target.value)}
							aria-label="Add a filter term for posts"
						/>
						<div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
							<div className="flex items-center gap-2">
								<span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:text-sm">
									Match
								</span>
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
							<button
								type="submit"
								className="inline-flex min-w-[96px] items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:px-3"
							>
								Add
							</button>
						</div>
					</div>
				</form>

				<div className="mt-4 space-y-3">
					{filters.length > 0 && (
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium text-muted-foreground">
								Active filters ({matchMode === 'and' ? 'match all' : 'match any'} enabled):
							</span>
							{filters.map((filter) => (
								<div
									key={filter.token}
									className="relative inline-flex text-sm text-secondary-foreground"
								>
									<button
										type="button"
										onClick={() => handleToggleFilter(filter.token)}
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
											handleRemoveFilter(filter.token)
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
							<button
								type="button"
								onClick={handleClearFilters}
								className="text-sm font-medium text-primary hover:underline"
							>
								Clear all
							</button>
						</div>
					)}
				</div>
			</div>

			{postCountLabel && (
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
		</div>
	)
}

export default Feed
