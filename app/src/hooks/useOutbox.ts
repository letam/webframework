import { useSyncExternalStore } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
	getOutboxSnapshot,
	isOutboxEntryVisible,
	subscribeOutbox,
	type OutboxAuthState,
} from '@/lib/outbox'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

export { isOutboxEntryVisible }

export const getVisibleOutboxEntries = (
	entries: OutboxEntry[],
	auth: Pick<OutboxAuthState, 'isAuthenticated' | 'userId' | 'isAuthResolved'>
) =>
	auth.isAuthResolved
		? entries.filter((entry) => entry.status !== 'cancelled' && isOutboxEntryVisible(entry, auth))
		: entries.filter((entry) => entry.status !== 'cancelled' && entry.author === 'unknown')

export const useOutbox = () => {
	const snapshot = useSyncExternalStore(subscribeOutbox, getOutboxSnapshot, getOutboxSnapshot)
	const { isAuthenticated, userId, isAuthResolved } = useAuth()

	return {
		...snapshot,
		entries: getVisibleOutboxEntries(snapshot.entries, {
			isAuthenticated,
			userId,
			isAuthResolved,
		}),
	}
}
