import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signup } from '@/lib/api/auth'
import { clearCsrfTokenCache, getFetchOptions } from '@/lib/utils/fetch'

beforeEach(() => clearCsrfTokenCache())
afterEach(() => {
	clearCsrfTokenCache()
	vi.unstubAllGlobals()
})

describe('signup session transition', () => {
	it('fetches the new CSRF token before the next room mutation', async () => {
		let csrfRequests = 0
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url === '/auth/csrf/') {
					csrfRequests++
					return {
						ok: true,
						json: async () => ({ token: csrfRequests === 1 ? 'before-signup' : 'after-signup' }),
					}
				}
				if (url === '/auth/signup/')
					return { ok: true, json: async () => ({ user_id: 3, username: 'newuser' }) }
				throw new Error(`Unexpected URL ${url}`)
			})
		)
		const before = await getFetchOptions('POST')
		expect((before.headers as Record<string, string>)['X-CSRFToken']).toBe('before-signup')
		await signup({ username: 'newuser', password1: 'longpassword', password2: 'longpassword' })
		const after = await getFetchOptions('POST')
		expect((after.headers as Record<string, string>)['X-CSRFToken']).toBe('after-signup')
		expect(csrfRequests).toBe(2)
	})
})

it.each([
	'login',
	'signup',
])('invalidates after a rejected %s request that rotated the cookie', async (kind) => {
	let token = 'T0'
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/auth/csrf/') return Response.json({ token })
			token = 'T1'
			throw new TypeError('Connection lost after cookie rotation')
		})
	)
	await getFetchOptions('POST')
	const { login } = await import('@/lib/api/auth')
	const request =
		kind === 'login'
			? login({ username: 'user', password: 'password' })
			: signup({ username: 'user', password1: 'password', password2: 'password' })
	await expect(request).rejects.toThrow('Connection lost')
	expect(new Headers((await getFetchOptions('POST')).headers).get('X-CSRFToken')).toBe('T1')
})

it.each([true, false])('clears signup before reading a response body (ok=%s)', async (ok) => {
	let token = 'T0'
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/auth/csrf/') return Response.json({ token })
			token = 'T1'
			return {
				ok,
				status: ok ? 200 : 400,
				json: async () => {
					expect(new Headers((await getFetchOptions('POST')).headers).get('X-CSRFToken')).toBe('T1')
					throw new Error('Body read failed')
				},
			}
		})
	)
	await getFetchOptions('POST')
	await expect(
		signup({ username: 'user', password1: 'password', password2: 'password' })
	).rejects.toThrow('Body read failed')
	expect(new Headers((await getFetchOptions('POST')).headers).get('X-CSRFToken')).toBe('T1')
})

it('clears login after an HTTP error before the caller reads the body', async () => {
	let token = 'T0'
	const rejected = Response.json({ form: ['Invalid credentials'] }, { status: 400 })
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/auth/csrf/') return Response.json({ token })
			token = 'T1'
			return rejected
		})
	)
	const { login } = await import('@/lib/api/auth')
	expect(await login({ username: 'user', password: 'password' })).toBe(rejected)
	expect(new Headers((await getFetchOptions('POST')).headers).get('X-CSRFToken')).toBe('T1')
	expect(await rejected.json()).toEqual({ form: ['Invalid credentials'] })
})
