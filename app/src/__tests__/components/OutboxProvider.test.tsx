import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutboxProvider } from '@/components/OutboxProvider'

const mockUseAuth = vi.hoisted(() => vi.fn())
const mockConfigureOutbox = vi.hoisted(() => vi.fn())
const mockFlushOutbox = vi.hoisted(() => vi.fn())
const mockHandleOutboxOnline = vi.hoisted(() => vi.fn())
const mockLoadOutbox = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({ useAuth: mockUseAuth }))

vi.mock('@/lib/outbox', () => ({
	configureOutbox: mockConfigureOutbox,
	flushOutbox: mockFlushOutbox,
	handleOutboxOnline: mockHandleOutboxOnline,
	loadOutbox: mockLoadOutbox,
}))

const makeAuth = (isAuthenticated: boolean, userId: number | null, isAuthResolved: boolean) => {
	const snapshot = { isAuthenticated, userId, isAuthResolved }
	return {
		...snapshot,
		getAuthSnapshot: vi.fn(() => snapshot),
		refreshAuthStatus: vi.fn(async () => true),
	}
}

const providerTree = (queryClient: QueryClient) => (
	<QueryClientProvider client={queryClient}>
		<OutboxProvider>
			<div>Child</div>
		</OutboxProvider>
	</QueryClientProvider>
)

describe('OutboxProvider', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue(makeAuth(false, null, false))
		mockLoadOutbox.mockResolvedValue(undefined)
		mockFlushOutbox.mockResolvedValue(undefined)
		mockHandleOutboxOnline.mockResolvedValue(undefined)
	})

	it('configures the outbox and flushes after the initial load', async () => {
		const queryClient = new QueryClient()
		const auth = makeAuth(false, null, false)
		mockUseAuth.mockReturnValue(auth)

		render(providerTree(queryClient))

		await waitFor(() => expect(mockFlushOutbox).toHaveBeenCalledOnce())
		expect(mockLoadOutbox).toHaveBeenCalledOnce()
		expect(mockConfigureOutbox).toHaveBeenCalledOnce()
		const dependencies = mockConfigureOutbox.mock.calls[0][0]
		expect(dependencies.queryClient).toBe(queryClient)
		expect(dependencies.getAuthState()).toEqual({
			isAuthenticated: false,
			userId: null,
			isAuthResolved: false,
		})
		expect(auth.getAuthSnapshot).toHaveBeenCalledOnce()
		await expect(dependencies.refreshAuthStatus()).resolves.toBe(true)
		expect(auth.refreshAuthStatus).toHaveBeenCalledOnce()
	})

	it('flushes again when the authenticated identity changes', async () => {
		const queryClient = new QueryClient()
		mockLoadOutbox.mockReturnValue(new Promise<void>(() => {}))
		mockUseAuth.mockReturnValue(makeAuth(true, 1, true))
		const { rerender } = render(providerTree(queryClient))
		await waitFor(() => expect(mockFlushOutbox).toHaveBeenCalledOnce())

		mockUseAuth.mockReturnValue(makeAuth(true, 2, true))
		rerender(providerTree(queryClient))

		await waitFor(() => expect(mockFlushOutbox).toHaveBeenCalledTimes(2))
	})

	it('handles the window online event', () => {
		const queryClient = new QueryClient()
		mockLoadOutbox.mockReturnValue(new Promise<void>(() => {}))
		render(providerTree(queryClient))

		act(() => window.dispatchEvent(new Event('online')))

		expect(mockHandleOutboxOnline).toHaveBeenCalledOnce()
	})

	it('does not run the mount flush after unmounting during load', async () => {
		const queryClient = new QueryClient()
		let resolveLoad!: () => void
		const load = new Promise<void>((resolve) => {
			resolveLoad = resolve
		})
		mockLoadOutbox.mockReturnValue(load)
		const { unmount } = render(providerTree(queryClient))

		unmount()
		resolveLoad()
		await act(async () => {
			await load
		})

		expect(mockFlushOutbox).not.toHaveBeenCalled()
	})
})
