import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { LoginModal } from '@/components/LoginModal'
import { SignupModal } from '@/components/SignupModal'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { createPracticeRoom, joinPracticeRoom, type PracticeSnapshot } from '@/lib/api/practice'
import { captureInvitation, forgetInvitation } from '@/lib/practice/invitation'
import { clearCsrfTokenCache, getCsrfToken } from '@/lib/utils/fetch'
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
	let finishStatus: (response: Response) => void
	const pendingStatus = new Promise<Response>((resolve) => {
		finishStatus = resolve
	})
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
					if (signedIn) return pendingStatus
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
				case '/api/practice/rooms/':
					return Response.json({ snapshot, invitation_secret: 'new' })
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
		await getCsrfToken() // Prime T0 before login rotates the cookie.
		await user.click(dialog.getByRole('button', { name: 'Sign In' }))
		await waitFor(() =>
			expect(requests.filter(({ url }) => url === '/auth/status/')).toHaveLength(2)
		)
		await createPracticeRoom('During status refresh', 10)
		const immediate = requests.find(({ url }) => url === '/api/practice/rooms/')?.options
		expect(new Headers(immediate?.headers).get('X-CSRFToken')).toBe('session-token')
		await act(async () => {
			finishStatus(
				Response.json({ is_authenticated: true, user_id: 7, username: 'existing-guest' })
			)
		})

		const join = await screen.findByRole('button', { name: 'Join room' })
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(window.location.pathname).toBe(`/practice/rooms/${roomId}`)
		expect(window.location.hash).toBe('')
		expect(requests.filter(({ url }) => url.endsWith('/join/'))).toHaveLength(0)
		await user.click(join)
		await screen.findByRole('heading', { name: 'Morning session' })
		expect(screen.getByText('You are a participant')).toBeInTheDocument()
		expect(requests.map(({ url }) => url)).toEqual([
			'/auth/status/',
			'/auth/csrf/',
			'/auth/login/',
			'/auth/status/',
			'/auth/csrf/',
			'/api/practice/rooms/',
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
		const mutation = requests[8].options
		expect(mutation?.method).toBe('POST')
		expect(mutation?.credentials).toBe('same-origin')
		expect(new Headers(mutation?.headers).get('X-CSRFToken')).toBe('session-token')
		expect(JSON.parse(String(mutation?.body))).toEqual({ invitation_secret: 'secret/for-guest' })
	} finally {
		view.unmount()
		client.clear()
	}
})

function AuthProbe() {
	const { refreshAuthStatus, userId } = useAuth()
	return (
		<button type="button" onClick={() => refreshAuthStatus()}>
			Refresh user {userId}
		</button>
	)
}

it.each([
	'HTTP',
	'network',
	'JSON',
])('keeps the fresh token and login dialog when status refresh fails (%s)', async (failure) => {
	let token = 'T0'
	let loginCount = 0
	const loginTokens: string[] = []
	const success = vi.fn()
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, options?: RequestInit) => {
			if (url === '/auth/csrf/') return Response.json({ token })
			if (url === '/auth/login/') {
				loginTokens.push(new Headers(options?.headers).get('X-CSRFToken'))
				loginCount++
				token = `T${loginCount}`
				return Response.json({ message: 'Logged in' })
			}
			if (url === '/auth/status/') {
				if (loginCount === 1) {
					if (failure === 'HTTP') return new Response('Unavailable', { status: 503 })
					if (failure === 'JSON') return new Response('invalid JSON')
					throw new TypeError('Network failed')
				}
				return Response.json({
					is_authenticated: loginCount > 0,
					user_id: loginCount > 0 ? 7 : null,
				})
			}
			throw new Error(`Unexpected request: ${url}`)
		})
	)
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const user = userEvent.setup()
	const view = render(
		<QueryClientProvider client={client}>
			<AuthProvider>
				<LoginModal onLoginSuccess={success} />
				<AuthProbe />
			</AuthProvider>
		</QueryClientProvider>
	)
	try {
		await screen.findByRole('button', { name: 'Refresh user' })
		await getCsrfToken()
		await user.click(screen.getByRole('button', { name: 'Login' }))
		const dialog = within(screen.getByRole('dialog'))
		await user.type(dialog.getByLabelText('Username'), 'existing-guest')
		await user.type(dialog.getByLabelText('Password'), 'ExistingPass123!')
		await user.click(dialog.getByRole('button', { name: 'Sign In' }))
		await screen.findByText('Unable to confirm your sign-in. Please try again.')
		expect(success).not.toHaveBeenCalled()
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		await user.click(dialog.getByRole('button', { name: 'Sign In' }))
		await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
		expect(loginTokens).toEqual(['T0', 'T1'])
	} finally {
		view.unmount()
		client.clear()
	}
})

