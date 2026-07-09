import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Feed from '@/components/Feed'
import { mockPosts } from '../data/mockPosts'

const mockUsePostHandlers = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/usePostHandlers', () => ({
	usePostHandlers: mockUsePostHandlers,
}))

vi.mock('@/components/post/Post', () => ({
	Post: ({ post }: { post: { head: string } }) => <article data-testid="post">{post.head}</article>,
}))

vi.mock('@/components/post/create', () => ({
	default: () => <div data-testid="create-post" />,
}))

vi.mock('@/components/feed/FilterControls', () => ({
	FilterControls: () => <div data-testid="filter-controls" />,
}))

vi.mock('@/components/feed/ActiveFiltersList', () => ({
	ActiveFiltersList: () => null,
}))

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
	handlePinPost: vi.fn(),
	handlePostTranscribed: vi.fn(),
	...overrides,
})

describe('Feed component', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUsePostHandlers.mockReturnValue(handlers())
	})

	it('renders the loading state', () => {
		mockUsePostHandlers.mockReturnValue(handlers({ isLoading: true }))

		render(<Feed />)

		expect(screen.getByText('Loading posts...')).toBeInTheDocument()
	})

	it('renders the error state', () => {
		mockUsePostHandlers.mockReturnValue(handlers({ error: new Error('Failed to fetch posts') }))

		render(<Feed />)

		expect(screen.getByText('Error: Failed to fetch posts')).toBeInTheDocument()
	})

	it('renders one post component per post', () => {
		mockUsePostHandlers.mockReturnValue(handlers({ posts: mockPosts }))

		render(<Feed />)

		expect(screen.getAllByTestId('post')).toHaveLength(3)
		expect(screen.getByText('S3 audio')).toBeInTheDocument()
	})

	it('renders the infinite-scroll loading state', () => {
		mockUsePostHandlers.mockReturnValue(
			handlers({
				posts: mockPosts,
				hasNextPage: true,
				isFetchingNextPage: true,
			})
		)

		render(<Feed />)

		expect(screen.getByText('Loading more…')).toBeInTheDocument()
	})
})
