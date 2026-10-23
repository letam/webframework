import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	assembleRecording,
	fixRecordingDuration,
	resolveFixWebmDuration,
} from '@/lib/utils/webmDuration'

const fixWebmDuration = vi.hoisted(() => vi.fn<(blob: Blob) => Promise<Blob>>())

// The shape the production build hands to `import('webm-duration-fix')`: Rolldown's
// Node-style interop makes `default` the whole CommonJS `module.exports`, so the
// function is at `default.default`. Reading `default` alone threw "t is not a
// function" in production and failed every recording.
vi.mock('webm-duration-fix', () => ({
	default: { __esModule: true, default: fixWebmDuration },
}))

describe('resolveFixWebmDuration', () => {
	const fn = async (blob: Blob) => blob

	it('accepts the dev-server shape, where default is the function', () => {
		expect(resolveFixWebmDuration({ default: fn })).toBe(fn)
	})

	it('accepts the production shape, where default is module.exports', () => {
		expect(resolveFixWebmDuration({ default: { __esModule: true, default: fn } })).toBe(fn)
	})

	it('throws when no function is exported', () => {
		expect(() => resolveFixWebmDuration({ default: {} })).toThrow(TypeError)
	})
})

describe('fixRecordingDuration', () => {
	let consoleError: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		fixWebmDuration.mockReset()
		consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		consoleError.mockRestore()
	})

	it('fixes a WebM recording through the production-shaped import', async () => {
		const recorded = new Blob(['webm'], { type: 'audio/webm;codecs=opus' })
		const fixed = new Blob(['fixed'], { type: 'audio/webm;codecs=opus' })
		fixWebmDuration.mockResolvedValue(fixed)

		await expect(fixRecordingDuration(recorded)).resolves.toBe(fixed)
		expect(fixWebmDuration).toHaveBeenCalledWith(recorded)
	})

	it('fixes WebM video too', async () => {
		const recorded = new Blob(['webm'], { type: 'video/webm;codecs=vp9,opus' })
		const fixed = new Blob(['fixed'], { type: 'video/webm' })
		fixWebmDuration.mockResolvedValue(fixed)

		await expect(fixRecordingDuration(recorded)).resolves.toBe(fixed)
	})

	it('passes MP4 recordings through untouched, since the EBML parser rejects them', async () => {
		const recorded = new Blob(['mp4'], { type: 'audio/mp4;codecs=mp4a.40.2' })

		await expect(fixRecordingDuration(recorded)).resolves.toBe(recorded)
		expect(fixWebmDuration).not.toHaveBeenCalled()
	})

	it('keeps the original recording and logs the cause when the fix throws', async () => {
		const recorded = new Blob(['webm'], { type: 'audio/webm' })
		const cause = new Error('Unrepresentable length: Infinity')
		fixWebmDuration.mockRejectedValue(cause)

		await expect(fixRecordingDuration(recorded)).resolves.toBe(recorded)
		expect(consoleError).toHaveBeenCalledWith(expect.any(String), cause)
	})
})

describe('assembleRecording', () => {
	it('joins chunks and takes the type from the first chunk', () => {
		const blob = assembleRecording([
			new Blob(['ab'], { type: 'audio/webm' }),
			new Blob(['c'], { type: 'audio/webm' }),
		])
		expect(blob.size).toBe(3)
		expect(blob.type).toBe('audio/webm')
	})

	it('uses an explicit type when given', () => {
		expect(assembleRecording([new Blob(['a'])], 'audio/webm;codecs=opus').type).toBe(
			'audio/webm;codecs=opus'
		)
	})

	it('throws on a recording that captured nothing', () => {
		expect(() => assembleRecording([])).toThrow('MediaRecorder produced no data')
	})
})
