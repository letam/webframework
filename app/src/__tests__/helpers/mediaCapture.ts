import { vi } from 'vitest'

export class FakeMediaStreamTrack extends EventTarget {
	kind: 'audio' | 'video'
	readyState = 'live'
	muted = false
	constructor(kind: 'audio' | 'video') {
		super()
		this.kind = kind
	}
	stop = vi.fn(() => {
		this.readyState = 'ended'
	})
	end() {
		this.readyState = 'ended'
		this.dispatchEvent(new Event('ended'))
	}
	mute() {
		this.muted = true
		this.dispatchEvent(new Event('mute'))
	}
	unmute() {
		this.muted = false
		this.dispatchEvent(new Event('unmute'))
	}
}
export const makeFakeStream = (kinds: ('audio' | 'video')[] = ['audio']) => {
	const tracks = kinds.map((kind) => new FakeMediaStreamTrack(kind))
	return {
		tracks,
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
		getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
	} as unknown as MediaStream & { tracks: FakeMediaStreamTrack[] }
}
export class FakeMediaRecorder {
	static instances: FakeMediaRecorder[] = []
	static isTypeSupported = () => true
	static chunkType = 'audio/webm;codecs=opus'
	static emitChunks = true
	state: 'inactive' | 'recording' | 'paused' = 'inactive'
	stream: MediaStream
	mimeType: string
	ondataavailable: ((event: { data: Blob }) => void) | null = null
	onstop: (() => void) | null = null
	onerror: ((event: { error: DOMException }) => void) | null = null
	constructor(stream: MediaStream) {
		this.stream = stream
		// Configure the actual output container independently of the requested encoder.
		this.mimeType = FakeMediaRecorder.chunkType
		FakeMediaRecorder.instances.push(this)
	}
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
		queueMicrotask(() => {
			if (FakeMediaRecorder.emitChunks)
				this.ondataavailable?.({
					data: new Blob(['chunk'], { type: this.mimeType ?? FakeMediaRecorder.chunkType }),
				})
			this.onstop?.()
		})
	}
	fail() {
		this.onerror?.({ error: new DOMException('x', 'UnknownError') })
		if (this.state !== 'inactive') this.stop()
	}
}

// The shared setup makes these properties non-configurable, but writable.
export const setMediaRecorder = (value: unknown) => {
	Object.defineProperty(globalThis, 'MediaRecorder', { value })
	Object.defineProperty(window, 'MediaRecorder', { value })
}
export const installCaptureFakes = (opts?: {
	getUserMedia?: typeof navigator.mediaDevices.getUserMedia
}) => {
	const recorder = MediaRecorder
	const descriptors = [
		[navigator, 'mediaDevices'],
		[window, 'isSecureContext'],
		[URL, 'createObjectURL'],
		[URL, 'revokeObjectURL'],
	] as const
	const originals = descriptors.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key))
	const getUserMedia = opts?.getUserMedia ?? vi.fn().mockResolvedValue(makeFakeStream())
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
	Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
	Object.defineProperty(URL, 'createObjectURL', {
		configurable: true,
		value: vi.fn(() => 'blob:recording'),
	})
	Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
	FakeMediaRecorder.instances = []
	FakeMediaRecorder.chunkType = 'audio/webm;codecs=opus'
	FakeMediaRecorder.emitChunks = true
	setMediaRecorder(FakeMediaRecorder)
	vi.stubGlobal(
		'AudioContext',
		class {
			createMediaStreamSource = () => ({ connect: vi.fn() })
			createAnalyser = () => ({
				fftSize: 512,
				getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
			})
			resume = vi.fn().mockResolvedValue(undefined)
			close = vi.fn().mockResolvedValue(undefined)
		}
	)
	vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
	vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
	return {
		getUserMedia,
		reset: () => {
			setMediaRecorder(recorder)
			descriptors.forEach(([target, key], index) => {
				const original = originals[index]
				if (original) Object.defineProperty(target, key, original)
				else Reflect.deleteProperty(target, key)
			})
			vi.unstubAllGlobals()
			vi.restoreAllMocks()
		},
	}
}
