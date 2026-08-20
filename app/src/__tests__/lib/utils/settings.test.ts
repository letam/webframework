import { beforeEach, describe, expect, it } from 'vitest'
import { getSettings, updateSettings } from '@/lib/utils/settings'

describe('settings utilities', () => {
	beforeEach(() => {
		localStorage.clear()
	})

	it('defaults auto-transcribe to false', () => {
		expect(getSettings().autoTranscribe).toBe(false)
	})

	it('defaults link previews to true', () => {
		expect(getSettings().linkPreviews).toBe(true)
	})

	it('defaults showing link previews to true', () => {
		expect(getSettings().showLinkPreviews).toBe(true)
	})

	it('persists auto-transcribe updates', () => {
		updateSettings({ autoTranscribe: true })

		expect(getSettings().autoTranscribe).toBe(true)
	})

	it('persists post sync default updates', () => {
		updateSettings({ postSyncDefault: 'remember' })

		expect(getSettings().postSyncDefault).toBe('remember')
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
			linkPreviews: true,
			showLinkPreviews: true,
			postSyncDefault: 'remember',
		})
	})
})
