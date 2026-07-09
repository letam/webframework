import { SERVER_API_URL } from '../constants'
import { getFetchOptions } from '../utils/fetch'

interface AvatarResponse {
	avatar: string | null
}

export const uploadAvatar = async (file: File): Promise<AvatarResponse> => {
	const formData = new FormData()
	formData.append('avatar', file)
	const options = await getFetchOptions('POST', formData)
	const response = await fetch(`${SERVER_API_URL}/users/me/avatar/`, options)

	if (!response.ok) {
		throw new Error('Failed to update profile photo')
	}

	return response.json()
}

export const removeAvatar = async (): Promise<AvatarResponse> => {
	const options = await getFetchOptions('DELETE')
	const response = await fetch(`${SERVER_API_URL}/users/me/avatar/`, options)

	if (!response.ok) {
		throw new Error('Failed to remove profile photo')
	}

	return response.json()
}
