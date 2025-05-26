import { useState, useEffect, createContext, useContext, useCallback } from 'react'
import { SERVER_HOST } from '../lib/constants'

interface AuthState {
	isAuthenticated: boolean
	userId: number | null
	username: string | null
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
	})

	const checkAuthStatus = useCallback(async () => {
		try {
			const response = await fetch(`${SERVER_HOST}/auth/status/`)
			if (response.ok) {
				const data = await response.json()
				setAuthState({
					isAuthenticated: data.is_authenticated,
					userId: data.user_id,
					username: data.username,
				})
			}
		} catch (error) {
			console.error('Error checking auth status:', error)
		}
	}, [])

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
