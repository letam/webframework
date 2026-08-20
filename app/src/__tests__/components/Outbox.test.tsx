import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxList } from '@/components/feed/OutboxList'
import { OutboxCard } from '@/components/post/OutboxCard'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUseOutbox = vi.hoisted(() => vi.fn())
const mockRemoveEntry = vi.hoisted(() => vi.fn())
const mockRetryEntry = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }))
vi.mock('@/hooks/useOutbox', () => ({ useOutbox: mockUseOutbox }))
vi.mock('@/lib/outbox', () => ({
	removeEntry: mockRemoveEntry,
	retryEntry: mockRetryEntry,
}))
vi.mock('@/components/ui/sonner', () => ({ toast: mockToast }))

const makeEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
	id: '9d41d3cc-9626-4fb2-99c4-73e670860e3f',
	createdAt: Date.now(),
	author: 7,
	status: 'queued',
	attempts: 0,
	lastError: null,
	text: 'Words waiting to post',
	visibility: 'private',
	isDraft: false,
	linkPreviewsEnabled: true,
	autoTranscribe: false,
	mediaType: null,
	media: null,
	mediaName: null,
	...overrides,
})

describe('OutboxCard', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			username: 'tam',
			avatar: null,
		})
		mockRemoveEntry.mockResolvedValue(undefined)
		mockRetryEntry.mockResolvedValue(undefined)
	})

	it('renders queued and draft states with the current author presentation', () => {
		render(<OutboxCard entry={makeEntry({ isDraft: true })} />)

		expect(screen.getByText('@tam')).toBeInTheDocument()
		expect(screen.getByText('Words waiting to post')).toBeInTheDocument()
		expect(screen.getByText('Queued')).toBeInTheDocument()
		expect(screen.getByText('Draft')).toBeInTheDocument()
	})

	it('renders the sending state', () => {
		render(<OutboxCard entry={makeEntry({ status: 'sending' })} />)

		expect(screen.getByText('Posting…')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
	})

	it('shows the pinned failure copy and retries the entry', async () => {
		const user = userEvent.setup()
		const entry = makeEntry({
			status: 'failed',
			lastError: 'The server rejected this post.',
		})
		render(<OutboxCard entry={entry} />)

		expect(screen.getByText("Couldn't post")).toBeInTheDocument()
		expect(screen.getByText('The server rejected this post.')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Retry' }))

		expect(mockRetryEntry).toHaveBeenCalledWith(entry.id)
	})

	it('requires confirmation before removing the only local copy', async () => {
		const user = userEvent.setup()
		const entry = makeEntry()
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Remove' }))
		const dialog = screen.getByRole('alertdialog')
		expect(within(dialog).getByText('Remove queued post?')).toBeInTheDocument()
		expect(
			within(dialog).getByText("It hasn't been posted and will be gone from this device.")
		).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockToast).toHaveBeenCalledWith('Removed.')
	})
})

describe('OutboxList', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({ isAuthenticated: false, username: null, avatar: null })
	})

	it('renders visible entries newest first', () => {
		mockUseOutbox.mockReturnValue({
			entries: [
				makeEntry({ id: 'old', createdAt: 10, text: 'Older queued post' }),
				makeEntry({ id: 'new', createdAt: 20, text: 'Newer queued post' }),
			],
		})
		render(<OutboxList />)

		expect(screen.getAllByRole('article').map((card) => card.textContent)).toEqual([
			expect.stringContaining('Newer queued post'),
			expect.stringContaining('Older queued post'),
		])
	})

	it('renders nothing when there are no visible entries', () => {
		mockUseOutbox.mockReturnValue({ entries: [] })
		render(<OutboxList />)

		expect(screen.queryByTestId('outbox-list')).not.toBeInTheDocument()
	})
})
