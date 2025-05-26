import { SERVER_HOST } from '../constants'
import { getFetchOptions } from '../utils/fetch'

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
