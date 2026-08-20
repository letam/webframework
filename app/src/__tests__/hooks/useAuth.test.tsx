import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '@/hooks/useAuth'

vi.mock('@/lib/utils/fetch', () => ({
	clearCsrfTokenCache: vi.fn(),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
		<AuthProvider>{children}</AuthProvider>
	</QueryClientProvider>
)

const statusOk = (body: Record<string, unknown>) => ({
	ok: true,
	json: async () => ({ is_authenticated: true, user_id: 7, username: 'ana', ...body }),
})

describe('useAuth', () => {
	beforeEach(() => {
		// The failure paths under test log deliberately; keep the run readable.
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('resolves both gates once /auth/status/ answers', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusOk({})))

		const { result } = renderHook(() => useAuth(), { wrapper })

		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))
		expect(result.current.isAuthResolved).toBe(true)
		expect(result.current.userId).toBe(7)
	})

	// The distinction these two cover: `isAuthLoading` going false does NOT mean
	// the answer is "anonymous". On a failed check `userId` sits at its null
	// default, and anything that keys storage on it — composer drafts — would
	// write a signed-in user's words into the shared anonymous slot.
	it('leaves auth unresolved when the status request throws', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

		const { result } = renderHook(() => useAuth(), { wrapper })

		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))
		expect(result.current.isAuthResolved).toBe(false)
		expect(result.current.userId).toBeNull()
	})

	it('leaves auth unresolved when the status request returns non-2xx', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

		const { result } = renderHook(() => useAuth(), { wrapper })

		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))
		expect(result.current.isAuthResolved).toBe(false)
	})

	it('resolves on a later refresh that succeeds', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValue(statusOk({}))
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => useAuth(), { wrapper })
		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))
		expect(result.current.isAuthResolved).toBe(false)

		await act(async () => {
			await result.current.refreshAuthStatus()
		})

		expect(result.current.isAuthResolved).toBe(true)
		expect(result.current.userId).toBe(7)
	})
})
