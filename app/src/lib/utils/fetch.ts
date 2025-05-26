import { SERVER_HOST } from '../constants'

// CSRF token cache
interface CsrfTokenCache {
	token: string
	expiresAt: number
}

let csrfTokenCache: CsrfTokenCache | null = null

// Helper function to clear CSRF token cache
export const clearCsrfTokenCache = () => {
	csrfTokenCache = null
}

// Helper function to get CSRF token with caching
export const getCsrfToken = async () => {
	// Check if we have a valid cached token (valid for 1 hour)
	const now = Date.now()
	if (csrfTokenCache && csrfTokenCache.expiresAt > now) {
		return csrfTokenCache.token
	}

	// Fetch new token
	const response = await fetch(`${SERVER_HOST}/auth/csrf/`)
	const data = await response.json()

	// Cache the token with 1 hour expiration
	csrfTokenCache = {
		token: data.token,
		expiresAt: now + 60 * 60 * 1000, // 1 hour in milliseconds
	}

	return data.token
}

// Helper function to get fetch options with credentials and CSRF token
export const getFetchOptions = async (
	method: string,
	body?: Record<string, unknown> | FormData | null
) => {
	const options: RequestInit = {
		method,
		headers: {},
	}

	// Add CSRF token for destructive methods
	if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
		const csrfToken = await getCsrfToken()
		options.headers = {
			...options.headers,
			'X-CSRFToken': csrfToken,
		}
	}

	// Only set Content-Type for JSON requests
	if (body && !(body instanceof FormData)) {
		options.headers = {
			...options.headers,
			'Content-Type': 'application/json',
		}
		options.body = JSON.stringify(body)
	} else if (body) {
		options.body = body as BodyInit
	}

	return options
}
