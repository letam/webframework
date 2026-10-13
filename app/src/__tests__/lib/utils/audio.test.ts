import { afterEach, expect, it, vi } from 'vitest'
import { convertWavToWebM, getAudioExtension } from '@/lib/utils/audio'
vi.mock('@/lib/utils/media', () => ({ supportedAudioMimeType: undefined }))
afterEach(() => vi.unstubAllGlobals())
it.each([
	['audio/webm;codecs=opus', 'webm'],
	['audio/mp4;codecs=mp4a.40.2', 'm4a'],
	['audio/ogg', 'ogg'],
	['audio/wav', 'wav'],
	['audio/mpeg', 'mp3'],
	['audio/flac', 'webm'],
])('maps %s to %s', (type, extension) => expect(getAudioExtension(type)).toBe(extension))
it('returns WAV unchanged without constructing an AudioContext when no encoder exists', async () => {
	const audioContext = vi.fn()
	vi.stubGlobal('AudioContext', audioContext)
	const wav = new Blob(['wav'], { type: 'audio/wav' })
	expect(await convertWavToWebM(wav)).toBe(wav)
	expect(audioContext).not.toHaveBeenCalled()
})
