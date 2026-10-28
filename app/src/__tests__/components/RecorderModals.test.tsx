import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioRecorderModal } from '@/components/post/create/AudioRecorder'
import { VideoRecorderModal } from '@/components/post/create/VideoRecorder'
import { isIOS } from '@/lib/utils/browser'

vi.mock('@/lib/utils/browser', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/lib/utils/browser')>()),
	isIOS: vi.fn(() => false),
}))

class FakeMediaRecorder {
	state: 'inactive' | 'recording' | 'paused' = 'inactive'
	ondataavailable: ((e: { data: Blob }) => void) | null = null
	onstop: (() => void) | null = null
	constructor(public stream: MediaStream) {}
	start() {
		this.state = 'recording'
	}
	pause() {
		this.state = 'paused'
	}
	resume() {
		this.state = 'recording'
	}
	stop() {
		this.state = 'inactive'
	}
}

const fakeStream = () => ({ getTracks: () => [{ stop: () => {} }] }) as unknown as MediaStream

const originalMediaRecorder = globalThis.MediaRecorder
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

beforeEach(() => {
	vi.mocked(isIOS).mockReturnValue(false)
	// vitest.setup.ts defines MediaRecorder as writable but non-configurable, so it is
	// assigned rather than stubbed with vi.stubGlobal.
	globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: { getUserMedia: vi.fn(async () => fakeStream()) },
	})
	// The level meter is best-effort; without AudioContext it logs and carries on.
	vi.spyOn(console, 'error').mockImplementation(() => {})
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
})

afterEach(() => {
	globalThis.MediaRecorder = originalMediaRecorder
	if (originalMediaDevices) {
		Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
	} else {
		delete (navigator as { mediaDevices?: unknown }).mediaDevices
	}
	vi.restoreAllMocks()
})

const AudioHarness = () => {
	const [open, setOpen] = useState(true)
	return <AudioRecorderModal open={open} onOpenChange={setOpen} onAudioCaptured={() => {}} />
}

const VideoHarness = () => {
	const [open, setOpen] = useState(true)
	return <VideoRecorderModal open={open} onOpenChange={setOpen} onVideoCaptured={() => {}} />
}

// A tap outside the dialog lands on its overlay. Radix arms its outside-press
// listener on a timeout after mount, and for a primary-button press it waits for
// the click before dismissing, so send the full pointerdown + click and let the
// deferred handler run.
const pressOutside = async () => {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
	const overlay = document.querySelector('.fixed.inset-0')
	if (!overlay) throw new Error('dialog overlay not found')
	fireEvent.pointerDown(overlay)
	fireEvent.click(overlay)
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

describe('AudioRecorderModal', () => {
	it('stays open on an outside press while recording', async () => {
		render(<AudioHarness />)
		await screen.findByRole('button', { name: /stop recording/i })

		await pressOutside()

		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('still closes on Escape while recording', async () => {
		render(<AudioHarness />)
		await screen.findByRole('button', { name: /stop recording/i })

		fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
	})

	it('closes on an outside press when not recording', async () => {
		// Microphone denied: the recorder settles in its error state, not recording.
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: vi.fn(async () => {
					throw new DOMException('denied', 'NotAllowedError')
				}),
			},
		})
		render(<AudioHarness />)
		await screen.findByRole('button', { name: /try again/i })

		await pressOutside()

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
	})
})

describe('VideoRecorderModal', () => {
	it('stays open on an outside press while recording', async () => {
		render(<VideoHarness />)
		await screen.findByRole('button', { name: /stop recording/i })

		await pressOutside()

		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('closes on an outside press when not recording', async () => {
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: {
				getUserMedia: vi.fn(async () => {
					throw new DOMException('denied', 'NotAllowedError')
				}),
			},
		})
		render(<VideoHarness />)
		await screen.findByRole('button', { name: /try again/i })

		await pressOutside()

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
	})

	it('stays open on an outside press while a stopped take is still finalizing', async () => {
		// FakeMediaRecorder.stop never fires onstop, so the take stays mid-finalization.
		render(<VideoHarness />)
		fireEvent.click(await screen.findByRole('button', { name: /stop recording/i }))

		await pressOutside()

		expect(screen.getByRole('dialog')).toBeInTheDocument()
	})

	it('closes when the iOS native camera is dismissed without recording', async () => {
		// iOS records through the native camera behind a hidden file input; dismissing
		// it fires `cancel`, which used to leave an empty video placeholder on screen.
		vi.mocked(isIOS).mockReturnValue(true)
		const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
		render(<VideoHarness />)
		await waitFor(() => expect(click).toHaveBeenCalled())

		const input = document.querySelector('input[type="file"][accept="video/*"]')
		if (!input) throw new Error('camera input not found')
		fireEvent(input, new Event('cancel'))

		await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
	})
})
