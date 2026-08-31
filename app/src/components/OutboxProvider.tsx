import { useEffect, useRef, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { configureOutbox, flushOutbox, handleOutboxOnline, loadOutbox } from '@/lib/outbox'

interface OutboxProviderProps {
	children: ReactNode
}

export const OutboxProvider = ({ children }: OutboxProviderProps) => {
	const queryClient = useQueryClient()
	const auth = useAuth()
	const authRef = useRef(auth)
	authRef.current = auth

	useEffect(() => {
		configureOutbox({
			queryClient,
			// getAuthSnapshot reads a ref useAuth writes before React commits, so a
			// flush that runs right after refreshAuthStatus resolves sees the fresh
			// identity — the rendered context value would still be one commit behind.
			getAuthState: () => authRef.current.getAuthSnapshot(),
			refreshAuthStatus: () => authRef.current.refreshAuthStatus(),
		})

		let active = true
		void loadOutbox().then((loaded) => {
			if (active && loaded) void flushOutbox()
		})
		const onOnline = () => void handleOutboxOnline()
		window.addEventListener('online', onOnline)

		return () => {
			active = false
			window.removeEventListener('online', onOnline)
		}
	}, [queryClient])

	// Keyed on identity, not just the known flag: a login/logout makes different
	// entries visible (and flushable), so it must trigger a pass of its own.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional change triggers, not reads
	useEffect(() => {
		if (auth.isAuthResolved) void flushOutbox()
	}, [auth.isAuthResolved, auth.isAuthenticated, auth.userId])

	return children
}
