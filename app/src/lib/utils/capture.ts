export type CaptureDevice = 'microphone' | 'camera'
export type CaptureAction = 'attach' | 'post'
export type RecordingStatus = 'idle' | 'loading' | 'recording' | 'paused' | 'finishing' | 'error'
export type CaptureErrorKind =
	| 'denied'
	| 'not-found'
	| 'in-use'
	| 'overconstrained'
	| 'insecure-context'
	| 'unsupported'
	| 'unknown'
	| 'empty'
	| 'disconnected-empty'
	| 'processing'
export type StreamInterruption = 'ended' | 'muted' | 'unmuted'

/** Pre-flight: why recording cannot start here, or null. */
export const captureSupportError = (): CaptureErrorKind | null => {
	if (!window.isSecureContext) return 'insecure-context'
	if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
		return 'unsupported'
	return null
}

export const classifyCaptureError = (error: unknown): CaptureErrorKind => {
	if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecure-context'
	if (!(error instanceof DOMException)) return 'unsupported'
	switch (error.name) {
		case 'NotAllowedError':
		case 'PermissionDeniedError':
		case 'SecurityError':
			return 'denied'
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return 'not-found'
		case 'NotReadableError':
		case 'TrackStartError':
		case 'AbortError':
			return 'in-use'
		case 'OverconstrainedError':
		case 'ConstraintNotSatisfiedError':
			return 'overconstrained'
		case 'NotSupportedError':
			return 'unsupported'
		default:
			return 'unknown'
	}
}

const errorMessages: Record<CaptureErrorKind, Record<CaptureDevice, string>> = {
	denied: {
		microphone:
			'Microphone access is blocked. Allow it for this site in your browser settings, then try again.',
		camera:
			'Camera access is blocked. Allow it for this site in your browser settings, then try again.',
	},
	'not-found': {
		microphone: 'No microphone was found. Connect one and try again.',
		camera: 'No camera was found. Connect one and try again.',
	},
	'in-use': {
		microphone: 'Your microphone is in use by another app. Close it and try again.',
		camera: 'Your camera is in use by another app. Close it and try again.',
	},
	overconstrained: {
		microphone: "Your microphone couldn't be set up. Try again, or upload a file instead.",
		camera: "Your camera couldn't be set up. Try again, or upload a file instead.",
	},
	'insecure-context': {
		microphone:
			'Recording needs a secure connection (https). Open this page over https, or upload a file instead.',
		camera:
			'Recording needs a secure connection (https). Open this page over https, or upload a file instead.',
	},
	unsupported: {
		microphone:
			"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead.",
		camera:
			"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead.",
	},
	unknown: {
		microphone: "Couldn't start the microphone. Try again, or upload a file instead.",
		camera: "Couldn't start the camera. Try again, or upload a file instead.",
	},
	empty: {
		microphone: 'Nothing was recorded. Try again.',
		camera: 'Nothing was recorded. Try again.',
	},
	'disconnected-empty': {
		microphone:
			'Your microphone disconnected before anything was recorded. Reconnect it and try again.',
		camera: 'Your camera disconnected before anything was recorded. Reconnect it and try again.',
	},
	processing: {
		microphone: "Couldn't finish the recording. Try again.",
		camera: "Couldn't finish the recording. Try again.",
	},
}

export const captureErrorMessage = (kind: CaptureErrorKind, device: CaptureDevice): string =>
	errorMessages[kind][device]
export const isRetryableCaptureError = (kind: CaptureErrorKind): boolean =>
	kind !== 'unsupported' && kind !== 'insecure-context'

const interruptionMessages: Record<'ended' | 'error', Record<CaptureDevice, string>> = {
	ended: {
		microphone: 'Microphone disconnected. The recording stopped and what was captured is attached.',
		camera: 'Camera disconnected. The recording stopped and what was captured is attached.',
	},
	error: {
		microphone: 'Recording stopped unexpectedly. What was captured is attached.',
		camera: 'Recording stopped unexpectedly. What was captured is attached.',
	},
}
export const interruptionToast = (interruption: 'ended' | 'error', device: CaptureDevice): string =>
	interruptionMessages[interruption][device]

export const watchStreamInterruptions = (
	stream: MediaStream,
	onChange: (event: StreamInterruption) => void
): (() => void) => {
	const tracks = stream.getTracks()
	const ended = () => onChange('ended')
	const muted = () => onChange('muted')
	const unmuted = () => onChange(tracks.some((track) => track.muted) ? 'muted' : 'unmuted')
	for (const track of tracks) {
		track.addEventListener('ended', ended)
		track.addEventListener('mute', muted)
		track.addEventListener('unmute', unmuted)
		if (track.muted) onChange('muted')
	}
	return () => {
		for (const track of tracks) {
			track.removeEventListener('ended', ended)
			track.removeEventListener('mute', muted)
			track.removeEventListener('unmute', unmuted)
		}
	}
}

export const stopStreamTracks = (stream: MediaStream | null | undefined): void => {
	for (const track of stream?.getTracks() ?? []) track.stop()
}
export const isWebmLike = (mimeType: string): boolean =>
	/^(audio|video)\/(webm|x-matroska)(;|$)/i.test(mimeType.trim())

export const finalizeRecording = async (blob: Blob): Promise<Blob> => {
	if (!isWebmLike(blob.type)) return blob
	// webm-duration-fix is CommonJS (`exports.default = fn`). Rollup unwraps that to the
	// function, but Vite's dev-server interop hands back the whole exports object as
	// `default`, so accept either shape rather than break recording under `bun dev`.
	const mod = await import('webm-duration-fix')
	const exported = mod.default as typeof mod.default | { default: typeof mod.default }
	const fixWebmDuration = typeof exported === 'function' ? exported : exported.default
	return fixWebmDuration(blob)
}

export const formatRecordingTime = (seconds: number): string => {
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}
