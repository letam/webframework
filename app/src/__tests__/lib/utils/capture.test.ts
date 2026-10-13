import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixWebmDuration from 'webm-duration-fix'
import {
	captureSupportError,
	classifyCaptureError,
	captureErrorMessage,
	isRetryableCaptureError,
	watchStreamInterruptions,
	stopStreamTracks,
	isWebmLike,
	finalizeRecording,
	formatRecordingTime,
	type CaptureErrorKind,
} from '@/lib/utils/capture'

vi.mock('webm-duration-fix', () => ({ default: vi.fn(async (blob: Blob) => blob) }))
const originalRecorder = MediaRecorder
const mediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const secureContext = Object.getOwnPropertyDescriptor(window, 'isSecureContext')
const secure = (value: boolean) =>
	Object.defineProperty(window, 'isSecureContext', { configurable: true, value })
beforeEach(() => {
	vi.clearAllMocks()
	secure(true)
	Object.defineProperty(navigator, 'mediaDevices', {
		configurable: true,
		value: { getUserMedia: vi.fn() },
	})
})
afterEach(() => {
	Object.defineProperty(globalThis, 'MediaRecorder', { value: originalRecorder })
	Object.defineProperty(window, 'MediaRecorder', { value: originalRecorder })
	if (mediaDevices) Object.defineProperty(navigator, 'mediaDevices', mediaDevices)
	else Reflect.deleteProperty(navigator, 'mediaDevices')
	if (secureContext) Object.defineProperty(window, 'isSecureContext', secureContext)
	else Reflect.deleteProperty(window, 'isSecureContext')
})
describe('capture', () => {
	it.each([
		['NotAllowedError', 'denied'],
		['PermissionDeniedError', 'denied'],
		['SecurityError', 'denied'],
		['NotFoundError', 'not-found'],
		['DevicesNotFoundError', 'not-found'],
		['NotReadableError', 'in-use'],
		['TrackStartError', 'in-use'],
		['AbortError', 'in-use'],
		['OverconstrainedError', 'overconstrained'],
		['ConstraintNotSatisfiedError', 'overconstrained'],
		['NotSupportedError', 'unsupported'],
		['FooError', 'unknown'],
	])('classifies %s as %s', (name, kind) => {
		expect(classifyCaptureError(new DOMException('', name))).toBe(kind)
	})
	it('classifies non-DOM errors as unsupported, with insecure context taking precedence', () => {
		expect(classifyCaptureError(new TypeError())).toBe('unsupported')
		expect(classifyCaptureError(new ReferenceError())).toBe('unsupported')
		secure(false)
		expect(classifyCaptureError(new TypeError())).toBe('insecure-context')
		expect(classifyCaptureError(new DOMException('', 'NotAllowedError'))).toBe('insecure-context')
	})
	it('checks secure context and capture APIs', () => {
		expect(captureSupportError()).toBeNull()
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
		expect(captureSupportError()).toBe('unsupported')
		Object.defineProperty(navigator, 'mediaDevices', {
			configurable: true,
			value: { getUserMedia: vi.fn() },
		})
		Object.defineProperty(globalThis, 'MediaRecorder', { value: undefined })
		Object.defineProperty(window, 'MediaRecorder', { value: undefined })
		expect(captureSupportError()).toBe('unsupported')
		secure(false)
		expect(captureSupportError()).toBe('insecure-context')
	})
	it('uses the exact error copy for both devices', () => {
		expect(captureErrorMessage('denied', 'microphone')).toBe(
			'Microphone access is blocked. Allow it for this site in your browser settings, then try again.'
		)
		expect(captureErrorMessage('denied', 'camera')).toBe(
			'Camera access is blocked. Allow it for this site in your browser settings, then try again.'
		)
		expect(captureErrorMessage('not-found', 'microphone')).toBe(
			'No microphone was found. Connect one and try again.'
		)
		expect(captureErrorMessage('not-found', 'camera')).toBe(
			'No camera was found. Connect one and try again.'
		)
		expect(captureErrorMessage('in-use', 'microphone')).toBe(
			'Your microphone is in use by another app. Close it and try again.'
		)
		expect(captureErrorMessage('in-use', 'camera')).toBe(
			'Your camera is in use by another app. Close it and try again.'
		)
		expect(captureErrorMessage('overconstrained', 'microphone')).toBe(
			"Your microphone couldn't be set up. Try again, or upload a file instead."
		)
		expect(captureErrorMessage('overconstrained', 'camera')).toBe(
			"Your camera couldn't be set up. Try again, or upload a file instead."
		)
		expect(captureErrorMessage('insecure-context', 'microphone')).toBe(
			'Recording needs a secure connection (https). Open this page over https, or upload a file instead.'
		)
		expect(captureErrorMessage('insecure-context', 'camera')).toBe(
			'Recording needs a secure connection (https). Open this page over https, or upload a file instead.'
		)
		expect(captureErrorMessage('unsupported', 'microphone')).toBe(
			"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead."
		)
		expect(captureErrorMessage('unsupported', 'camera')).toBe(
			"Recording isn't supported in this browser. Try the latest Safari or Chrome, or upload a file instead."
		)
		expect(captureErrorMessage('unknown', 'microphone')).toBe(
			"Couldn't start the microphone. Try again, or upload a file instead."
		)
		expect(captureErrorMessage('unknown', 'camera')).toBe(
			"Couldn't start the camera. Try again, or upload a file instead."
		)
		expect(captureErrorMessage('empty', 'microphone')).toBe('Nothing was recorded. Try again.')
		expect(captureErrorMessage('empty', 'camera')).toBe('Nothing was recorded. Try again.')
		expect(captureErrorMessage('disconnected-empty', 'microphone')).toBe(
			'Your microphone disconnected before anything was recorded. Reconnect it and try again.'
		)
		expect(captureErrorMessage('disconnected-empty', 'camera')).toBe(
			'Your camera disconnected before anything was recorded. Reconnect it and try again.'
		)
		expect(captureErrorMessage('processing', 'microphone')).toBe(
			"Couldn't finish the recording. Try again."
		)
		expect(captureErrorMessage('processing', 'camera')).toBe(
			"Couldn't finish the recording. Try again."
		)
	})
	it.each([
		'denied',
		'not-found',
		'in-use',
		'overconstrained',
		'unknown',
		'empty',
		'disconnected-empty',
		'processing',
		'unsupported',
		'insecure-context',
	] as CaptureErrorKind[])('offers retry for %s only when it can help', (kind) => {
		expect(isRetryableCaptureError(kind)).toBe(!['unsupported', 'insecure-context'].includes(kind))
	})
	it('watches every track, reports initial mute, and detaches', () => {
		const track = Object.assign(new EventTarget(), { muted: true, stop: vi.fn() })
		const second = Object.assign(new EventTarget(), { muted: false, stop: vi.fn() })
		const stream = { getTracks: () => [track, second] } as unknown as MediaStream
		const onChange = vi.fn()
		const detach = watchStreamInterruptions(stream, onChange)
		expect(onChange).toHaveBeenLastCalledWith('muted')
		track.dispatchEvent(new Event('ended'))
		expect(onChange).toHaveBeenLastCalledWith('ended')
		second.dispatchEvent(new Event('mute'))
		expect(onChange).toHaveBeenLastCalledWith('muted')
		track.muted = false
		track.dispatchEvent(new Event('unmute'))
		expect(onChange).toHaveBeenLastCalledWith('unmuted')
		detach()
		onChange.mockClear()
		for (const item of [track, second])
			for (const event of ['ended', 'mute', 'unmute']) item.dispatchEvent(new Event(event))
		expect(onChange).not.toHaveBeenCalled()
		stopStreamTracks(stream)
		expect(track.stop).toHaveBeenCalledOnce()
		expect(second.stop).toHaveBeenCalledOnce()
		stopStreamTracks(null)
	})
	it.each([
		'audio/webm;codecs=opus',
		'video/webm',
		'video/x-matroska;codecs=…',
		'audio/x-matroska',
		' VIDEO/WEBM ',
	])('recognizes %s', (type) => expect(isWebmLike(type)).toBe(true))
	it.each(['audio/mp4;codecs=mp4a.40.2', 'audio/wav', ''])('bypasses %s', (type) =>
		expect(isWebmLike(type)).toBe(false))
	it('returns non-WebM unchanged and fixes WebM once', async () => {
		const mp4 = new Blob(['data'], { type: 'audio/mp4' })
		expect(await finalizeRecording(mp4)).toBe(mp4)
		expect(fixWebmDuration).not.toHaveBeenCalled()
		const webm = new Blob(['data'], { type: 'audio/webm' })
		await finalizeRecording(webm)
		expect(fixWebmDuration).toHaveBeenCalledExactlyOnceWith(webm)
	})
	it.each([
		[0, '00:00'],
		[65, '01:05'],
		[3600, '60:00'],
	])('formats %s seconds', (seconds, formatted) =>
		expect(formatRecordingTime(Number(seconds))).toBe(formatted))
})
