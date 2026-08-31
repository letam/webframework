import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreatePost from '@/components/post/create/CreatePost'
import { toast } from '@/components/ui/sonner'
import { saveComposerDraft } from '@/lib/utils/composerDraft'
import { requestComposerLoad } from '@/lib/composerBridge'
import { MAX_QUEUED_MEDIA_BYTES } from '@/lib/outbox'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockUseOutbox = vi.hoisted(() => vi.fn())
const mockEnqueuePost = vi.hoisted(() => vi.fn())
const mockSetSyncMode = vi.hoisted(() => vi.fn())
const mockConvertWavToWebM = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/hooks/useOutbox', () => ({
	useOutbox: mockUseOutbox,
}))

vi.mock('@/lib/outbox', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/outbox')>()
	return {
		enqueuePost: mockEnqueuePost,
		MAX_QUEUED_MEDIA_BYTES: actual.MAX_QUEUED_MEDIA_BYTES,
		setSyncMode: mockSetSyncMode,
	}
})

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

vi.mock('@/components/ui/sonner', () => ({
	toast: mockToast,
}))

vi.mock('@/lib/utils/audio', () => ({
	convertWavToWebM: mockConvertWavToWebM,
	getAudioExtension: () => 'wav',
}))

vi.mock('@/components/post/create/AudioRecorder', () => ({
	AudioRecorderModal: ({
		open,
		onAudioCaptured,
	}: {
		open: boolean
		onAudioCaptured: (blob: Blob) => void
	}) =>
		open ? (
			<button
				type="button"
				onClick={() => onAudioCaptured(new Blob(['recording'], { type: 'audio/wav' }))}
			>
				Use recording
			</button>
		) : null,
}))

const setOnline = (online: boolean) => {
	Object.defineProperty(navigator, 'onLine', { configurable: true, value: online })
}

const makeEntry = (overrides: Partial<OutboxEntry> = {}): OutboxEntry => ({
	id: crypto.randomUUID(),
	createdAt: Date.now(),
	author: 7,
	status: 'queued',
	attempts: 0,
	lastError: null,
	text: 'Restored from the outbox',
	visibility: 'private',
	isDraft: false,
	linkPreviewsEnabled: true,
	autoTranscribe: false,
	mediaType: null,
	media: null,
	mediaName: null,
	...overrides,
})

