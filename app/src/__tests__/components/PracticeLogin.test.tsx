import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/hooks/useAuth'
import type { PracticeSnapshot } from '@/lib/api/practice'
import { forgetInvitation } from '@/lib/practice/invitation'
import { clearCsrfTokenCache } from '@/lib/utils/fetch'
import PracticeRoomRoute from '@/pages/PracticeRoomPage'

// Navigation is unrelated to the sign-in/join flow; keep the route, modal,
// provider, invitation handling, room hook and HTTP helpers real.
vi.mock('@/components/Navbar', () => ({ default: () => null }))

const roomId = 'login-regression'

// The join uses HTTP; leave the subsequent realtime connection pending.
class PendingSocket {
	close() {}
}

afterEach(() => {
	cleanup()
	clearCsrfTokenCache()
	forgetInvitation(roomId)
	window.history.replaceState(null, '', '/')
	vi.unstubAllGlobals()
})

it('renews CSRF after an existing user logs in and joins with the invitation across the auth remount', async () => {
	clearCsrfTokenCache()
	window.history.replaceState(null, '', `/practice/rooms/${roomId}#invite=secret%2Ffor-guest`)
	vi.stubGlobal('WebSocket', PendingSocket)
	let signedIn = false
	const requests: { url: string; options?: RequestInit }[] = []
	const snapshot: PracticeSnapshot = {
		v: 1,
		type: 'room.snapshot',
		room_id: roomId,
		title: 'Morning session',
		host_id: 1,
		current_user_id: 7,
		is_host: false,
		closed_at: null,
		duration_ms: 600_000,
		run_id: 1,
		status: 'ready',
		remaining_ms: 600_000,
		deadline: null,
		revision: 0,
		server_time: '2026-10-13T12:00:00Z',
		members: [{ user_id: 7, username: 'existing-guest', is_host: false, connected: false }],
		membership_revision: 1,
		presence_sequence: 0,
		heartbeat_seconds: 20,
		lease_seconds: 60,
	}
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, options?: RequestInit) => {
			requests.push({ url, options })
			switch (url) {
				case '/auth/status/':
					return Response.json({
						is_authenticated: signedIn,
						user_id: signedIn ? 7 : null,
						username: signedIn ? 'existing-guest' : null,
					})
				case '/auth/csrf/':
					return Response.json({ token: signedIn ? 'session-token' : 'anonymous-token' })
				case '/auth/login/':
					signedIn = true
					return Response.json({ message: 'Logged in' })
				case `/api/practice/rooms/${roomId}/`:
					return Response.json({ code: 'forbidden' }, { status: 403 })
				case `/api/practice/rooms/${roomId}/join/`:
					return Response.json(snapshot)
				default:
					throw new Error(`Unexpected request: ${url}`)
			}
		})
	)
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const user = userEvent.setup()
	const view = render(
		<QueryClientProvider client={client}>
			<AuthProvider>
				<BrowserRouter>
					<Routes>
						<Route path="/practice/rooms/:id" element={<PracticeRoomRoute />} />
					</Routes>
				</BrowserRouter>
			</AuthProvider>
		</QueryClientProvider>
	)
	try {
		await screen.findByRole('heading', { name: 'Sign in to join this room' })
		// The fragment is consumed before login, so the remount must recover the
		// invitation from page memory rather than reading the URL again.
		expect(window.location.hash).toBe('')
		await user.click(screen.getByRole('button', { name: 'Login' }))
		const dialog = within(screen.getByRole('dialog'))
		await user.type(dialog.getByLabelText('Username'), 'existing-guest')
		await user.type(dialog.getByLabelText('Password'), 'ExistingPass123!')
		await user.click(dialog.getByRole('button', { name: 'Sign In' }))

		const join = await screen.findByRole('button', { name: 'Join room' })
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(window.location.pathname).toBe(`/practice/rooms/${roomId}`)
		expect(window.location.hash).toBe('')
		await user.click(join)
		await screen.findByRole('heading', { name: 'Morning session' })
		expect(screen.getByText('You are a participant')).toBeInTheDocument()
		expect(requests.map(({ url }) => url)).toEqual([
			'/auth/status/',
			'/auth/csrf/',
			'/auth/login/',
			'/auth/status/',
			`/api/practice/rooms/${roomId}/`,
			'/auth/csrf/',
			`/api/practice/rooms/${roomId}/join/`,
		])
		const login = requests[2].options
		expect(login?.method).toBe('POST')
		expect(login?.credentials).toBe('same-origin')
		expect(new Headers(login?.headers).get('X-CSRFToken')).toBe('anonymous-token')
		expect(JSON.parse(String(login?.body))).toEqual({
			username: 'existing-guest',
			password: 'ExistingPass123!',
		})
		const mutation = requests[6].options
		expect(mutation?.method).toBe('POST')
		expect(mutation?.credentials).toBe('same-origin')
		expect(new Headers(mutation?.headers).get('X-CSRFToken')).toBe('session-token')
		expect(JSON.parse(String(mutation?.body))).toEqual({ invitation_secret: 'secret/for-guest' })
	} finally {
		view.unmount()
		client.clear()
	}
})
