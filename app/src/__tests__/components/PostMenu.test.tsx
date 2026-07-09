import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PostMenu from '@/components/post/PostMenu'
import { makeAuthor, makePost } from '../data/mockPosts'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

const renderMenu = (
	post = makePost(),
	overrides: { onPinChange?: (id: number, pinned: boolean) => void } = {}
) =>
	render(
		<PostMenu post={post} onDelete={vi.fn()} onEdit={vi.fn()} onPinChange={overrides.onPinChange} />
	)

describe('PostMenu pin items', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 1,
			isSuperuser: false,
		})
	})

	it('shows Pin to profile for the author on published unpinned posts', async () => {
		const user = userEvent.setup()
		const onPinChange = vi.fn()
		renderMenu(makePost({ author: makeAuthor({ id: 1 }), pinned_at: null }), { onPinChange })

		await user.click(screen.getByLabelText('Post options'))
		await user.click(await screen.findByText('Pin to profile'))

		expect(onPinChange).toHaveBeenCalledWith(1, true)
	})

	it('shows Unpin from profile for pinned posts', async () => {
		const user = userEvent.setup()
		const onPinChange = vi.fn()
		renderMenu(
			makePost({
				author: makeAuthor({ id: 1 }),
				pinned_at: '2026-07-09T12:00:00Z',
			}),
			{ onPinChange }
		)

		await user.click(screen.getByLabelText('Post options'))
		await user.click(await screen.findByText('Unpin from profile'))

		expect(onPinChange).toHaveBeenCalledWith(1, false)
	})

	it('hides pin items on drafts', async () => {
		const user = userEvent.setup()
		renderMenu(makePost({ is_draft: true, author: makeAuthor({ id: 1 }) }))

		await user.click(screen.getByLabelText('Post options'))
		expect(screen.queryByText('Pin to profile')).not.toBeInTheDocument()
	})

	it('hides pin items on non-author posts', async () => {
		const user = userEvent.setup()
		renderMenu(makePost({ author: makeAuthor({ id: 2 }) }))

		await user.click(screen.getByLabelText('Post options'))
		expect(screen.queryByText('Pin to profile')).not.toBeInTheDocument()
	})
})
