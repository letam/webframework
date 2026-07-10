import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/components/settings/SettingsPage'
import { getSettings } from '@/lib/utils/settings'
import { makePost, makePostsPage } from '@/__tests__/data/mockPosts'
import { getPosts } from '@/lib/api/posts'
import { toast } from '@/components/ui/sonner'

const mockUseAuth = vi.hoisted(() => vi.fn())

vi.mock('@/components/Navbar', () => ({
	default: () => <div data-testid="navbar" />,
}))

vi.mock('@/hooks/useAuth', () => ({
	useAuth: mockUseAuth,
}))

vi.mock('@/lib/api/posts', () => ({
	getPosts: vi.fn(),
}))

vi.mock('@/components/ui/sonner', () => ({
	toast: { error: vi.fn() },
}))

const readBlobText = (blob: Blob) =>
	new Promise<string>((resolve, reject) => {
		const reader = new FileReader()

		reader.onload = () => resolve(String(reader.result))
		reader.onerror = () => reject(reader.error)
		reader.readAsText(blob)
	})

describe('SettingsPage', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.restoreAllMocks()
		localStorage.clear()
		mockUseAuth.mockReturnValue({
			isAuthenticated: false,
			userId: null,
			username: null,
		})
	})

	it('persists the auto-transcribe toggle', async () => {
		const user = userEvent.setup()
		render(<SettingsPage />)

		const toggle = screen.getByRole('switch', { name: 'Auto-transcribe recordings' })
		expect(toggle).not.toBeChecked()

		await user.click(toggle)

		await waitFor(() => {
			expect(getSettings().autoTranscribe).toBe(true)
		})
	})

	it('renders and persists the create link previews toggle', async () => {
		const user = userEvent.setup()
		render(<SettingsPage />)

		const toggle = screen.getByRole('switch', { name: 'Create link previews' })
		expect(toggle).toBeChecked()
		expect(
			screen.getByText('Generate preview cards for links in your new posts')
		).toBeInTheDocument()

		await user.click(toggle)

		await waitFor(() => {
			expect(getSettings().linkPreviews).toBe(false)
		})
	})

	it('renders and persists the show link previews toggle', async () => {
		const user = userEvent.setup()
		render(<SettingsPage />)

		const toggle = screen.getByRole('switch', { name: 'Show link previews' })
		expect(toggle).toBeChecked()
		expect(
			screen.getByText('Display preview cards for links in posts you read')
		).toBeInTheDocument()

		await user.click(toggle)

		await waitFor(() => {
			expect(getSettings().showLinkPreviews).toBe(false)
		})
		expect(getSettings().linkPreviews).toBe(true)
	})

	it('hides the data export button for anonymous users', () => {
		render(<SettingsPage />)

		expect(screen.queryByRole('button', { name: 'Export my posts' })).not.toBeInTheDocument()
	})

	it('pages through posts and drafts into one JSON download', async () => {
		const user = userEvent.setup()
		const firstPost = makePost({ id: 10, body: 'First page' })
		const secondPost = makePost({ id: 11, body: 'Second page' })
		const draft = makePost({ id: 12, body: 'Draft', is_draft: true })
		let clickedAnchor: HTMLAnchorElement | null = null
		const clickSpy = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(function mockClick() {
				clickedAnchor = this as HTMLAnchorElement
			})

		Object.defineProperty(URL, 'createObjectURL', {
			value: vi.fn(() => 'blob:export'),
			writable: true,
		})
		Object.defineProperty(URL, 'revokeObjectURL', {
			value: vi.fn(),
			writable: true,
		})
		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 7,
			username: 'maya',
		})
		vi.mocked(getPosts)
			.mockResolvedValueOnce(makePostsPage([firstPost], 'cursor-1'))
			.mockResolvedValueOnce(makePostsPage([draft], null))
			.mockResolvedValueOnce(makePostsPage([secondPost], null))

		render(<SettingsPage />)

		await user.click(screen.getByRole('button', { name: 'Export my posts' }))

		await waitFor(() => expect(clickSpy).toHaveBeenCalled())

		expect(getPosts).toHaveBeenNthCalledWith(1, { author: 7 })
		expect(getPosts).toHaveBeenNthCalledWith(2, { drafts: true })
		expect(getPosts).toHaveBeenNthCalledWith(3, { author: 7 }, 'cursor-1')
		expect(clickedAnchor?.download).toMatch(/^echosphere-export-maya-\d{4}-\d{2}-\d{2}\.json$/)

		const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob
		const payload = JSON.parse(await readBlobText(blob))

		expect(payload).toMatchObject({
			username: 'maya',
		})
		expect(payload.exported_at).toEqual(expect.any(String))
		expect(payload.posts.map((post: { id: number }) => post.id)).toEqual([10, 11, 12])
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:export')
	})

	it('toasts when export fails', async () => {
		const user = userEvent.setup()
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

		mockUseAuth.mockReturnValue({
			isAuthenticated: true,
			userId: 7,
			username: 'maya',
		})
		vi.mocked(getPosts).mockRejectedValueOnce(new Error('nope'))

		render(<SettingsPage />)

		await user.click(screen.getByRole('button', { name: 'Export my posts' }))

		await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to export posts'))
		consoleError.mockRestore()
	})
})
