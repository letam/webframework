import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CreatePost from '@/components/post/create/CreatePost'
import { toast } from '@/components/ui/sonner'
import { saveComposerDraft } from '@/lib/utils/composerDraft'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockEnqueuePost = vi.hoisted(() => vi.fn())
const mockConvertWavToWebM = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() =>
	Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), info: vi.fn() })
)

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/lib/outbox', () => ({
	enqueuePost: mockEnqueuePost,
	MAX_QUEUED_MEDIA_BYTES: 100 * 1024 * 1024,
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
		mockEnqueuePost.mockResolvedValue(true)
		mockConvertWavToWebM.mockResolvedValue(
			new Blob(['converted'], { type: 'audio/webm;codecs=opus' })
		)
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

	it('keeps an oversized offline image in the composer and does not queue it', async () => {
		setOnline(false)
		const user = userEvent.setup()
		render(<CreatePost onPostCreated={vi.fn()} />)
		const composer = screen.getByPlaceholderText("What's on your mind?")
		const file = new File(['image'], 'oversized.png', { type: 'image/png' })
		Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 + 1 })

		await user.type(composer, 'Keep all of this')
		await user.upload(screen.getByTestId('composer-image-input'), file)
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith('This file is too big to queue (100 MB limit).')
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

	it('falls back to the outbox when an online create throws TypeError', async () => {
		const user = userEvent.setup()
		const onPostCreated = vi.fn().mockRejectedValue(new TypeError('network failed'))
		render(<CreatePost onPostCreated={onPostCreated} />)

		await user.type(screen.getByPlaceholderText("What's on your mind?"), 'Connection blip')
		await user.click(screen.getByRole('button', { name: 'Post' }))

		await waitFor(() => expect(mockEnqueuePost).toHaveBeenCalledTimes(1))
		expect(onPostCreated).toHaveBeenCalledTimes(1)
		expect(mockEnqueuePost).toHaveBeenCalledWith(
			expect.objectContaining({ text: 'Connection blip' })
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