describe('CreatePost', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		setOnline(true)
		// isAuthResolved matters: the composer only autosaves drafts once auth has
		// actually answered, so a mock without it silently opts these out.
		Object.defineProperty(URL, 'createObjectURL', {
			configurable: true,
			value: vi.fn(() => 'blob:preview'),
		})
		Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			isAuthResolved: true,
			userId: 7,
		})
		mockUseOutbox.mockReturnValue({ syncMode: 'auto' })
		mockEnqueuePost.mockResolvedValue(true)
		mockConvertWavToWebM.mockResolvedValue(
			new Blob(['converted'], { type: 'audio/webm;codecs=opus' })
		)
	})

	it('queues an online post in local mode with the local-only toast', async () => {
		mockUseOutbox.mockReturnValue({ syncMode: 'local' })
		const user = userEvent.setup()
		const onPostCreated = vi.fn()
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Keep this local')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Keep this local' })
		)
		expect(onPostCreated).not.toHaveBeenCalled()
		expect(mockToast).toHaveBeenCalledWith('Saved on this device.')
	})

	it('uses the local-only toast for drafts too', async () => {
		mockUseOutbox.mockReturnValue({ syncMode: 'local' })
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Local draft')
		await user.click(screen.getByRole('button', { name: 'Draft' }))

		await waitFor(() =>
			expect(mockEnqueuePost).toHaveBeenCalledWith(expect.objectContaining({ isDraft: true }))
		)
		expect(mockToast).toHaveBeenCalledWith('Saved on this device.')
	})

	it('renders the auto-sync toggle and changes mode from its radio menu', async () => {
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		await user.click(screen.getByRole('button', { name: 'Auto-sync' }))
		expect(screen.getByText('Posts go online as soon as possible.')).toBeInTheDocument()
		expect(screen.getByText('Posts wait here until you send them.')).toBeInTheDocument()
		await user.click(screen.getByText('Stay on this device'))

		expect(mockSetSyncMode).toHaveBeenCalledWith('local')
	})

	it('loads an outbox entry into an empty composer with final media bytes', async () => {
		const onPostCreated = vi.fn().mockResolvedValue(undefined)
		render(<CreatePost onPostCreated={onPostCreated} />)
		const media = new Blob(['final-image'], { type: 'image/png' })

		let loadHandle: ReturnType<typeof requestComposerLoad> = null
		act(() => {
			loadHandle = requestComposerLoad(
				makeEntry({ media, mediaType: 'image', mediaName: 'restored.png' })
			)
		})

		expect(loadHandle).not.toBeNull()
		expect(screen.getByPlaceholderText("What's on your mind?")).toHaveValue(
			'Restored from the outbox'
		)
		expect(screen.getByText('restored.png')).toBeInTheDocument()

		await userEvent.click(screen.getByRole('button', { name: 'Post' }))
		await waitFor(() => expect(onPostCreated).toHaveBeenCalledTimes(1))
		expect(onPostCreated).toHaveBeenCalledWith(
			expect.objectContaining({
				text: 'Restored from the outbox',
				visibility: 'private',
				media: expect.objectContaining({ name: 'restored.png', type: 'image/png' }),
			})
		)
	})

	it('can roll back an outbox load when its durable deletion fails', () => {
		render(<CreatePost onPostCreated={vi.fn()} />)
		const media = new Blob(['queued-image'], { type: 'image/png' })
		let loadHandle: ReturnType<typeof requestComposerLoad> = null

		act(() => {
			loadHandle = requestComposerLoad(
				makeEntry({ media, mediaType: 'image', mediaName: 'queued.png' })
			)
		})
		expect(screen.getByPlaceholderText("What's on your mind?")).toHaveValue(
			'Restored from the outbox'
		)
		expect(screen.getByText('queued.png')).toBeInTheDocument()

		act(() => loadHandle?.rollback())

		expect(screen.getByPlaceholderText("What's on your mind?")).toHaveValue('')
		expect(screen.queryByText('queued.png')).not.toBeInTheDocument()
	})

	it('preserves composer changes made before an outbox rollback', async () => {
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)
		let loadHandle: ReturnType<typeof requestComposerLoad> = null

		act(() => {
			loadHandle = requestComposerLoad(makeEntry())
		})
		const composer = screen.getByPlaceholderText("What's on your mind?")
		await user.type(composer, ' with a new edit')

		let rolledBack = true
		act(() => {
			rolledBack = loadHandle?.rollback() ?? false
		})

		expect(rolledBack).toBe(false)
		expect(composer).toHaveValue('Restored from the outbox with a new edit')
	})

	it('refuses to replace content already in the composer', async () => {
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)
		const composer = screen.getByPlaceholderText("What's on your mind?")
		await user.type(composer, 'Already writing')

		expect(requestComposerLoad(makeEntry())).toBeNull()
		expect(composer).toHaveValue('Already writing')
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
				expect.objectContaining({
					text: 'Hidden link',
					visibility: 'unlisted',
					expected_author: 7,
				})
			)
		)
	})

	it('binds an anonymous online create to the rendered author', async () => {
		mockUseAuth.mockReturnValue({
			isAuthenticated: false,
			isAuthResolved: true,
			userId: null,
		})
		const user = userEvent.setup()
		const onPostCreated = vi.fn().mockResolvedValue(undefined)
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Anonymous words')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(onPostCreated).toHaveBeenCalledWith(
				expect.objectContaining({ text: 'Anonymous words', expected_author: 'anon' })
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

	it('queues a text post offline, clears the composer, and shows the queued toast', async () => {
		setOnline(false)
		const user = userEvent.setup()
		const onPostCreated = vi.fn()
		render(<CreatePost onPostCreated={onPostCreated} />)

		const composer = screen.getByPlaceholderText("What's on your mind?")
		await user.type(composer, 'Write this later')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({
				author: 7,
				text: 'Write this later',
				visibility: 'public',
				mediaType: null,
			})
		)
		expect(onPostCreated).not.toHaveBeenCalled()
		expect(composer).toHaveValue('')
		expect(mockToast).toHaveBeenCalledWith("Queued — will post when you're back online.")
	})

	it('queues the Draft action offline with the draft-specific copy', async () => {
		setOnline(false)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Finish later')
		await user.click(screen.getByRole('button', { name: 'Draft' }))

		await waitFor(() =>
			expect(mockEnqueuePost).toHaveBeenCalledWith(expect.objectContaining({ isDraft: true }))
		)
		expect(mockToast).toHaveBeenCalledWith("Queued — will save to drafts when you're back online.")
	})

	it.each([
		['anon', true],
		['unknown', false],
	] as const)('records a signed-out %s author when auth-resolved is %s', async (author, known) => {
		setOnline(false)
		mockUseAuth.mockReturnValue({
			isAuthenticated: false,
			isAuthResolved: known,
			userId: null,
		})
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Anonymous queue')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(mockEnqueuePost).toHaveBeenCalledWith(
				expect.objectContaining({ author, visibility: null })
			)
		)
	})

	it('queues an attached image offline and clears the composer', async () => {
		setOnline(false)
		const user = userEvent.setup()
		const onPostCreated = vi.fn()
		render(<CreatePost onPostCreated={onPostCreated} />)
		const file = new File(['image'], 'queued.png', { type: 'image/png' })

		await user.upload(screen.getByTestId('composer-image-input'), file)
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({
				media: file,
				mediaName: 'queued.png',
				mediaType: 'image',
			})
		)
		expect(onPostCreated).not.toHaveBeenCalled()
		expect(screen.queryByText('queued.png')).not.toBeInTheDocument()
		expect(screen.getByPlaceholderText("What's on your mind?")).toHaveValue('')
	})

	it('uses the derived size-cap copy for an oversized offline image', async () => {
		setOnline(false)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)
		const composer = screen.getByPlaceholderText("What's on your mind?")
		const file = new File(['image'], 'oversized.png', { type: 'image/png' })
		Object.defineProperty(file, 'size', { value: MAX_QUEUED_MEDIA_BYTES + 1 })

		await user.type(composer, 'Keep all of this')
		await user.upload(screen.getByTestId('composer-image-input'), file)
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				`This file is too big to queue (${Math.round(
					MAX_QUEUED_MEDIA_BYTES / (1024 * 1024)
				)} MB limit).`
			)
		)
		expect(mockEnqueuePost).not.toHaveBeenCalled()
		expect(composer).toHaveValue('Keep all of this')
		expect(screen.getByText('oversized.png')).toBeInTheDocument()
	})

	it('converts normalized recorded audio before queueing it offline', async () => {
		setOnline(false)
		localStorage.setItem(
			'app-settings',
			JSON.stringify({ normalizeAudio: true, saveComposerDrafts: false })
		)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		await user.click(screen.getByRole('button', { name: 'Record Audio' }))
		await user.click(screen.getByRole('button', { name: 'Use recording' }))
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockConvertWavToWebM).toHaveBeenCalledTimes(1))
		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		const queued = mockEnqueuePost.mock.calls[0][0]
		expect(queued.mediaType).toBe('audio')
		expect(queued.media).toBeInstanceOf(File)
		expect(queued.media).toEqual(expect.objectContaining({ type: 'audio/webm;codecs=opus' }))
		expect(queued.media.name).toMatch(/^recording_\d+\.webm$/)
		expect(queued.mediaName).toBe(queued.media.name)
	})

	it('queues with the live client uuid when connectivity drops during media preparation', async () => {
		localStorage.setItem(
			'app-settings',
			JSON.stringify({ normalizeAudio: true, saveComposerDrafts: false })
		)
		let releaseConversion!: (blob: Blob) => void
		mockConvertWavToWebM.mockReturnValueOnce(
			new Promise((resolve) => {
				releaseConversion = resolve
			})
		)
		const user = userEvent.setup()
		const onPostCreated = vi.fn()
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.click(screen.getByRole('button', { name: 'Record Audio' }))
		await user.click(screen.getByRole('button', { name: 'Use recording' }))
		await user.click(screen.getByRole('button', { name: 'Post' }))
		await vi.waitFor(() => expect(mockConvertWavToWebM).toHaveBeenCalledOnce())
		setOnline(false)
		releaseConversion(new Blob(['converted'], { type: 'audio/webm;codecs=opus' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledOnce())
		expect(onPostCreated).not.toHaveBeenCalled()
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.any(String),
				mediaType: 'audio',
				media: expect.objectContaining({ type: 'audio/webm;codecs=opus' }),
			})
		)
	})

	it('reuses the online client uuid when a TypeError falls back to the outbox', async () => {
		const user = userEvent.setup()
		const onPostCreated = vi.fn().mockRejectedValue(new TypeError('network failed'))
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Connection blip')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		expect(onPostCreated).toHaveBeenCalledTimes(1)
		const request = onPostCreated.mock.calls[0][0]
		expect(request.client_uuid).toEqual(expect.any(String))
		expect(request.expected_author).toBe(7)
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({ id: request.client_uuid, text: 'Connection blip' })
		)
	})

	it('keeps the composer when device storage rejects the queued post', async () => {
		setOnline(false)
		mockEnqueuePost.mockResolvedValueOnce(false)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)

		const composer = screen.getByPlaceholderText("What's on your mind?")
		await user.type(composer, 'Only copy')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Couldn't save this post on this device.")
		)
		expect(composer).toHaveValue('Only copy')
	})

	it('keeps media and shows the quota copy when media enqueue storage fails', async () => {
		setOnline(false)
		mockEnqueuePost.mockResolvedValueOnce(false)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)
		const file = new File(['image'], 'only-copy.png', { type: 'image/png' })

		await user.upload(screen.getByTestId('composer-image-input'), file)
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith("Couldn't queue this post — device storage is full.")
		)
		expect(screen.getByText('only-copy.png')).toBeInTheDocument()
	})
})
