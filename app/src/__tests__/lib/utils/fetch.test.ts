import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { clearCsrfTokenCache, getCsrfToken } from '@/lib/utils/fetch'

const fetchMock = vi.fn()

describe('fetch utilities', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		clearCsrfTokenCache()
		globalThis.fetch = fetchMock
	})

	it('throws a status-carrying ApiError when the CSRF request is not ok', async () => {
		fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response)

		const request = getCsrfToken()

		await expect(request).rejects.toBeInstanceOf(ApiError)
		await expect(request).rejects.toMatchObject({
			message: 'Failed to fetch CSRF token',
			status: 503,
		})
	})
})
