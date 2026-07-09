import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from '@/components/ui/sonner'
import Profile from '@/components/Profile'
import { makePost } from '../data/mockPosts'
import { uploadAvatar } from '@/lib/api/users'

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

vi.mock('@/lib/api/users', () => ({
	uploadAvatar: vi.fn(),
	removeAvatar: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
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
	handlePinPost: vi.fn(),
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
			avatar: null,
			refreshAuthStatus: vi.fn().mockResolvedValue(undefined),
		})
		mockUsePostHandlers.mockReturnValue(handlers())
		vi.mocked(uploadAvatar).mockResolvedValue({ avatar: 'https://example.com/avatar.jpg' })
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

	it('renders pinned posts once above the regular profile list', () => {
		const pinnedPost = makePost({
			id: 31,
			head: 'Pinned only',
			pinned_at: '2026-07-09T12:00:00Z',
		})
		const regularPost = makePost({ id: 32, head: 'Regular post' })

		mockUsePostHandlers.mockImplementation((scope) => {
			if (scope?.pinned) {
				return handlers({ posts: [pinnedPost] })
			}
			if (scope?.author) {
				return handlers({ posts: [pinnedPost, regularPost] })
			}
			return handlers()
		})

		renderWithClient(<Profile />)

		expect(screen.getByText('Pinned')).toBeInTheDocument()
		expect(screen.getAllByText('Pinned only')).toHaveLength(1)
		expect(screen.getByText('Regular post')).toBeInTheDocument()
	})

	it('shows the own-profile avatar overlay and uploads a selected file', async () => {
		const user = userEvent.setup()
		const refreshAuthStatus = vi.fn().mockResolvedValue(undefined)
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 1,
			username: 'audiophile',
			avatar: null,
			refreshAuthStatus,
		})
		const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })

		const { container } = renderWithClient(<Profile />)
		expect(screen.getByLabelText('Change profile photo')).toBeInTheDocument()

		const input = container.querySelector('input[type="file"]') as HTMLInputElement
		await user.upload(input, file)

		await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(file))
		expect(refreshAuthStatus).toHaveBeenCalled()
		expect(toast.success).toHaveBeenCalledWith('Profile photo updated.')
	})

	it('does not render avatar upload controls for logged-out visitors', () => {
		mockUseAuth.mockReturnValue({
			isAuthenticated: false,
			userId: null,
			username: null,
			avatar: null,
			refreshAuthStatus: vi.fn(),
		})

		renderWithClient(<Profile />)

		expect(screen.queryByLabelText('Change profile photo')).not.toBeInTheDocument()
	})
})
