import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api/errors'
import { clearCsrfTokenCache, csrfFetch, getCsrfToken, getFetchOptions } from '@/lib/utils/fetch'

const fetchMock = vi.fn()

function deferred<T>() {
	let resolve: (value: T) => void
	const promise = new Promise<T>((done) => {
		resolve = done
	})
	return { promise, resolve: (value: T) => resolve(value) }
}

describe('fetch utilities', () => {
	beforeEach(() => {
		fetchMock.mockReset()
		clearCsrfTokenCache()
		vi.stubGlobal('fetch', fetchMock)
	})
	afterEach(() => {
		clearCsrfTokenCache()
		vi.unstubAllGlobals()
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

	it.each([
		'before',
		'after',
	])('discards an invalidated response resolving %s the new token', async (order) => {
		const old = deferred<Response>()
		const fresh = deferred<Response>()
		fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
		const first = getCsrfToken()
		const concurrent = getCsrfToken()
		expect(fetchMock).toHaveBeenCalledTimes(1)
		clearCsrfTokenCache()
		const next = getCsrfToken()
		if (order === 'before') old.resolve(Response.json({ token: 'T0' }))
		fresh.resolve(Response.json({ token: 'T1' }))
		expect(await next).toBe('T1')
		if (order === 'after') old.resolve(Response.json({ token: 'T0' }))
		expect(await first).toBe('T1')
		expect(await concurrent).toBe('T1')
		expect(await getCsrfToken()).toBe('T1')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('refetches for an invalidated caller even when no newer request has started', async () => {
		const old = deferred<Response>()
		fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(Response.json({ token: 'T1' }))
		const first = getCsrfToken()
		clearCsrfTokenCache()
		old.resolve(Response.json({ token: 'T0' }))
		expect(await first).toBe('T1')
		expect(await getCsrfToken()).toBe('T1')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it.each([
		'POST',
		'PUT',
		'PATCH',
		'DELETE',
	])('retries a CSRF %s rejection only once and leaves the second response readable', async (method) => {
		const first = new Response('CSRF verification failed', { status: 403 })
		const second = Response.json({ detail: 'CSRF Failed: incorrect token' }, { status: 403 })
		fetchMock
			.mockResolvedValueOnce(Response.json({ token: 'T0' }))
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(Response.json({ token: 'T1' }))
			.mockResolvedValueOnce(second)
		const controller = new AbortController()
		const options = { ...(await getFetchOptions(method, { value: 1 })), signal: controller.signal }
		const result = await csrfFetch('/mutation/', options)
		expect(result).toBe(second)
		expect(await result.json()).toEqual({ detail: 'CSRF Failed: incorrect token' })
		expect(fetchMock).toHaveBeenCalledTimes(4)
		const retried = fetchMock.mock.calls[3][1]
		expect(new Headers(retried.headers).get('X-CSRFToken')).toBe('T1')
		expect(new Headers(retried.headers).get('Content-Type')).toBe('application/json')
		expect(retried).toMatchObject({
			method,
			body: options.body,
			credentials: 'same-origin',
			signal: controller.signal,
		})
	})

	it.each([
		['POST', 'Permission denied'],
		['GET', 'CSRF verification failed'],
	])('does not retry %s with body %s', async (method, body) => {
		const original = new Response(body, { status: 403 })
		fetchMock.mockResolvedValueOnce(original)
		const result = await csrfFetch('/mutation/', { method })
		expect(result).toBe(original)
		expect(await result.text()).toBe(body)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it.each([
		undefined,
		'payload',
		new FormData(),
		new URLSearchParams({ value: '1' }),
		new Blob(['payload']),
	])('replays a supported body: %s', async (body) => {
		fetchMock
			.mockResolvedValueOnce(new Response('CSRF Failed: stale', { status: 403 }))
			.mockResolvedValueOnce(Response.json({ token: 'T1' }))
			.mockResolvedValueOnce(new Response('ok'))
		expect((await csrfFetch('/mutation/', { method: 'POST', body })).ok).toBe(true)
		expect(fetchMock.mock.calls[2][1].body).toBe(body)
		expect(fetchMock).toHaveBeenCalledTimes(3)
	})

	it.each([
		new ReadableStream(),
		new Uint8Array([1, 2]),
	])('does not retry a body outside the replayable allowlist: %s', async (body) => {
		const original = new Response('CSRF verification failed', { status: 403 })
		fetchMock.mockResolvedValueOnce(original)
		expect(await csrfFetch('/mutation/', { method: 'POST', body })).toBe(original)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('returns the original response if its clone cannot be read', async () => {
		const original = new Response('CSRF verification failed', { status: 403 })
		vi.spyOn(original, 'clone').mockImplementation(() => {
			throw new Error('Unreadable body')
		})
		fetchMock.mockResolvedValueOnce(original)
		expect(await csrfFetch('/mutation/', { method: 'POST' })).toBe(original)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})
})
