import { ApiError } from '../api/errors'
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

	// Fetch new token. Throw a status-carrying error rather than letting
	// response.json() choke on an error page: callers that classify failures
	// by HTTP status (the outbox retry taxonomy) need to see the real status.
	const response = await fetch(`${SERVER_HOST}/auth/csrf/`)
	if (!response.ok) {
		throw new ApiError('Failed to fetch CSRF token', response.status)
	}
	const data = await response.json()

	// Cache the token with 1 hour expiration
	csrfTokenCache = {
		token: data.token,
		expiresAt: now + 60 * 60 * 1000, // 1 hour in milliseconds
	}

	return data.token
}

// Helper function to build fetch options (credentials mode + CSRF token).
//
// `same-origin` is the fetch default; we state it so the contract is explicit.
// Production serves the SPA from Django (VITE_SERVER_HOST=''), so every API call
// is same-origin and the session cookie rides along. Pointing the app at a
// different-origin API would need `credentials: 'include'` here *and* server-side
// `CORS_ALLOW_CREDENTIALS = True` with `SameSite=None; Secure` cookies and matching
// CSRF trusted origins — a deliberate cross-origin posture, not a one-liner.
export const getFetchOptions = async (
	method: string,
	body?: Record<string, unknown> | FormData | null
) => {
	const options: RequestInit = {
		method,
		credentials: 'same-origin',
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
