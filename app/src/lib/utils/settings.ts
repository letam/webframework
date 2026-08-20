import { isDesktop, isFirefox, isSafari } from '@/lib/utils/browser'

const SETTINGS_KEY = 'app-settings'

export interface AppSettings {
	normalizeAudio: boolean
	videoQuality: 'low' | 'high'
	autoTranscribe: boolean
	linkPreviews: boolean
	showLinkPreviews: boolean
	saveComposerDrafts: boolean
	postSyncDefault: 'auto' | 'local' | 'remember'
}

// Determine if audio normalization should be enabled by default
const shouldNormalizeAudioByDefault = (): boolean => {
	if (!isDesktop()) return false
	return isFirefox() || isSafari()
}

const defaultSettings: AppSettings = {
	normalizeAudio: shouldNormalizeAudioByDefault(),
	videoQuality: 'low',
	autoTranscribe: false,
	linkPreviews: true,
	showLinkPreviews: true,
	// On by default: the cost of an unwanted restore is one click, the cost of a
	// lost recording is the recording.
	saveComposerDrafts: true,
	// 'remember', not 'auto': an 'auto' default would reset the composer's sync
	// mode on reload and the mount flush would silently publish posts the user
	// explicitly held on this device.
	postSyncDefault: 'remember',
}

export const getSettings = (): AppSettings => {
	try {
		const stored = localStorage.getItem(SETTINGS_KEY)
		return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings
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
