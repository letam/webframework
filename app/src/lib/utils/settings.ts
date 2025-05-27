const SETTINGS_KEY = 'app-settings'

interface AppSettings {
	normalizeAudio: boolean
}

const defaultSettings: AppSettings = {
	normalizeAudio: true, // Default to true for better audio quality
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
