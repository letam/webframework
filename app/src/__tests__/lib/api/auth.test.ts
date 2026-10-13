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
