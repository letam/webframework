import { isDesktop, isFirefox, isSafari } from '@/lib/utils/browser'
import type { PostVisibility } from '@/types/post'

const SETTINGS_KEY = 'app-settings'

export interface AppSettings {
	normalizeAudio: boolean
	videoQuality: 'low' | 'high'
	autoTranscribe: boolean
	linkPreviews: boolean
	showLinkPreviews: boolean
	saveComposerDrafts: boolean
	postSyncDefault: 'auto' | 'local' | 'remember'
	defaultVisibility: PostVisibility
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
	// Private, so the composer's resting state is the one whose mistakes are
	// recoverable: publishing something meant to stay private cannot be taken back,
	// while a private post is one menu change away from public. Every post still
	// shows its visibility before it is sent.
	defaultVisibility: 'private',
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
