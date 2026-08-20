import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreatePost from '@/components/post/create/CreatePost'
import { toast } from '@/components/ui/sonner'
import { saveComposerDraft } from '@/lib/utils/composerDraft'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn() },
}))

// jsdom has no IndexedDB, and what these tests are about is whether the composer
// decides to write at all — not what the write does once it starts.
vi.mock('@/lib/utils/composerDraft', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/utils/composerDraft')>()
	return {
		...actual,
		loadComposerDraft: vi.fn().mockResolvedValue(null),
		saveComposerDraft: vi.fn().mockResolvedValue(undefined),
		clearComposerDraft: vi.fn().mockResolvedValue(undefined),
		updateComposerDraftFields: vi.fn().mockResolvedValue(undefined),
	}
})

/** Matches TEXT_DEBOUNCE_MS in useComposerDraft. */
const TEXT_DEBOUNCE_MS = 600

describe('CreatePost', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// isAuthResolved matters: the composer only autosaves drafts once auth has
		// actually answered, so a mock without it silently opts these out.
		mockUseAuth.mockReturnValue({ isAuthenticated: true, isAuthResolved: true, userId: 1 })
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

	describe('draft autosave gating', () => {
		// A signed-in user's words must never be written to the shared anonymous
		// slot. Until /auth/status/ answers, `userId` is null — but so is it for a
		// genuine anonymous visitor, so the composer has to wait for the answer
		// rather than trust the null. The gate is `isAuthResolved`, and these pin it:
		// `!isAuthLoading` looks equivalent and is not, because loading also ends when
		// the check *fails*, which is precisely when the null means nothing.
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		// fireEvent rather than userEvent: typing character by character is a real
		// delay userEvent schedules on the same fake clock this test is stepping, and
		// nothing here depends on the keystrokes arriving one at a time.
		const typePastTheDebounce = async () => {
			render(<CreatePost onPostCreated={vi.fn().mockResolvedValue(undefined)} />)
			fireEvent.change(screen.getByPlaceholderText("What's on your mind?"), {
				target: { value: 'Words' },
			})
			await act(async () => {
				vi.advanceTimersByTime(TEXT_DEBOUNCE_MS)
			})
		}

		it('autosaves once auth has answered', async () => {
			mockUseAuth.mockReturnValue({
				isAuthenticated: false,
				isAuthLoading: false,
				isAuthResolved: true,
				userId: null,
			})

			await typePastTheDebounce()

			expect(saveComposerDraft).toHaveBeenCalledWith(
				null,
				expect.objectContaining({ text: 'Words' })
			)
		})

		it('does not autosave when the auth check failed', async () => {
			// The shape a failed /auth/status/ leaves behind: not loading any more, but
			// never answered, so `userId` is still its default rather than a fact.
			mockUseAuth.mockReturnValue({
				isAuthenticated: false,
				isAuthLoading: false,
				isAuthResolved: false,
				userId: null,
			})

			await typePastTheDebounce()

			expect(saveComposerDraft).not.toHaveBeenCalled()
		})
	})
})
