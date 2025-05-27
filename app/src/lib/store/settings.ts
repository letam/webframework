import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface SettingsState {
	normalizeAudio: boolean
	setNormalizeAudio: (normalize: boolean) => void
}

export const useSettings = create<SettingsState>()(
	persist(
		(set) => ({
			normalizeAudio: true, // Default to true for better audio quality
			setNormalizeAudio: (normalize) => set({ normalizeAudio: normalize }),
		}),
		{
			name: 'app-settings',
		}
	)
)
