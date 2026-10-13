import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixWebmDuration from 'webm-duration-fix'
import AudioRecorder from '@/components/post/create/AudioRecorder'
import { toast } from '@/components/ui/sonner'
import {
	FakeMediaRecorder,
	installCaptureFakes,
	makeFakeStream,
	setMediaRecorder,
} from '../helpers/mediaCapture'

vi.mock('webm-duration-fix', () => ({ default: vi.fn(async (blob: Blob) => blob) }))
vi.mock('@/components/ui/sonner', () => ({
	toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
let fakes: ReturnType<typeof installCaptureFakes>
let stream: ReturnType<typeof makeFakeStream>
let getUserMedia: ReturnType<typeof vi.fn<typeof navigator.mediaDevices.getUserMedia>>
let onAudioCaptured: ReturnType<typeof vi.fn<() => void>>
let onUploadInstead: ReturnType<typeof vi.fn<() => void>>
const mount = () =>
	render(
		<AudioRecorder autoStart onAudioCaptured={onAudioCaptured} onUploadInstead={onUploadInstead} />
	)
const recording = async () => {
	const view = mount()
	await screen.findByText('Recording...')
	return view
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(fixWebmDuration).mockImplementation(async (blob) => blob)
	stream = makeFakeStream()
	getUserMedia = vi.fn().mockResolvedValue(stream)
	fakes = installCaptureFakes({ getUserMedia })
	onAudioCaptured = vi.fn()
	onUploadInstead = vi.fn()
	localStorage.setItem('app-settings', JSON.stringify({ normalizeAudio: false }))
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	cleanup()
	fakes.reset()
})

describe('AudioRecorder', () => {
	it('explains denial inline and offers retry and upload without toasts', async () => {
		getUserMedia.mockRejectedValue(new DOMException('', 'NotAllowedError'))
		mount()
		expect(
			await screen.findByText(
				'Microphone access is blocked. Allow it for this site in your browser settings, then try again.'
			)
		).toBeInTheDocument()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
		expect(screen.getByRole('button', { name: 'Upload a file instead' })).toBeVisible()
		expect(toast.error).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it.each([
		['NotFoundError', 'No microphone was found. Connect one and try again.'],
		['NotReadableError', 'Your microphone is in use by another app. Close it and try again.'],
		['AbortError', 'Your microphone is in use by another app. Close it and try again.'],
	])('explains %s', async (name, copy) => {
		getUserMedia.mockRejectedValue(new DOMException('', name))
		mount()
		expect(await screen.findByText(copy)).toBeVisible()
	})
	it('offers only upload on an insecure origin with no mediaDevices', async () => {
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
		Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
		mount()
		expect(
			await screen.findByText(
				'Recording needs a secure connection (https). Open this page over https, or upload a file instead.'
			)
		).toBeVisible()
		expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
		click('Upload a file instead')
		expect(onUploadInstead).toHaveBeenCalledOnce()
		expect(getUserMedia).not.toHaveBeenCalled()
	})
	it('stops every acquired track when the recorder constructor throws', async () => {
		stream = makeFakeStream(['audio', 'audio'])
		getUserMedia.mockResolvedValue(stream)
		setMediaRecorder(
			class {
				constructor() {
					throw new DOMException('', 'NotSupportedError')
				}
			}
		)
		mount()
		expect(
			await screen.findByText(
				"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead."
			)
		).toBeVisible()
		for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
		expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
		expect(toast.error).not.toHaveBeenCalled()
	})
	it('finishes with no buttons, then attaches a WebM recording once', async () => {
		let finish!: (blob: Blob) => void
		vi.mocked(fixWebmDuration).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				})
		)
		await recording()
		expect(screen.getByText('00:00')).toBeVisible()
		click('Stop')
		expect(screen.getByText('Finishing recording...')).toBeVisible()
		expect(screen.queryAllByRole('button')).toHaveLength(0)
		expect(stream.tracks[0].stop).not.toHaveBeenCalled()
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		expect(stream.tracks[0].stop).toHaveBeenCalledOnce()
		expect(onAudioCaptured).not.toHaveBeenCalled()
		await act(async () => finish(vi.mocked(fixWebmDuration).mock.calls[0][0]))
		expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ type: 'audio/webm;codecs=opus' }),
			'attach'
		)
	})
	it('posts from the recorder', async () => {
		await recording()
		click('Post')
		await waitFor(() =>
			expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'post')
		)
	})
	it('pauses and resumes', async () => {
		await recording()
		expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('title', 'Pause')
		click('Pause')
		expect(screen.getByText('Recording paused')).toBeVisible()
		expect(FakeMediaRecorder.instances[0].state).toBe('paused')
		click('Resume')
		expect(screen.getByText('Recording...')).toBeVisible()
		expect(FakeMediaRecorder.instances[0].state).toBe('recording')
	})
	it.each([
		false,
		true,
	])('attaches and explains a disconnected mic, even after Post: %s', async (postFirst) => {
		await recording()
		act(() => {
			if (postFirst) click('Post')
			stream.tracks[0].end()
		})
		expect(FakeMediaRecorder.instances[0].state).toBe('inactive')
		await waitFor(() =>
			expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'attach')
		)
		expect(toast.info).toHaveBeenCalledExactlyOnceWith(
			'Microphone disconnected. The recording stopped and what was captured is attached.'
		)
	})
	it('keeps an empty disconnected recording inline with retry', async () => {
		FakeMediaRecorder.emitChunks = false
		await recording()
		act(() => stream.tracks[0].end())
		expect(
			await screen.findByText(
				'Your microphone disconnected before anything was recorded. Reconnect it and try again.'
			)
		).toBeVisible()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
		expect(onAudioCaptured).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})
	it('shows mute and unmute without attaching or stopping', async () => {
		await recording()
		act(() => stream.tracks[0].mute())
		expect(screen.getByText('Microphone paused by your device')).toBeVisible()
		expect(FakeMediaRecorder.instances[0].state).toBe('recording')
		act(() => stream.tracks[0].unmute())
		expect(screen.getByText('Recording...')).toBeVisible()
		expect(onAudioCaptured).not.toHaveBeenCalled()
	})
	it('attaches and explains a recorder error', async () => {
		await recording()
		act(() => FakeMediaRecorder.instances[0].fail())
		await waitFor(() =>
			expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'attach')
		)
		expect(toast.info).toHaveBeenCalledExactlyOnceWith(
			'Recording stopped unexpectedly. What was captured is attached.'
		)
	})
	it('keeps MP4 audio without calling the WebM fixer', async () => {
		FakeMediaRecorder.chunkType = 'audio/mp4;codecs=mp4a.40.2'
		await recording()
		click('Stop')
		await waitFor(() =>
			expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ type: 'audio/mp4;codecs=mp4a.40.2' }),
				'attach'
			)
		)
		expect(fixWebmDuration).not.toHaveBeenCalled()
	})
	it('offers retry inline when processing fails', async () => {
		vi.mocked(fixWebmDuration).mockRejectedValueOnce(new Error('cannot finalize'))
		await recording()
		click('Stop')
		expect(await screen.findByText("Couldn't finish the recording. Try again.")).toBeVisible()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
		expect(onAudioCaptured).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it('retries once on an explicit click', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('', 'NotAllowedError'))
		mount()
		await screen.findByRole('button', { name: 'Try again' })
		click('Try again')
		await screen.findByText('Recording...')
		expect(getUserMedia).toHaveBeenCalledTimes(2)
	})
	it('discards on unmount and stops tracks before a queued onstop can attach', async () => {
		const { unmount } = await recording()
		unmount()
		await act(async () => {})
		expect(stream.tracks[0].stop).toHaveBeenCalledOnce()
		expect(onAudioCaptured).not.toHaveBeenCalled()
	})
	it('explains an empty normal Stop', async () => {
		FakeMediaRecorder.emitChunks = false
		await recording()
		click('Stop')
		expect(await screen.findByText('Nothing was recorded. Try again.')).toBeVisible()
		expect(onAudioCaptured).not.toHaveBeenCalled()
	})
	it('releases a stream acquired after unmount', async () => {
		let grant!: (stream: MediaStream) => void
		getUserMedia.mockReturnValue(
			new Promise((resolve) => {
				grant = resolve
			})
		)
		const { unmount } = mount()
		expect(screen.getByText('Initializing microphone...')).toBeVisible()
		unmount()
		await act(async () => grant(stream))
		expect(stream.tracks[0].stop).toHaveBeenCalledOnce()
		expect(FakeMediaRecorder.instances).toHaveLength(0)
		expect(onAudioCaptured).not.toHaveBeenCalled()
	})
	it('discards a recording if unmounted during processing', async () => {
		let finish!: (blob: Blob) => void
		vi.mocked(fixWebmDuration).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				})
		)
		const { unmount } = await recording()
		click('Stop')
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		unmount()
		await act(async () => finish(new Blob(['data'], { type: 'audio/webm' })))
		expect(onAudioCaptured).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it('shows normalization immediately and finalizes the raw recording if normalization fails', async () => {
		localStorage.setItem('app-settings', JSON.stringify({ normalizeAudio: true }))
		let finish!: (blob: Blob) => void
		vi.mocked(fixWebmDuration).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				})
		)
		await recording()
		click('Stop')
		// The minimal AudioContext fake cannot decode; normalization falls back to finalization.
		expect(await screen.findByText('Normalizing audio...')).toBeVisible()
		expect(screen.queryAllByRole('button')).toHaveLength(0)
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		await act(async () => finish(vi.mocked(fixWebmDuration).mock.calls[0][0]))
		expect(onAudioCaptured).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ type: 'audio/webm;codecs=opus' }),
			'attach'
		)
		expect(toast.error).not.toHaveBeenCalled()
	})
	it('uses the empty copy for a recorder error with no captured data', async () => {
		FakeMediaRecorder.emitChunks = false
		await recording()
		act(() => FakeMediaRecorder.instances[0].fail())
		expect(await screen.findByText('Nothing was recorded. Try again.')).toBeVisible()
		expect(onAudioCaptured).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})
})