it.each([
	'HTTP',
	'network',
	'JSON',
])('keeps signup open after a failed status check and retries without creating another account (%s)', async (failure) => {
	let signupCount = 0
	let failStatus = true
	let statusCount = 0
	const success = vi.fn()
	const openChange = vi.fn()
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/auth/status/') {
				statusCount++
				if (signupCount && failStatus) {
					if (failure === 'HTTP') return new Response('Unavailable', { status: 503 })
					if (failure === 'JSON') return new Response('invalid JSON')
					throw new TypeError('Network failed')
				}
				return Response.json({ is_authenticated: signupCount > 0, user_id: signupCount ? 7 : null })
			}
			if (url === '/auth/csrf/') return Response.json({ token: 'token' })
			if (url === '/auth/signup/') {
				signupCount++
				if (signupCount > 1) return Response.json({ username: ['Already exists'] }, { status: 400 })
				return Response.json({ user_id: 7, username: 'new-guest', message: 'Created' })
			}
			throw new Error(`Unexpected request: ${url}`)
		})
	)
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	const user = userEvent.setup()
	const view = render(
		<QueryClientProvider client={client}>
			<AuthProvider>
				<SignupModal onSignupSuccess={success} onOpenChange={openChange} />
				<AuthProbe />
			</AuthProvider>
		</QueryClientProvider>
	)
	try {
		await screen.findByRole('button', { name: 'Refresh user' })
		await user.click(screen.getByRole('button', { name: 'Sign Up' }))
		const dialog = within(screen.getByRole('dialog'))
		await user.type(dialog.getByLabelText('Username'), 'new-guest')
		await user.type(dialog.getByLabelText('Password', { exact: true }), 'NewPass123!')
		await user.type(dialog.getByLabelText('Confirm Password'), 'NewPass123!')
		await user.click(dialog.getByRole('button', { name: 'Create Account' }))
		const error =
			'Your account was created, but we are unable to confirm your sign-in. Please try again.'
		await screen.findByText(error)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		expect(success).not.toHaveBeenCalled()
		expect(openChange).not.toHaveBeenCalledWith(false)
		// Repeated failures must leave a working retry without another signup.
		await user.click(dialog.getByRole('button', { name: 'Try again' }))
		await screen.findByText(error)
		expect(success).not.toHaveBeenCalled()
		expect(signupCount).toBe(1)
		failStatus = false
		await user.click(dialog.getByRole('button', { name: 'Try again' }))
		await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(openChange).toHaveBeenLastCalledWith(false)
		expect(signupCount).toBe(1)
		expect(statusCount).toBe(4)
	} finally {
		view.unmount()
		client.clear()
	}
})

it('preserves the fragment invitation across a failed signup status check and successful retry', async () => {
	window.history.replaceState(null, '', `/practice/rooms/${roomId}#invite=secret%2Ffor-guest`)
	let signupCount = 0
	let signedInChecks = 0
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url === '/auth/status/') {
				if (signupCount && ++signedInChecks === 1)
					return new Response('Unavailable', { status: 503 })
				return Response.json({ is_authenticated: signupCount > 0, user_id: signupCount ? 7 : null })
			}
			if (url === '/auth/csrf/') return Response.json({ token: 'token' })
			if (url === '/auth/signup/') {
				signupCount++
				return Response.json({ user_id: 7, username: 'new-guest', message: 'Created' })
			}
			if (url === `/api/practice/rooms/${roomId}/`) {
				return Response.json({ code: 'forbidden' }, { status: 403 })
			}
			throw new Error(`Unexpected request: ${url}`)
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
		expect(window.location.hash).toBe('')
		await user.click(screen.getByRole('button', { name: 'Sign Up' }))
		const dialog = within(screen.getByRole('dialog'))
		await user.type(dialog.getByLabelText('Username'), 'new-guest')
		await user.type(dialog.getByLabelText('Password', { exact: true }), 'NewPass123!')
		await user.type(dialog.getByLabelText('Confirm Password'), 'NewPass123!')
		await user.click(dialog.getByRole('button', { name: 'Create Account' }))
		await screen.findByText(
			'Your account was created, but we are unable to confirm your sign-in. Please try again.'
		)
		expect(screen.getByRole('dialog')).toBeInTheDocument()
		expect(captureInvitation(roomId)).toBe('secret/for-guest')
		await user.click(dialog.getByRole('button', { name: 'Try again' }))
		await screen.findByRole('button', { name: 'Join room' })
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		expect(window.location.pathname).toBe(`/practice/rooms/${roomId}`)
		expect(window.location.hash).toBe('')
		expect(captureInvitation(roomId)).toBe('secret/for-guest')
		expect(signupCount).toBe(1)
		expect(signedInChecks).toBe(2)
	} finally {
		view.unmount()
		client.clear()
	}
})

it('retries a practice mutation after another tab rotates the cookie for the same user', async () => {
	let token = 'T0'
	let csrfCalls = 0
	const mutationTokens: string[] = []
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, options?: RequestInit) => {
			if (url === '/auth/status/') return Response.json({ is_authenticated: true, user_id: 7 })
			if (url === '/auth/csrf/') {
				csrfCalls++
				return Response.json({ token })
			}
			if (url === `/api/practice/rooms/${roomId}/join/`) {
				const sent = new Headers(options?.headers).get('X-CSRFToken')
				mutationTokens.push(sent)
				return sent === token
					? Response.json({ room_id: roomId })
					: Response.json({ detail: 'CSRF Failed: token incorrect' }, { status: 403 })
			}
			throw new Error(`Unexpected request: ${url}`)
		})
	)
	const client = new QueryClient()
	const user = userEvent.setup()
	const view = render(
		<QueryClientProvider client={client}>
			<AuthProvider>
				<AuthProbe />
			</AuthProvider>
		</QueryClientProvider>
	)
	try {
		await screen.findByRole('button', { name: 'Refresh user 7' })
		await getCsrfToken()
		token = 'T1' // Another tab logs out and back in as user 7.
		await user.click(screen.getByRole('button', { name: 'Refresh user 7' }))
		expect(csrfCalls).toBe(1)
		expect(await joinPracticeRoom(roomId, 'secret')).toMatchObject({ room_id: roomId })
		expect(mutationTokens).toEqual(['T0', 'T1'])
		expect(csrfCalls).toBe(2)
	} finally {
		view.unmount()
		client.clear()
	}
})
