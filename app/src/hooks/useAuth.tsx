import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import { SERVER_HOST } from '../lib/constants'
import { clearCsrfTokenCache } from '../lib/utils/fetch'

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

				// Clear CSRF token cache if auth state changes
				if (newAuthState.isAuthenticated !== authState.isAuthenticated) {
					clearCsrfTokenCache()
				}

				setAuthState(newAuthState)
			}
		} catch (error) {
			console.error('Error checking auth status:', error)
		}
	}, [authState.isAuthenticated])

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
