import type { OutboxEntry } from '@/lib/utils/outboxDb'

export interface ComposerLoadHandle {
	/** Makes the loaded entry submittable after its durable outbox copy is removed. */
	commit: () => void
	/** Clears the loaded entry only if the composer has not changed since loading. */
	rollback: () => boolean
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
