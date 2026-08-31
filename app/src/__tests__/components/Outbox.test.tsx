import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxList } from '@/components/feed/OutboxList'
import { OutboxCard } from '@/components/post/OutboxCard'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUseOutbox = vi.hoisted(() => vi.fn())
const mockFlushEntry = vi.hoisted(() => vi.fn())
const mockFlushOutbox = vi.hoisted(() => vi.fn())
const mockGetOutboxSnapshot = vi.hoisted(() => vi.fn())
const mockRemoveEntry = vi.hoisted(() => vi.fn())
const mockRetryEntry = vi.hoisted(() => vi.fn())
const mockRequestComposerLoad = vi.hoisted(() => vi.fn())
const mockRollbackComposerLoad = vi.hoisted(() => vi.fn())
const mockCommitComposerLoad = vi.hoisted(() => vi.fn())
const mockCreateObjectURL = vi.hoisted(() => vi.fn(() => 'blob:queued-media'))
const mockRevokeObjectURL = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }))
vi.mock('@/hooks/useOutbox', () => ({ useOutbox: mockUseOutbox }))
vi.mock('@/lib/outbox', () => ({
	flushEntry: mockFlushEntry,
	flushOutbox: mockFlushOutbox,
	getOutboxSnapshot: mockGetOutboxSnapshot,
	removeEntry: mockRemoveEntry,
	retryEntry: mockRetryEntry,
}))
vi.mock('@/lib/composerBridge', () => ({ requestComposerLoad: mockRequestComposerLoad }))
vi.mock('@/components/ui/sonner', () => ({ toast: mockToast }))

