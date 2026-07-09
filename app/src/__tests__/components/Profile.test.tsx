import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Profile from '@/components/Profile'
import { makePost } from '../data/mockPosts'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUsePostHandlers = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/hooks/usePostHandlers', () => ({
	usePostHandlers: mockUsePostHandlers,
}))

vi.mock('@/lib/api/posts', () => ({
	getAuthorStats: vi.fn().mockResolvedValue({ post_count: 0, likes_received: 0 }),
}))

vi.mock('@/components/post/Post', () => ({
	Post: ({
		post,
		onPublish,
	}: {
		post: { id: number; head: string }
		onPublish?: (id: number) => void
	}) => (
		<article>
			<span>{post.head}</span>
			<button type="button" onClick={() => onPublish?.(post.id)}>
				Publish {post.id}
			</button>
		</article>
	),
}))

vi.mock('@/components/feed/InfiniteScrollSentinel', () => ({
	InfiniteScrollSentinel: () => null,
}))

const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

const renderWithClient = (children: ReactNode) =>
	render(<QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>)

const handlers = (overrides: Record<string, unknown> = {}) => ({
	posts: [],
	isLoading: false,
	isFetching: false,
	error: null,
	fetchNextPage: vi.fn(),
	hasNextPage: false,
	isFetchingNextPage: false,
	addPost: vi.fn(),
	handleLike: vi.fn(),
	handleDeletePost: vi.fn(),
	handleEditPost: vi.fn(),
	handleChangeVisibility: vi.fn(),
	handlePublishPost: vi.fn(),
	handleCopyShareLink: vi.fn(),
	handleResetShareLink: vi.fn(),
	handlePostTranscribed: vi.fn(),
	...overrides,
})

describe('Profile', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 1,
			username: 'audiophile',
		})
	})

	it('renders drafts and publishes all drafts sequentially', async () => {
		const user = userEvent.setup()
		const publish = vi.fn().mockResolvedValue(undefined)
		const draftOne = makePost({ id: 21, head: 'Draft one', is_draft: true })
		const draftTwo = makePost({ id: 22, head: 'Draft two', is_draft: true })

		mockUsePostHandlers.mockImplementation((scope) => {
			if (scope?.drafts) {
				return handlers({ posts: [draftOne, draftTwo], handlePublishPost: publish })
			}
			return handlers()
		})

		renderWithClient(<Profile />)

		await user.click(screen.getByRole('tab', { name: 'Drafts' }))
		expect(screen.getByText('Draft one')).toBeInTheDocument()
		expect(screen.getByText('Draft two')).toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Publish all' }))
		expect(screen.getByText('Publish 2 drafts?')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Publish' }))

		await waitFor(() => expect(publish).toHaveBeenCalledTimes(2))
		expect(publish).toHaveBeenNthCalledWith(1, 21)
		expect(publish).toHaveBeenNthCalledWith(2, 22)
	})
})
