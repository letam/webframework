import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixWebmDuration from 'webm-duration-fix'
import { finalizeRecording } from '@/lib/utils/capture'
import VideoRecorder from '@/components/post/create/VideoRecorder'
import { toast } from '@/components/ui/sonner'
import {
	FakeMediaRecorder,
	installCaptureFakes,
	makeFakeStream,
	setMediaRecorder,
} from '../helpers/mediaCapture'

vi.mock('@/lib/utils/capture', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/lib/utils/capture')>()
	return { ...actual, finalizeRecording: vi.fn(actual.finalizeRecording) }
})
vi.mock('webm-duration-fix', () => ({ default: vi.fn(async (blob: Blob) => blob) }))
vi.mock('@/components/ui/sonner', () => ({
	toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
let fakes: ReturnType<typeof installCaptureFakes>
let stream: ReturnType<typeof makeFakeStream>
let getUserMedia: ReturnType<typeof vi.fn<typeof navigator.mediaDevices.getUserMedia>>
let onVideoCaptured: ReturnType<typeof vi.fn<() => void>>
let onUploadInstead: ReturnType<typeof vi.fn<() => void>>
const mount = (autoStart = true) =>
	render(
		<VideoRecorder
			autoStart={autoStart}
			onVideoCaptured={onVideoCaptured}
			onUploadInstead={onUploadInstead}
		/>
	)
const recording = async () => {
	const view = mount()
	await screen.findByText('Recording video...')
	return view
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(fixWebmDuration).mockImplementation(async (blob) => blob)
	stream = makeFakeStream(['video', 'audio'])
	getUserMedia = vi.fn().mockResolvedValue(stream)
	fakes = installCaptureFakes({ getUserMedia })
	FakeMediaRecorder.chunkType = 'video/webm'
	onVideoCaptured = vi.fn()
	onUploadInstead = vi.fn()
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	cleanup()
	fakes.reset()
})

describe('VideoRecorder', () => {
	it('explains denial inline without toasts', async () => {
		getUserMedia.mockRejectedValue(new DOMException('', 'NotAllowedError'))
		mount()
		expect(
			await screen.findByText(
				'Camera access is blocked. Allow it for this site in your browser settings, then try again.'
			)
		).toBeVisible()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
		click('Upload a file instead')
		expect(onUploadInstead).toHaveBeenCalledOnce()
		expect(toast.error).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it('retries overconstrained video once with relaxed constraints', async () => {
		getUserMedia.mockRejectedValueOnce(new DOMException('', 'OverconstrainedError'))
		await recording()
		expect(getUserMedia).toHaveBeenCalledTimes(2)
		expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: { facingMode: 'user' }, audio: true })
	})
	it('shows overconstrained copy after the second rejection', async () => {
		getUserMedia.mockRejectedValue(new DOMException('', 'OverconstrainedError'))
		mount()
		expect(
			await screen.findByText(
				"Your camera couldn't be set up. Try again, or upload a file instead."
			)
		).toBeVisible()
		expect(getUserMedia).toHaveBeenCalledTimes(2)
	})
	it('offers Start recording when idle', async () => {
		mount(false)
		expect(getUserMedia).not.toHaveBeenCalled()
		click('Start recording')
		await screen.findByText('Recording video...')
		expect(getUserMedia).toHaveBeenCalledOnce()
	})
	it('shows loading while permission is pending', () => {
		getUserMedia.mockReturnValue(new Promise(() => {}))
		mount()
		expect(screen.getByText('Initializing camera...')).toBeVisible()
	})
	it.each([
		['Stop', 'attach'],
		['Post', 'post'],
	])('finishes %s without buttons then hands off as %s', async (button, action) => {
		let finish!: (blob: Blob) => void
		vi.mocked(fixWebmDuration).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve
				})
		)
		await recording()
		click(button)
		expect(screen.getByText('Finishing recording...')).toBeVisible()
		expect(screen.getByText('00:00')).toBeVisible()
		expect(screen.queryAllByRole('button')).toHaveLength(0)
		for (const track of stream.tracks) expect(track.stop).not.toHaveBeenCalled()
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
		await act(async () => finish(vi.mocked(fixWebmDuration).mock.calls[0][0]))
		expect(onVideoCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), action)
	})
	it.each([
		false,
		true,
	])('attaches a disconnected camera and explains it, even after Post: %s', async (postFirst) => {
		await recording()
		act(() => {
			if (postFirst) click('Post')
			stream.tracks[0].end()
		})
		await waitFor(() =>
			expect(onVideoCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'attach')
		)
		expect(toast.info).toHaveBeenCalledExactlyOnceWith(
			'Camera disconnected. The recording stopped and what was captured is attached.'
		)
	})
	it('shows mute until every track is unmuted', async () => {
		await recording()
		act(() => {
			stream.tracks[0].mute()
			stream.tracks[1].mute()
		})
		expect(screen.getByText('Camera paused by your device')).toBeVisible()
		act(() => stream.tracks[0].unmute())
		expect(screen.getByText('Camera paused by your device')).toBeVisible()
		act(() => stream.tracks[1].unmute())
		expect(screen.getByText('Recording video...')).toBeVisible()
		expect(onVideoCaptured).not.toHaveBeenCalled()
	})
	it('bypasses the WebM fixer for MP4', async () => {
		FakeMediaRecorder.chunkType = 'video/mp4'
		await recording()
		click('Stop')
		await waitFor(() =>
			expect(onVideoCaptured).toHaveBeenCalledExactlyOnceWith(
				expect.objectContaining({ type: 'video/mp4' }),
				'attach'
			)
		)
		expect(fixWebmDuration).not.toHaveBeenCalled()
	})
	it('stops both tracks on unmount without handing off', async () => {
		const { unmount } = await recording()
		unmount()
		await act(async () => {})
		for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
		expect(onVideoCaptured).not.toHaveBeenCalled()
	})
	it('releases a permission grant that resolves after unmount', async () => {
		let grant!: (stream: MediaStream) => void
		getUserMedia.mockReturnValue(
			new Promise((resolve) => {
				grant = resolve
			})
		)
		const { unmount } = mount()
		unmount()
		await act(async () => grant(stream))
		for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
		expect(FakeMediaRecorder.instances).toHaveLength(0)
		expect(onVideoCaptured).not.toHaveBeenCalled()
	})
	it('releases both tracks if construction fails', async () => {
		setMediaRecorder(
			class {
				constructor() {
					throw new DOMException('', 'NotSupportedError')
				}
			}
		)
		mount()
		await screen.findByText(
			"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead."
		)
		for (const track of stream.tracks) expect(track.stop).toHaveBeenCalledOnce()
		expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
	})
	it('explains a recorder error while attaching the partial recording', async () => {
		await recording()
		act(() => FakeMediaRecorder.instances[0].fail())
		await waitFor(() =>
			expect(onVideoCaptured).toHaveBeenCalledExactlyOnceWith(expect.any(Blob), 'attach')
		)
		expect(toast.info).toHaveBeenCalledExactlyOnceWith(
			'Recording stopped unexpectedly. What was captured is attached.'
		)
	})
	it('offers retry on a processing failure without toasting', async () => {
		vi.mocked(finalizeRecording).mockRejectedValueOnce(new Error('cannot finalize'))
		await recording()
		click('Stop')
		expect(await screen.findByText("Couldn't finish the recording. Try again.")).toBeVisible()
		expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
		expect(onVideoCaptured).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it.each([false, true])('explains empty video, disconnected: %s', async (interrupted) => {
		FakeMediaRecorder.emitChunks = false
		await recording()
		if (interrupted) act(() => stream.tracks[0].end())
		else click('Stop')
		expect(
			await screen.findByText(
				interrupted
					? 'Your camera disconnected before anything was recorded. Reconnect it and try again.'
					: 'Nothing was recorded. Try again.'
			)
		).toBeVisible()
		expect(onVideoCaptured).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
	})
	it('uses the empty copy for a recorder error with no captured data', async () => {
		FakeMediaRecorder.emitChunks = false
		await recording()
		act(() => FakeMediaRecorder.instances[0].fail())
		expect(await screen.findByText('Nothing was recorded. Try again.')).toBeVisible()
		expect(onVideoCaptured).not.toHaveBeenCalled()
		expect(toast.info).not.toHaveBeenCalled()
		expect(toast.error).not.toHaveBeenCalled()
	})
})