const setOnline = (online: boolean) => {
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
}

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
		setOnline(true)
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: mockCreateObjectURL,
		})
		Object.defineProperty(URL, 'revokeObjectURL', {
			configurable: true,
			value: mockRevokeObjectURL,
		})
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			username: 'tam',
			avatar: null,
		})
		mockUseOutbox.mockReturnValue({ entries: [], flushing: false, syncMode: 'auto' })
		mockGetOutboxSnapshot.mockReturnValue({ entries: [], flushing: false, syncMode: 'auto' })
		mockFlushEntry.mockResolvedValue(undefined)
		mockFlushOutbox.mockResolvedValue(undefined)
		mockRemoveEntry.mockResolvedValue('removed')
		mockRetryEntry.mockResolvedValue(undefined)
		mockRequestComposerLoad.mockReturnValue({
			commit: mockCommitComposerLoad,
			rollback: mockRollbackComposerLoad,
		})
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
		expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
	})

	it('uses the local-mode chip copy for queued entries', () => {
		mockUseOutbox.mockReturnValue({ entries: [], flushing: false, syncMode: 'local' })

		render(<OutboxCard entry={makeEntry()} />)

		expect(screen.getByText('On this device')).toBeInTheDocument()
		expect(screen.queryByText('Queued')).not.toBeInTheDocument()
	})

	it('posts one queued entry immediately', async () => {
		const user = userEvent.setup()
		const entry = makeEntry()
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Post now' }))

		expect(mockFlushEntry).toHaveBeenCalledWith(entry.id)
	})

	it('keeps Post now local while offline', async () => {
		setOnline(false)
		const user = userEvent.setup()
		render(<OutboxCard entry={makeEntry()} />)

		await user.click(screen.getByRole('button', { name: 'Post now' }))

		expect(mockFlushEntry).not.toHaveBeenCalled()
		expect(mockToast).toHaveBeenCalledWith("You're offline.")
	})

	it('loads an editable entry into the composer and removes the stored copy', async () => {
		const user = userEvent.setup()
		const entry = makeEntry({ status: 'failed' })
		mockGetOutboxSnapshot.mockReturnValue({ entries: [entry], flushing: false, syncMode: 'auto' })
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Edit' }))

		expect(mockRequestComposerLoad).toHaveBeenCalledWith(entry)
		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockCommitComposerLoad).toHaveBeenCalledOnce()
	})

	it('keeps an entry when the composer is occupied', async () => {
		mockRequestComposerLoad.mockReturnValue(null)
		const user = userEvent.setup()
		const entry = makeEntry()
		mockGetOutboxSnapshot.mockReturnValue({ entries: [entry], flushing: false, syncMode: 'auto' })
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Edit' }))

		expect(mockRemoveEntry).not.toHaveBeenCalled()
		expect(mockToast).toHaveBeenCalledWith('Finish or clear the composer first.')
	})

	it('rolls back composer loading when edit storage deletion fails', async () => {
		mockRemoveEntry.mockResolvedValueOnce('failed')
		const user = userEvent.setup()
		const entry = makeEntry()
		mockGetOutboxSnapshot.mockReturnValue({ entries: [entry], flushing: false, syncMode: 'auto' })
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Edit' }))

		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockRollbackComposerLoad).toHaveBeenCalledOnce()
		expect(mockToast.error).toHaveBeenCalledWith(
			"Couldn't remove the stored copy. The post is still in your outbox."
		)
	})

	it('rolls back composer loading when another tab starts sending', async () => {
		mockRemoveEntry.mockResolvedValueOnce('sending')
		const user = userEvent.setup()
		const entry = makeEntry()
		mockGetOutboxSnapshot.mockReturnValue({ entries: [entry], flushing: false, syncMode: 'auto' })
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Edit' }))

		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockRollbackComposerLoad).toHaveBeenCalledOnce()
		expect(mockToast).toHaveBeenCalledWith("This post started sending, so it can't be edited.")
	})

	it('refuses to edit an entry a flush has since picked up', async () => {
		const user = userEvent.setup()
		const entry = makeEntry()
		mockGetOutboxSnapshot.mockReturnValue({
			entries: [{ ...entry, status: 'sending' }],
			flushing: true,
			syncMode: 'auto',
		})
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Edit' }))

		expect(mockRequestComposerLoad).not.toHaveBeenCalled()
		expect(mockRemoveEntry).not.toHaveBeenCalled()
		expect(mockToast).toHaveBeenCalledWith(
			"This post is already being sent, so it can't be edited."
		)
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

	it('shows a published entry as cleanup-only', async () => {
		const user = userEvent.setup()
		const entry = makeEntry({
			status: 'published',
			lastError: "This post was published, but its local copy couldn't be cleared.",
		})
		render(<OutboxCard entry={entry} />)

		expect(screen.getByText('Posted')).toBeInTheDocument()
		expect(screen.getByText(entry.lastError as string)).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Post now' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()

		await user.click(screen.getByRole('button', { name: 'Clear' }))
		const dialog = screen.getByRole('alertdialog')
		expect(within(dialog).getByText('Clear local copy?')).toBeInTheDocument()
		expect(
			within(dialog).getByText(
				'The post is already published. This only clears its leftover copy from this device.'
			)
		).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', { name: 'Clear' }))

		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockToast).toHaveBeenCalledWith('Local copy cleared.')
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

	it('explains and reports reconciliation when a live create may have succeeded', async () => {
		mockRemoveEntry.mockResolvedValueOnce('published')
		const user = userEvent.setup()
		const entry = makeEntry({ mayHavePublished: true })
		render(<OutboxCard entry={entry} />)

		await user.click(screen.getByRole('button', { name: 'Remove' }))
		const dialog = screen.getByRole('alertdialog')
		expect(
			within(dialog).getByText(
				"We'll first check whether this post was already published. If it was, this only clears its local copy."
			)
		).toBeInTheDocument()
		await user.click(within(dialog).getByRole('button', { name: 'Remove' }))

		await waitFor(() => expect(mockRemoveEntry).toHaveBeenCalledWith(entry.id))
		expect(mockToast).toHaveBeenCalledWith(
			'This post was already published. Its local copy was cleared.'
		)
	})

	it('reports a storage failure instead of claiming the post was removed', async () => {
		mockRemoveEntry.mockResolvedValueOnce('failed')
		const user = userEvent.setup()
		render(<OutboxCard entry={makeEntry()} />)

		await user.click(screen.getByRole('button', { name: 'Remove' }))
		await user.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' })
		)

		await waitFor(() =>
			expect(mockToast.error).toHaveBeenCalledWith(
				"Couldn't remove this post from this device. Try again."
			)
		)
		expect(mockToast).not.toHaveBeenCalledWith('Removed.')
	})

	it('retains an ambiguous fallback when publication cannot be checked', async () => {
		mockRemoveEntry.mockResolvedValueOnce('failed')
		const user = userEvent.setup()
		render(<OutboxCard entry={makeEntry({ mayHavePublished: true })} />)

		await user.click(screen.getByRole('button', { name: 'Remove' }))
		await user.click(
			within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' })
		)

		await waitFor(() =>
			expect(mockToast.error).toHaveBeenCalledWith(
				"Couldn't confirm whether this post was already published. Reconnect and try again."
			)
		)
		expect(mockToast).not.toHaveBeenCalledWith('Removed.')
	})

	it('renders an image preview and revokes its object URL on unmount', async () => {
		const media = new Blob(['image'], { type: 'image/png' })
		const { unmount } = render(
			<OutboxCard entry={makeEntry({ media, mediaName: 'queued.png', mediaType: 'image' })} />
		)

		const preview = await screen.findByTestId('outbox-media-preview')
		expect(
			within(preview).getByRole('img', { name: 'Queued attachment: queued.png' })
		).toHaveAttribute('src', 'blob:queued-media')
		expect(mockCreateObjectURL).toHaveBeenCalledWith(media)

		unmount()
		expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:queued-media')
	})
})

