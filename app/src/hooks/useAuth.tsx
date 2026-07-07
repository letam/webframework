import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SERVER_HOST } from '../lib/constants'
import { clearCsrfTokenCache } from '../lib/utils/fetch'
import { POSTS_QUERY_KEY } from './usePosts'

interface AuthState {
	isAuthenticated: boolean
	userId: number | null
	username: string | null
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
	const [authState, setAuthState] = useState<AuthState>({
		isAuthenticated: false,
		userId: null,
		username: null,
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
					userId: data.user_id,
					username: data.username,
					isStaff: data.is_staff || false,
					isSuperuser: data.is_superuser || false,
				}

				// If the signed-in user changed, clear the CSRF token cache and
				// refetch posts so per-user fields (e.g. liked) are up to date.
				// Skip on the initial check: the first posts fetch already ran
				// with the session cookie, so its data is correct.
				if (newAuthState.userId !== authState.userId) {
					clearCsrfTokenCache()
					if (hasCheckedAuth.current) {
						queryClient.invalidateQueries({ queryKey: POSTS_QUERY_KEY })
					}
				}
				hasCheckedAuth.current = true

				setAuthState(newAuthState)
			}
		} catch (error) {
			console.error('Error checking auth status:', error)
		}
	}, [authState.userId, queryClient])

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
