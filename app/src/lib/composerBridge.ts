import type { OutboxEntry } from '@/lib/utils/outboxDb'

export interface ComposerLoadHandle {
	rollback: () => void
}

export type ComposerLoader = (entry: OutboxEntry) => ComposerLoadHandle | null

let composerLoader: ComposerLoader | null = null

export const registerComposerLoader = (loader: ComposerLoader) => {
	composerLoader = loader
	return () => {
		if (composerLoader === loader) composerLoader = null
	}
}

export const requestComposerLoad = (entry: OutboxEntry) => composerLoader?.(entry) ?? null
