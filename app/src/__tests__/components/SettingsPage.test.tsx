import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '@/components/settings/SettingsPage'
import { getSettings } from '@/lib/utils/settings'

vi.mock('@/components/Navbar', () => ({
	default: () => <div data-testid="navbar" />,
}))

describe('SettingsPage', () => {
	beforeEach(() => {
		localStorage.clear()
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
})
