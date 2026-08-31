import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Feed from '@/components/Feed'
import type { CreatePostRequest } from '@/types/post'
import { mockPosts } from '../data/mockPosts'

const mockUsePostHandlers = vi.hoisted(() => vi.fn())
const mockCreatePost = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/usePostHandlers', () => ({
	usePostHandlers: mockUsePostHandlers,
}))

vi.mock('@/components/post/Post', () => ({
	Post: ({ post }: { post: { head: string } }) => <article data-testid="post">{post.head}</article>,
}))

vi.mock('@/components/post/create', () => ({
	default: (props: unknown) => {
		mockCreatePost(props)
		return <div data-testid="create-post" />
	},
}))

vi.mock('@/components/feed/FilterControls', () => ({
	FilterControls: () => <div data-testid="filter-controls" />,
}))

vi.mock('@/components/feed/ActiveFiltersList', () => ({
	ActiveFiltersList: () => null,
}))

vi.mock('@/components/feed/OutboxList', () => ({
	OutboxList: () => <div data-testid="outbox-list" />,
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

	it('rethrows addPost failures through the composer callback', async () => {
		const error = new TypeError('network failed')
		const addPost = vi.fn().mockRejectedValue(error)
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
		mockUsePostHandlers.mockReturnValue(handlers({ addPost }))
		render(<Feed />)
		const { onPostCreated } = mockCreatePost.mock.calls[0][0] as {
			onPostCreated: (request: CreatePostRequest) => Promise<void>
		}
		const request = { text: 'Retry me', client_uuid: crypto.randomUUID() }

		await expect(onPostCreated(request)).rejects.toBe(error)

		expect(addPost).toHaveBeenCalledWith(request)
		consoleError.mockRestore()
	})
})
