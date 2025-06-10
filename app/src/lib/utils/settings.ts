import { isDesktop, isFirefox, isSafari } from '@/lib/utils/browser'

const SETTINGS_KEY = 'app-settings'

interface AppSettings {
	normalizeAudio: boolean
	videoQuality: 'low' | 'high'
}

// Determine if audio normalization should be enabled by default
const shouldNormalizeAudioByDefault = (): boolean => {
	if (!isDesktop()) return false
	return isFirefox() || isSafari()
}

const defaultSettings: AppSettings = {
	normalizeAudio: shouldNormalizeAudioByDefault(),
	videoQuality: 'low',
}

export const getSettings = (): AppSettings => {
	try {
		const stored = localStorage.getItem(SETTINGS_KEY)
		return stored ? JSON.parse(stored) : defaultSettings
	} catch (error) {
		console.error('Error reading settings:', error)
		return defaultSettings
	}
}

export const updateSettings = (settings: Partial<AppSettings>): void => {
	try {
		const current = getSettings()
		const updated = { ...current, ...settings }
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
	} catch (error) {
		console.error('Error saving settings:', error)
	}
}
