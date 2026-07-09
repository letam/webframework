import { beforeEach, describe, expect, it } from 'vitest'
import { getSettings, updateSettings } from '@/lib/utils/settings'

describe('settings utilities', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('defaults auto-transcribe to false', () => {
		expect(getSettings().autoTranscribe).toBe(false)
	})

	it('persists auto-transcribe updates', () => {
		updateSettings({ autoTranscribe: true })

		expect(getSettings().autoTranscribe).toBe(true)
	})

	it('merges defaults into stored settings missing newer keys', () => {
		localStorage.setItem(
			'app-settings',
			JSON.stringify({ normalizeAudio: true, videoQuality: 'high' })
		)

		expect(getSettings()).toMatchObject({
			normalizeAudio: true,
			videoQuality: 'high',
			autoTranscribe: false,
		})
	})
})
