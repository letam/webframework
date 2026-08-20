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

const statusOk = (body: Record<string, unknown> = {}) => ({
	ok: true,
	json: async () => ({
		is_authenticated: true,
		user_id: 7,
		username: 'ana',
		avatar: null,
		is_staff: false,
		is_superuser: false,
		...body,
	}),
})

describe('useAuth', () => {
	beforeEach(() => {
		// The failure paths under test log deliberately; keep the run readable.
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	it('resolves both gates once /auth/status/ answers', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusOk()))

		const { result } = renderHook(() => useAuth(), { wrapper })

		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))
		expect(result.current.isAuthResolved).toBe(true)
		expect(result.current.userId).toBe(7)
	})

	// isAuthLoading going false does not mean the answer is anonymous. On a
	// failed check userId is still its null default, so user-keyed storage must
	// continue to gate on isAuthResolved.
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
			.mockResolvedValue(statusOk())
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => useAuth(), { wrapper })
		await waitFor(() => expect(result.current.isAuthLoading).toBe(false))

		await act(async () => {
			expect(await result.current.refreshAuthStatus()).toBe(true)
		})

		expect(result.current.isAuthResolved).toBe(true)
		expect(result.current.userId).toBe(7)
	})

	// The outbox flush reads getAuthSnapshot in the microtask immediately after
	// refreshAuthStatus resolves, before React necessarily commits the new state.
	it('exposes the refreshed identity to getAuthSnapshot before React re-renders', async () => {
		const fetchMock = vi
			.fn()
			.mockRejectedValueOnce(new TypeError('offline'))
			.mockResolvedValueOnce(statusOk())
		vi.stubGlobal('fetch', fetchMock)

		const { result } = renderHook(() => useAuth(), { wrapper })
		await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
		expect(result.current.getAuthSnapshot().isAuthResolved).toBe(false)

		let snapshotAtResolve: ReturnType<typeof result.current.getAuthSnapshot> | null = null
		await act(async () => {
			await result.current.refreshAuthStatus().then((resolved) => {
				expect(resolved).toBe(true)
				snapshotAtResolve = result.current.getAuthSnapshot()
			})
		})

		expect(snapshotAtResolve).toMatchObject({
			isAuthResolved: true,
			isAuthenticated: true,
			userId: 7,
		})
	})
})
