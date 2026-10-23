import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { convertWavToWebM } from '@/lib/utils/audio'

// The real parser rejects a zero-byte blob; fixRecordingDuration swallows that,
// so only an explicit empty check stops convertWavToWebM resolving with nothing.
vi.mock('webm-duration-fix', () => ({
	default: async (blob: Blob) => {
		if (blob.size === 0)
			throw new TypeError("Cannot read properties of undefined (reading 'dataEnd')")
		return blob
	},
}))

// What the stubbed MediaRecorder emits on stop: one chunk per entry.
let recordedChunks: Blob[] = []

class FakeMediaRecorder {
	ondataavailable: ((e: { data: Blob }) => void) | null = null
	onstop: (() => void) | null = null
	start() {}
	stop() {
		for (const data of recordedChunks) this.ondataavailable?.({ data })
		this.onstop?.()
	}
}

class FakeAudioContext {
	decodeAudioData = async () => ({ duration: 0 })
	createMediaStreamDestination = () => ({ stream: {} })
	createBufferSource = () => ({ connect() {}, start() {}, stop() {}, buffer: null })
	close = async () => {}
}

describe('convertWavToWebM', () => {
	let consoleError: ReturnType<typeof vi.spyOn>
	const originalMediaRecorder = globalThis.MediaRecorder

	beforeEach(() => {
		vi.stubGlobal('AudioContext', FakeAudioContext)
		// vitest.setup.ts defines MediaRecorder as writable but non-configurable,
		// so vi.stubGlobal (which redefines the property) can't replace it.
		globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		globalThis.MediaRecorder = originalMediaRecorder
		consoleError.mockRestore()
		recordedChunks = []
	})

	const wav = () => new Blob(['RIFF'], { type: 'audio/wav' })

	it('resolves with the re-encoded WebM', async () => {
		recordedChunks = [new Blob(['opus'], { type: 'audio/webm' })]

		const webm = await convertWavToWebM(wav())

		expect(webm.size).toBe(4)
		expect(webm.type).toBe('audio/webm;codecs=opus')
	})

	it('rejects when the re-encode captured no audio, instead of uploading an empty file', async () => {
		recordedChunks = []

		await expect(convertWavToWebM(wav())).rejects.toThrow('MediaRecorder produced no data')
	})
})
