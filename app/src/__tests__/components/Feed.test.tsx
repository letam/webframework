import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Feed from '../../components/Feed'
import { mockPosts } from '../data/mockPosts'
import type { Post, CreatePostRequest } from '../../types/post'

// Mock usePosts hook
const mockAddPost = vi.fn()
const mockRemovePost = vi.fn()
const mockEditPost = vi.fn()
const mockSetPosts = vi.fn()

vi.mock('../../hooks/usePosts', () => ({
	usePosts: vi.fn(() => ({
		posts: [] as Post[],
		isLoading: false,
		error: null,
		addPost: mockAddPost,
		editPost: mockEditPost,
		removePost: mockRemovePost,
		setPosts: mockSetPosts,
		fetchPosts: vi.fn(),
		isFetching: false,
		isMutating: false,
	})),
}))

// Mock usePostFilters hook
vi.mock('../../hooks/usePostFilters', () => ({
	usePostFilters: vi.fn((posts: Post[]) => ({
		filterText: '',
		setFilterText: vi.fn(),
		filters: [],
		tagFilters: [],
		matchMode: 'all',
		setMatchMode: vi.fn(),
		filteredPosts: posts,
		filteredPostCount: posts.length,
		postCountLabel: '',
		addFiltersFromText: vi.fn(),
		removeFilter: vi.fn(),
		clearFilters: vi.fn(),
		toggleFilter: vi.fn(),
		applyTagFilters: vi.fn(),
	})),
}))

// Mock child components
vi.mock('../../components/post/Post', () => ({
	Post: ({ post }: { post: Post }) => (
		<div data-testid={`post-${post.id}`}>
			<p>{post.body}</p>
			<p>{post.author.username}</p>
		</div>
	),
}))

vi.mock('../../components/post/create', () => ({
	default: ({ onPostCreated }: { onPostCreated: (data: CreatePostRequest) => void }) => (
		<button
			type="button"
			onClick={() =>
				onPostCreated({
					text: 'New post',
				})
			}
		>
			Create Post
		</button>
	),
}))

vi.mock('../../components/feed/FilterControls', () => ({
	FilterControls: () => <div data-testid="filter-controls" />,
}))

vi.mock('../../components/feed/ActiveFiltersList', () => ({
	ActiveFiltersList: () => <div data-testid="active-filters" />,
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}))

// Import the mocked hook so we can change its return value per test
import { usePosts } from '../../hooks/usePosts'

describe('Feed component', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('should render loading state', () => {
		vi.mocked(usePosts).mockReturnValue({
			posts: [],
			isLoading: true,
			error: null,
			addPost: mockAddPost,
			editPost: mockEditPost,
			removePost: mockRemovePost,
			setPosts: mockSetPosts,
			fetchPosts: vi.fn(),
			isFetching: false,
			isMutating: false,
		})

		render(<Feed />)
		expect(screen.getByText('Loading posts...')).toBeInTheDocument()
	})

	it('should render error state', () => {
		vi.mocked(usePosts).mockReturnValue({
			posts: [],
			isLoading: false,
			error: new Error('Failed to fetch posts'),
			addPost: mockAddPost,
			editPost: mockEditPost,
			removePost: mockRemovePost,
			setPosts: mockSetPosts,
			fetchPosts: vi.fn(),
			isFetching: false,
			isMutating: false,
		})

		render(<Feed />)
		expect(screen.getByText('Error: Failed to fetch posts')).toBeInTheDocument()
	})

	it('should render posts', () => {
		vi.mocked(usePosts).mockReturnValue({
			posts: mockPosts,
			isLoading: false,
			error: null,
			addPost: mockAddPost,
			editPost: mockEditPost,
			removePost: mockRemovePost,
			setPosts: mockSetPosts,
			fetchPosts: vi.fn(),
			isFetching: false,
			isMutating: false,
		})

		render(<Feed />)

		expect(screen.getByTestId('post-1')).toBeInTheDocument()
		expect(screen.getByTestId('post-2')).toBeInTheDocument()
		expect(screen.getByTestId('post-3')).toBeInTheDocument()
		expect(
			screen.getByText('Just recorded a new podcast episode! Check it out')
		).toBeInTheDocument()
		expect(screen.getByText('audiophile')).toBeInTheDocument()
	})

	it('should handle post creation', async () => {
		vi.mocked(usePosts).mockReturnValue({
			posts: mockPosts,
			isLoading: false,
			error: null,
			addPost: mockAddPost,
			editPost: mockEditPost,
			removePost: mockRemovePost,
			setPosts: mockSetPosts,
			fetchPosts: vi.fn(),
			isFetching: false,
			isMutating: false,
		})

		render(<Feed />)

		const createButton = screen.getByText('Create Post')
		await userEvent.click(createButton)

		await waitFor(() => {
			expect(mockAddPost).toHaveBeenCalledWith({ text: 'New post' })
		})
	})
})
