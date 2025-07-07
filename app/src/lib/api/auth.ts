import { SERVER_HOST } from '../constants'
import { getFetchOptions } from '../utils/fetch'

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
		const response = await fetch(`${SERVER_HOST}/auth/signup/`, options)

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
		const response = await fetch(`${SERVER_HOST}/auth/logout/`, options)
		if (!response.ok) {
			throw new Error('Failed to logout')
		}
	} catch (error) {
		console.error('Error logging out:', error)
		throw error
	}
}
