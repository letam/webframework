import { SERVER_HOST } from '../constants'
import { clearCsrfTokenCache, csrfFetch, getFetchOptions } from '../utils/fetch'

interface LoginData extends Record<string, unknown> {
	username: string
	password: string
}

export const login = async (data: LoginData): Promise<Response> => {
	const options = await getFetchOptions('POST', data)
	try {
		return await csrfFetch(`${SERVER_HOST}/auth/login/`, options)
	} finally {
		clearCsrfTokenCache()
	}
}

interface SignupData extends Record<string, unknown> {
	username: string
	password1: string
	password2: string
}

export const signup = async (
	data: SignupData
): Promise<{ user_id: number; username: string; message: string }> => {
	try {
		const options = await getFetchOptions('POST', data)
		let response: Response
		try {
			response = await csrfFetch(`${SERVER_HOST}/auth/signup/`, options)
		} finally {
			// The cookie may have rotated even if the request or body read fails.
			clearCsrfTokenCache()
		}

		if (!response.ok) {
			const errors = await response.json()
			throw new Error(JSON.stringify(errors))
		}

		return await response.json()
	} catch (error) {
		console.error('Error signing up:', error)
		throw error
	}
}

export const logout = async (): Promise<void> => {
	try {
		const options = await getFetchOptions('POST')
		const response = await csrfFetch(`${SERVER_HOST}/auth/logout/`, options)
		if (!response.ok) {
			throw new Error('Failed to logout')
		}
	} catch (error) {
		console.error('Error logging out:', error)
		throw error
	}
}
