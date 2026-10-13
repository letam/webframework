import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Navbar from '@/components/Navbar'
import { getAuthorStats } from '@/lib/api/posts'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/lib/api/posts', () => ({
	getAuthorStats: vi.fn(),
}))

vi.mock('@/lib/api/auth', () => ({
	logout: vi.fn(),
}))

vi.mock('@/components/LoginModal', () => ({
	LoginModal: () => <button type="button">Log in</button>,
}))

vi.mock('@/components/SignupModal', () => ({
	SignupModal: () => <button type="button">Sign up</button>,
}))

vi.mock('@/components/SyncStatusIndicator', () => ({
	SyncStatusIndicator: () => null,
}))

vi.mock('@/components/ThemeToggle', () => ({
	ThemeToggle: () => null,
}))

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

const renderNavbar = (children: ReactNode) =>
	render(
		<QueryClientProvider client={createQueryClient()}>
			<MemoryRouter>{children}</MemoryRouter>
		</QueryClientProvider>
	)

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('Navbar drafts entry', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 1,
			username: 'audiophile',
			avatar: null,
			refreshAuthStatus: vi.fn(),
		})
		vi.mocked(getAuthorStats).mockResolvedValue({
			post_count: 0,
			likes_received: 0,
			draft_count: 3,
		})
	})

	it('links to /drafts with the unpublished count', async () => {
		renderNavbar(<Navbar />)

		const draftLinks = await screen.findAllByRole('link', { name: /Drafts/ })
		expect(draftLinks[0]).toHaveAttribute('href', '/drafts')
		await waitFor(() => expect(screen.getAllByText('3').length).toBeGreaterThan(0))
	})

	it('caps the badge at 99+', async () => {
		vi.mocked(getAuthorStats).mockResolvedValue({
			post_count: 0,
			likes_received: 0,
			draft_count: 250,
		})

		renderNavbar(<Navbar />)

		await waitFor(() => expect(screen.getAllByText('99+').length).toBeGreaterThan(0))
	})

	it('omits the badge when there are no drafts', async () => {
		vi.mocked(getAuthorStats).mockResolvedValue({
			post_count: 0,
			likes_received: 0,
			draft_count: 0,
		})

		renderNavbar(<Navbar />)

		await screen.findAllByRole('link', { name: /Drafts/ })
		expect(screen.queryByText('0')).not.toBeInTheDocument()
	})

	it('hides the drafts entry from anonymous visitors', () => {
		mockUseAuth.mockReturnValue({
			isAuthenticated: false,
			userId: null,
			username: null,
			avatar: null,
			refreshAuthStatus: vi.fn(),
		})

		renderNavbar(<Navbar />)

		expect(screen.queryByRole('link', { name: /Drafts/ })).not.toBeInTheDocument()
		expect(getAuthorStats).not.toHaveBeenCalled()
	})

	it('shows the enabled practice route in both desktop and mobile navigation', async () => {
		vi.stubEnv('VITE_PRACTICE_ENABLED', 'true')
		vi.resetModules()
		const { default: PracticeNavbar } = await import('@/components/Navbar')
		renderNavbar(<PracticeNavbar />)

		expect(screen.getByRole('link', { name: 'Practice' })).toHaveAttribute('href', '/practice')
		fireEvent.pointerDown(screen.getByRole('button', { name: '' }), {
			button: 0,
			ctrlKey: false,
			pointerType: 'mouse',
		})
		expect(await screen.findByRole('menuitem', { name: 'Practice' })).toHaveAttribute(
			'href',
			'/practice'
		)
	})

	it('hides practice in both navigation menus when the build flag is disabled', async () => {
		vi.stubEnv('VITE_PRACTICE_ENABLED', 'false')
		vi.resetModules()
		const { default: PracticeNavbar } = await import('@/components/Navbar')
		renderNavbar(<PracticeNavbar />)

		expect(screen.queryByRole('link', { name: 'Practice' })).not.toBeInTheDocument()
		fireEvent.pointerDown(screen.getByRole('button', { name: '' }), {
			button: 0,
			ctrlKey: false,
			pointerType: 'mouse',
		})
		await screen.findByRole('menuitem', { name: 'Home' })
		expect(screen.queryByRole('menuitem', { name: 'Practice' })).not.toBeInTheDocument()
	})
})
