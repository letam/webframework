import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SERVER_HOST } from '../lib/constants'
import { clearCsrfTokenCache } from '../lib/utils/fetch'
import { POSTS_QUERY_KEY } from './usePosts'

interface AuthState {
	isAuthenticated: boolean
	/** True until the first /auth/status/ attempt finishes. */
	isAuthLoading: boolean
	/** True once /auth/status/ has actually answered. A failed request ends loading
	 * but leaves this false so user-keyed storage cannot mistake an unknown identity
	 * for a genuine anonymous visitor. Once true it stays true. */
	isAuthResolved: boolean
	userId: number | null
	username: string | null
	avatar: string | null
	isStaff: boolean
	isSuperuser: boolean
}

interface AuthContextType extends AuthState {
	refreshAuthStatus: () => Promise<boolean>
	getAuthSnapshot: () => AuthState
}

const AuthContext = createContext<AuthContextType | null>(null)

const INITIAL_AUTH_STATE: AuthState = {
	isAuthenticated: false,
	isAuthLoading: true,
	isAuthResolved: false,
	userId: null,
	username: null,
	avatar: null,
	isStaff: false,
	isSuperuser: false,
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const queryClient = useQueryClient()
	const hasCheckedAuth = useRef(false)
	const [authState, setAuthState] = useState<AuthState>(INITIAL_AUTH_STATE)
	const latestAuthRequestId = useRef(0)
	// Written before setAuthState commits, so callers that await refreshAuthStatus
	// (the outbox flush) can read the refreshed identity immediately.
	const latestAuthRef = useRef<AuthState>(INITIAL_AUTH_STATE)

	const checkAuthStatus = useCallback(async (): Promise<boolean> => {
		const requestId = ++latestAuthRequestId.current
		try {
			const response = await fetch(`${SERVER_HOST}/auth/status/`)
			if (!response.ok) {
				console.error('Auth status check returned HTTP', response.status)
				return false
			}

			const data = await response.json()
			// A later check may have started after this request captured an older
			// session cookie. Never let that older answer replace the latest identity,
			// and tell awaiting senders not to proceed with their stale check.
			if (requestId !== latestAuthRequestId.current) return false
			const newAuthState: AuthState = {
				isAuthenticated: data.is_authenticated,
				isAuthLoading: false,
				isAuthResolved: true,
				userId: data.user_id,
				username: data.username,
				avatar: data.avatar ?? null,
				isStaff: data.is_staff || false,
				isSuperuser: data.is_superuser || false,
			}

			// If the signed-in user changed, clear the CSRF token cache and
			// refetch posts so per-user fields (e.g. liked) are up to date.
			// Skip on the initial check: the first posts fetch already ran with
			// the session cookie, so its data is correct.
			if (newAuthState.userId !== latestAuthRef.current.userId) {
				clearCsrfTokenCache()
				if (hasCheckedAuth.current) {
					queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY })
				}
			}
			hasCheckedAuth.current = true

			latestAuthRef.current = newAuthState
			setAuthState(newAuthState)
			return true
		} catch (error) {
			console.error('Error checking auth status:', error)
			return false
		} finally {
			// End the UI loading state after a failed attempt, but keep
			// isAuthResolved false: null is still a default, not an auth answer.
			if (requestId === latestAuthRequestId.current) {
				setAuthState((previous) => {
					if (!previous.isAuthLoading) return previous
					const next = { ...previous, isAuthLoading: false }
					latestAuthRef.current = next
					return next
				})
			}
		}
	}, [queryClient])

	const getAuthSnapshot = useCallback(() => latestAuthRef.current, [])

	useEffect(() => {
		checkAuthStatus()
	}, [checkAuthStatus])

	const value: AuthContextType = {
		...authState,
		refreshAuthStatus: checkAuthStatus,
		getAuthSnapshot,
	}

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
	const context = useContext(AuthContext)
	if (!context) {
		throw new Error('useAuth must be used within an AuthProvider')
	}
	return context
}
