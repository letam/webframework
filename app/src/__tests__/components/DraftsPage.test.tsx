import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DraftsPage from '@/pages/DraftsPage'
import { getAuthorStats } from '@/lib/api/posts'
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
	getAuthorStats: vi.fn(),
}))

vi.mock('@/components/Navbar', () => ({
	default: () => <div data-testid="navbar" />,
}))

vi.mock('@/components/LoginModal', () => ({
	LoginModal: () => <button type="button">Log in</button>,
}))

vi.mock('@/components/post/Post', () => ({
	Post: ({ post }: { post: { id: number; head: string } }) => <article>{post.head}</article>,
}))

vi.mock('@/components/feed/InfiniteScrollSentinel', () => ({
	InfiniteScrollSentinel: () => null,
}))

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const renderPage = (children: ReactNode) =>
	render(
		<QueryClientProvider client={createQueryClient()}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	)

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

describe('DraftsPage', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({ isAuthenticated: true, userId: 1 })
		mockUsePostHandlers.mockReturnValue(handlers())
		vi.mocked(getAuthorStats).mockResolvedValue({
			post_count: 4,
			likes_received: 0,
			draft_count: 2,
		})
	})

	it('lists the drafts with the server-side total', async () => {
		mockUsePostHandlers.mockReturnValue(
			handlers({
				posts: [
					makePost({ id: 31, head: 'Draft one', is_draft: true }),
					makePost({ id: 32, head: 'Draft two', is_draft: true }),
				],
			})
		)

		renderPage(<DraftsPage />)

		expect(screen.getByRole('heading', { name: 'Drafts' })).toBeInTheDocument()
		expect(screen.getByText('Draft one')).toBeInTheDocument()
		expect(screen.getByText('Draft two')).toBeInTheDocument()
		await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument())
	})

	it('queries only the drafts scope', () => {
		renderPage(<DraftsPage />)

		expect(mockUsePostHandlers).toHaveBeenCalledWith({ drafts: true }, { enabled: true })
	})

	it('shows the empty state when there are no drafts', () => {
		renderPage(<DraftsPage />)

		expect(screen.getByText(/No drafts yet/)).toBeInTheDocument()
	})

	it('asks anonymous visitors to log in and skips the query', () => {
		mockUseAuth.mockReturnValue({ isAuthenticated: false, userId: null })

		renderPage(<DraftsPage />)

		expect(screen.getByRole('heading', { name: 'Your drafts' })).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument()
		expect(getAuthorStats).not.toHaveBeenCalled()
	})
})
