import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SERVER_HOST } from '../lib/constants'
import { clearCsrfTokenCache } from '../lib/utils/fetch'
import { POSTS_QUERY_KEY } from './usePosts'

interface AuthState {
	isAuthenticated: boolean
	/** True until the first /auth/status/ resolves. Consumers that key storage on
	 * the user id (e.g. composer drafts) must wait this out, or they act on the
	 * pre-resolve `userId === null` and mistake a signed-in user for anonymous. */
	isAuthLoading: boolean
	/** True once /auth/status/ has actually answered. Distinct from
	 * `!isAuthLoading`, which also goes true when the check *failed* — and a
	 * failed check leaves `userId` at its null default, which is
	 * indistinguishable from a genuine anonymous visitor. Anything that would
	 * write the current user's data somewhere keyed on that id must gate on this
	 * one instead; being wrong there puts a signed-in user's content in the
	 * shared anonymous slot. Once true it stays true: a later failure does not
	 * invalidate the last answer we got. */
	isAuthResolved: boolean
	userId: number | null
	username: string | null
	avatar: string | null
	isStaff: boolean
	isSuperuser: boolean
}

interface AuthContextType extends AuthState {
	refreshAuthStatus: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const queryClient = useQueryClient()
	const hasCheckedAuth = useRef(false)
	// Last user id we resolved, held in a ref so checkAuthStatus can compare against
	// it without depending on authState.userId — depending on it would churn the
	// callback identity and re-fire the mount effect, double-fetching /auth/status/.
	const lastUserIdRef = useRef<number | null>(null)
	const [authState, setAuthState] = useState<AuthState>({
		isAuthenticated: false,
		isAuthLoading: true,
		isAuthResolved: false,
		userId: null,
		username: null,
		avatar: null,
		isStaff: false,
		isSuperuser: false,
	})

	const checkAuthStatus = useCallback(async () => {
		try {
			const response = await fetch(`${SERVER_HOST}/auth/status/`)
			if (response.ok) {
				const data = await response.json()
				const newAuthState = {
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
				// Skip on the initial check: the first posts fetch already ran
				// with the session cookie, so its data is correct.
				if (newAuthState.userId !== lastUserIdRef.current) {
					clearCsrfTokenCache()
					if (hasCheckedAuth.current) {
						queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY })
					}
				}
				lastUserIdRef.current = newAuthState.userId
				hasCheckedAuth.current = true

				setAuthState(newAuthState)
			} else {
				// A non-2xx (e.g. a 500 from the auth endpoint) is not an auth answer;
				// don't swallow it silently. The finally still resolves the loading gate.
				console.error('Auth status check returned HTTP', response.status)
			}
		} catch (error) {
			console.error('Error checking auth status:', error)
		} finally {
			// Resolve the loading gate after the first attempt, whatever the
			// outcome (ok, non-2xx, or thrown) — otherwise a failed initial check
			// would leave consumers waiting forever. Only touch state if still
			// loading, to avoid a redundant re-render on the happy path.
			//
			// `isAuthResolved` deliberately stays false here. The UI can render a
			// signed-out shell on a failed check and recover when the user acts;
			// storage keyed on the user id cannot, because the null it would key
			// on is a default rather than an answer.
			setAuthState((prev) => (prev.isAuthLoading ? { ...prev, isAuthLoading: false } : prev))
		}
	}, [queryClient])

	useEffect(() => {
		checkAuthStatus()
	}, [checkAuthStatus])

	const value: AuthContextType = {
		...authState,
		refreshAuthStatus: checkAuthStatus,
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