describe('OutboxList', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setOnline(true)
		mockUseAuth.mockReturnValue({ isAuthenticated: false, username: null, avatar: null })
		mockFlushOutbox.mockResolvedValue(undefined)
		mockRemoveEntry.mockResolvedValue('removed')
		mockRequestComposerLoad.mockReturnValue(true)
	})

	it('renders visible entries newest first', () => {
		mockUseOutbox.mockReturnValue({
			entries: [
				makeEntry({ id: 'old', createdAt: 10, text: 'Older queued post' }),
				makeEntry({ id: 'new', createdAt: 20, text: 'Newer queued post' }),
			],
			syncMode: 'auto',
		})
		render(<OutboxList />)

		expect(screen.getAllByRole('article').map((card) => card.textContent)).toEqual([
			expect.stringContaining('Newer queued post'),
			expect.stringContaining('Older queued post'),
		])
	})

	it('shows a local-mode header and manually posts every visible entry', async () => {
		const user = userEvent.setup()
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry({ id: 'one' }), makeEntry({ id: 'two' })],
			syncMode: 'local',
		})
		render(<OutboxList />)

		expect(screen.getByText('On this device — 2')).toBeInTheDocument()
		await user.click(screen.getByRole('button', { name: 'Post all' }))

		expect(mockFlushOutbox).toHaveBeenCalledWith({ manual: true })
	})

	it('does not show the local header in auto mode', () => {
		mockUseOutbox.mockReturnValue({ entries: [makeEntry()], syncMode: 'auto' })

		render(<OutboxList />)

		expect(screen.queryByText(/On this device —/)).not.toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Post all' })).not.toBeInTheDocument()
	})

	it('does not offer to post a published cleanup entry again', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry({ status: 'published' })],
			syncMode: 'local',
		})

		render(<OutboxList />)

		expect(screen.getByText('On this device — 1')).toBeInTheDocument()
		expect(screen.queryByRole('button', { name: 'Post all' })).not.toBeInTheDocument()
	})

	it('does not post all while offline', async () => {
		setOnline(false)
		const user = userEvent.setup()
		mockUseOutbox.mockReturnValue({ entries: [makeEntry()], syncMode: 'local' })
		render(<OutboxList />)

		await user.click(screen.getByRole('button', { name: 'Post all' }))

		expect(mockFlushOutbox).not.toHaveBeenCalled()
		expect(mockToast).toHaveBeenCalledWith("You're offline.")
	})

	it('renders nothing when there are no visible entries', () => {
		mockUseOutbox.mockReturnValue({ entries: [], syncMode: 'local' })
		render(<OutboxList />)

		expect(screen.queryByTestId('outbox-list')).not.toBeInTheDocument()
	})
})
