import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncStatusIndicator } from '@/components/SyncStatusIndicator'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

const mockUseOnlineStatus = vi.hoisted(() => vi.fn())
const mockUseOutbox = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: mockUseOnlineStatus }))
vi.mock('@/hooks/useOutbox', () => ({ useOutbox: mockUseOutbox }))

const makeEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
	id: crypto.randomUUID(),
	createdAt: Date.now(),
	author: 'anon',
	status: 'queued',
	attempts: 0,
	lastError: null,
	text: 'Queued',
	visibility: null,
	isDraft: false,
	linkPreviewsEnabled: true,
	autoTranscribe: false,
	mediaType: null,
	media: null,
	mediaName: null,
	...overrides,
})

const renderIndicator = () =>
	render(
		<TooltipProvider>
			<SyncStatusIndicator />
		</TooltipProvider>
	)

describe('SyncStatusIndicator', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseOnlineStatus.mockReturnValue(true)
		mockUseOutbox.mockReturnValue({ entries: [], flushing: false, syncMode: 'auto' })
	})

	it('shows the singular offline queued state', () => {
		mockUseOnlineStatus.mockReturnValue(false)
		mockUseOutbox.mockReturnValue({ entries: [makeEntry()], flushing: false })
		renderIndicator()

		expect(
			screen.getByLabelText("You're offline — 1 post queued. It'll go out when you're back online.")
		).toHaveTextContent('1')
	})

	it('shows the plural offline queued state', () => {
		mockUseOnlineStatus.mockReturnValue(false)
		mockUseOutbox.mockReturnValue({ entries: [makeEntry(), makeEntry()], flushing: false })
		renderIndicator()

		expect(
			screen.getByLabelText(
				"You're offline — 2 posts queued. They'll go out when you're back online."
			)
		).toHaveTextContent('2')
	})

	it('shows the empty offline state without a count', () => {
		mockUseOnlineStatus.mockReturnValue(false)
		renderIndicator()

		expect(
			screen.getByLabelText("You're offline. New posts will be queued on this device.")
		).not.toHaveTextContent(/\d/)
	})

	it('gives flushing precedence over failures', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry({ status: 'failed' }), makeEntry()],
			flushing: true,
		})
		renderIndicator()

		expect(screen.getByLabelText('Sending queued posts…')).toHaveTextContent('2')
	})

	it('counts only failed entries in the failure state', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry({ status: 'failed' }), makeEntry()],
			flushing: false,
		})
		renderIndicator()

		expect(screen.getByLabelText("Some queued posts couldn't be sent.")).toHaveTextContent('1')
	})

	it('shows published entries as local cleanup instead of queued work', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry({ status: 'published' })],
			flushing: false,
			syncMode: 'auto',
		})
		renderIndicator()

		expect(
			screen.getByLabelText('A published post still has a local copy on this device.')
		).toHaveTextContent('1')
		expect(screen.queryByLabelText('1 queued.')).not.toBeInTheDocument()
	})

	it('shows the online pre-flush lull', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry(), makeEntry()],
			flushing: false,
			syncMode: 'auto',
		})
		renderIndicator()

		expect(screen.getByLabelText('2 queued.')).toHaveTextContent('2')
	})

	it('shows the local-mode pending state with a hard-drive icon', () => {
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry(), makeEntry()],
			flushing: false,
			syncMode: 'local',
		})
		const { container } = renderIndicator()

		expect(
			screen.getByLabelText('Auto-sync is off — posts stay on this device.')
		).toHaveTextContent('2')
		expect(container.querySelector('.lucide-hard-drive')).toBeInTheDocument()
	})

	it('keeps the offline state ahead of local mode, without promising auto-send', () => {
		mockUseOnlineStatus.mockReturnValue(false)
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry()],
			flushing: false,
			syncMode: 'local',
		})
		renderIndicator()

		expect(screen.getByLabelText("You're offline — 1 post on this device.")).toBeInTheDocument()
		expect(
			screen.queryByLabelText('Auto-sync is off — posts stay on this device.')
		).not.toBeInTheDocument()
	})

	it('shows plural device-only copy while offline in local mode', () => {
		mockUseOnlineStatus.mockReturnValue(false)
		mockUseOutbox.mockReturnValue({
			entries: [makeEntry(), makeEntry()],
			flushing: false,
			syncMode: 'local',
		})
		renderIndicator()

		expect(screen.getByLabelText("You're offline — 2 posts on this device.")).toBeInTheDocument()
	})

	it('is hidden while online and empty', () => {
		const { container } = renderIndicator()

		expect(container).toBeEmptyDOMElement()
	})
})
