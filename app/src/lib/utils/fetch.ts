import { ApiError } from '../api/errors'
import { SERVER_HOST } from '../constants'

// CSRF token cache
interface CsrfTokenCache {
	token: string
	expiresAt: number
}

let csrfTokenCache: CsrfTokenCache | null = null
let csrfGeneration = 0
let csrfRequest: { generation: number; promise: Promise<string> } | null = null

// Invalidated requests must neither cache nor return their stale token.
export const clearCsrfTokenCache = () => {
	csrfTokenCache = null
	csrfGeneration++
	csrfRequest = null
}

export const getCsrfToken = async (): Promise<string> => {
	while (true) {
		if (csrfTokenCache && csrfTokenCache.expiresAt > Date.now()) {
			return csrfTokenCache.token
		}

		const generation = csrfGeneration
		if (!csrfRequest || csrfRequest.generation !== generation) {
			csrfRequest = {
				generation,
				promise: (async () => {
					const response = await fetch(`${SERVER_HOST}/auth/csrf/`)
					if (!response.ok) {
						throw new ApiError('Failed to fetch CSRF token', response.status)
					}
					const data = await response.json()
					return data.token
				})(),
			}
		}
		const request = csrfRequest
		let token: string
		try {
			token = await request.promise
		} finally {
			if (csrfRequest === request) csrfRequest = null
		}
		if (generation !== csrfGeneration) continue
		csrfTokenCache = { token, expiresAt: Date.now() + 60 * 60 * 1000 }
		return token
	}
}

const isUnsafeMethod = (method: string) =>
	['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())

// Retry only an explicit CSRF rejection, whose operation was not applied.
export const csrfFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
	const response = await fetch(url, options)
	const body = options.body
	const replayable =
		body === undefined ||
		typeof body === 'string' ||
		body instanceof FormData ||
		body instanceof URLSearchParams ||
		body instanceof Blob
	if (response.status !== 403 || !isUnsafeMethod(options.method ?? 'GET') || !replayable) {
		return response
	}
	try {
		if (!(await response.clone().text()).includes('CSRF')) return response
	} catch {
		return response
	}
	clearCsrfTokenCache()
	const headers = new Headers(options.headers)
	headers.set('X-CSRFToken', await getCsrfToken())
	return fetch(url, { ...options, headers })
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
	if (isUnsafeMethod(method)) {
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
