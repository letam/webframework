import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixWebmDuration from 'webm-duration-fix'
import { AudioRecorderModal } from '@/components/post/create/AudioRecorder'
import { VideoRecorderModal } from '@/components/post/create/VideoRecorder'
import { installCaptureFakes, makeFakeStream } from '../helpers/mediaCapture'

vi.mock('webm-duration-fix', () => ({ default: vi.fn(async (blob: Blob) => blob) }))
vi.mock('@/components/ui/sonner', () => ({
	toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
// In a browser Radix keeps DialogContent mounted for its 200 ms exit animation; jsdom has
// no animations and unmounts it at once. This stand-in never unmounts its content, so
// these tests cover the window in which a closed dialog's recorder could still hand off.
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
	DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}))

let fakes: ReturnType<typeof installCaptureFakes>
let finish: (blob: Blob) => void
const noop = () => {}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(fixWebmDuration).mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve
			})
	)
	localStorage.setItem('app-settings', JSON.stringify({ normalizeAudio: false }))
	vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
	cleanup()
	fakes.reset()
})

describe('closing a recorder dialog while the take is still being finished', () => {
	it('does not hand off an audio take, even one stopped with Post', async () => {
		fakes = installCaptureFakes({ getUserMedia: vi.fn().mockResolvedValue(makeFakeStream()) })
		const onAudioCaptured = vi.fn()
		const modal = (open: boolean) => (
			<AudioRecorderModal
				open={open}
				onOpenChange={noop}
				onAudioCaptured={onAudioCaptured}
				onUploadInstead={noop}
			/>
		)
		const { rerender } = render(modal(true))
		await screen.findByText('Recording...')
		fireEvent.click(screen.getByRole('button', { name: 'Post' }))
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		rerender(modal(false))
		await act(async () => finish(new Blob(['data'], { type: 'audio/webm' })))
		expect(onAudioCaptured).not.toHaveBeenCalled()
	})

	it('does not hand off a video take, even one stopped with Post', async () => {
		fakes = installCaptureFakes({
			getUserMedia: vi.fn().mockResolvedValue(makeFakeStream(['video', 'audio'])),
		})
		const onVideoCaptured = vi.fn()
		const modal = (open: boolean) => (
			<VideoRecorderModal
				open={open}
				onOpenChange={noop}
				onVideoCaptured={onVideoCaptured}
				onUploadInstead={noop}
			/>
		)
		const { rerender } = render(modal(true))
		await screen.findByText('Recording video...')
		fireEvent.click(screen.getByRole('button', { name: 'Post' }))
		await waitFor(() => expect(fixWebmDuration).toHaveBeenCalledOnce())
		rerender(modal(false))
		await act(async () => finish(new Blob(['data'], { type: 'video/webm' })))
		expect(onVideoCaptured).not.toHaveBeenCalled()
	})
})
