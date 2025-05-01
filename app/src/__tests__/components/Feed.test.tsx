import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Feed from '../../components/Feed'
import { mockPosts } from '../data/mockPosts'
import * as postsApi from '../../lib/api/posts'
import type { CreatePostRequest } from '../../types/post'

vi.mock('../../lib/api/posts', () => ({
	getPosts: vi.fn(),
	createPost: vi.fn(),
}))

vi.mock('../../components/post', () => ({
	default: ({ text, username }: { text: string; username: string }) => (
		<div data-testid="post">
			<p>{text}</p>
			<p>{username}</p>
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
					mediaType: 'video',
					mediaUrl: 'https://example.com/video.mp4',
				})
			}
		>
			Create Post
		</button>
	),
}))

describe('Feed component', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('should render loading state', () => {
		vi.mocked(postsApi.getPosts).mockImplementationOnce(() => new Promise(() => {}))

		render(<Feed />)
		expect(screen.getByText('Loading posts...')).toBeInTheDocument()
	})

	it('should render error state', async () => {
		vi.mocked(postsApi.getPosts).mockRejectedValueOnce(new Error('Failed to fetch posts'))

		render(<Feed />)
		await waitFor(() => {
			expect(screen.getByText('Error: Failed to fetch posts')).toBeInTheDocument()
		})
	})

	it('should render posts', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)

		render(<Feed />)
		await waitFor(() => {
			expect(screen.getAllByTestId('post')).toHaveLength(3)
		})

		expect(
			screen.getByText('Just recorded a new podcast episode! Check it out 🎧')
		).toBeInTheDocument()
		expect(screen.getByText('audiophile')).toBeInTheDocument()
	})

	it('should handle post creation', async () => {
		vi.mocked(postsApi.getPosts).mockResolvedValueOnce(mockPosts)
		const newPost = {
			...mockPosts[0],
			id: '4',
			text: 'New post',
		}
		vi.mocked(postsApi.createPost).mockResolvedValueOnce(newPost)

		render(<Feed />)
		await waitFor(() => {
			expect(screen.getAllByTestId('post')).toHaveLength(3)
		})

		const createButton = screen.getByText('Create Post')
		await userEvent.click(createButton)

		await waitFor(() => {
			expect(postsApi.createPost).toHaveBeenCalledWith({
				text: 'New post',
				mediaType: 'video',
				mediaUrl: 'https://example.com/video.mp4',
			})
		})
	})
})
