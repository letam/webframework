import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { Post } from '@/components/post/Post'
import { markPostViewed } from '@/lib/viewTracking'
import { makeAuthor, makeMedia, makePost } from '../data/mockPosts'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/lib/viewTracking', () => ({
	markPostViewed: vi.fn(),
}))

const createWrapper =
	(queryClient: QueryClient) =>
	({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	)

const renderPost = (post = makePost()) => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
		},
	})

	return render(<Post post={post} onLike={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />, {
		wrapper: createWrapper(queryClient),
	})
}

describe('Post', () => {
	beforeEach(() => {
		vi.useFakeTimers()
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 99,
			isSuperuser: false,
		})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('marks a post viewed after one second of dwell at 50 percent visibility', () => {
		const post = makePost({ id: 22, author: makeAuthor({ id: 1 }) })
		renderPost(post)

		act(() => {
			globalThis.__triggerIntersect(true, screen.getByTestId('post-22'))
			vi.advanceTimersByTime(999)
		})
		expect(markPostViewed).not.toHaveBeenCalled()

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(markPostViewed).toHaveBeenCalledWith(22)
	})

	it('opens image posts in a lightbox with a view original link', () => {
		const post = makePost({
			id: 33,
			media: makeMedia({
				media_type: 'image',
				file: 'original.jpg',
				s3_file_key: undefined,
				signed_url: 'https://signed.example.com/original.jpg',
				thumbnail: '/media/post/33/media/rendition.jpg',
				alt_text: 'Gallery image',
			}),
		})
		renderPost(post)

		expect(screen.getByAltText('Gallery image')).toHaveAttribute(
			'src',
			'/media/post/33/media/rendition.jpg'
		)

		fireEvent.click(screen.getByLabelText('Open image preview'))

		expect(screen.getByRole('link', { name: 'View original' })).toHaveAttribute(
			'href',
			'https://signed.example.com/original.jpg'
		)
	})
})
