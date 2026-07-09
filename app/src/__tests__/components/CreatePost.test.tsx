import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreatePost from '@/components/post/create/CreatePost'
import { toast } from '@/components/ui/sonner'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}))

describe('CreatePost', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({ isAuthenticated: true })
	})

	it('submits the selected visibility', async () => {
		const user = userEvent.setup()
		const onPostCreated = vi.fn().mockResolvedValue(undefined)
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Hidden link')
		await user.click(screen.getByRole('button', { name: 'Visibility' }))
		await user.click(screen.getByText('Link only'))
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(onPostCreated).toHaveBeenCalledWith(
				expect.objectContaining({ text: 'Hidden link', visibility: 'unlisted' })
			)
		)
	})

	it('saves drafts with the draft payload and toast', async () => {
		const user = userEvent.setup()
		const onPostCreated = vi.fn().mockResolvedValue(undefined)
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Later')
		await user.click(screen.getByRole('button', { name: 'Draft' }))

		await waitFor(() =>
			expect(onPostCreated).toHaveBeenCalledWith(
				expect.objectContaining({ text: 'Later', is_draft: true })
			)
		)
		expect(toast.success).toHaveBeenCalledWith('Saved to drafts.')
	})
})
