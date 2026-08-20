import type { OutboxEntry } from '@/lib/utils/outboxDb'

export type ComposerLoader = (entry: OutboxEntry) => boolean

let composerLoader: ComposerLoader | null = null

export const registerComposerLoader = (loader: ComposerLoader) => {
	composerLoader = loader
	return () => {
		if (composerLoader === loader) composerLoader = null
	}
}

export const requestComposerLoad = (entry: OutboxEntry) => composerLoader?.(entry) ?? false
