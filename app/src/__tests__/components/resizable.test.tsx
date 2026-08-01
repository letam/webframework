import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'

/**
 * Nothing in the app imports this shadcn wrapper, so a type error or a renamed
 * upstream primitive is invisible to the rest of the suite. react-resizable-panels
 * v4 renamed PanelGroup -> Group and PanelResizeHandle -> Separator, which left the
 * wrapper rendering `undefined` components while every other gate stayed green.
 * These tests mount it so that class of break fails loudly.
 *
 * Assert on data-slot, not data-testid: v4 assigns its own data-testid to each
 * primitive and overwrites any that is passed in.
 */
describe('ui/resizable', () => {
	it('renders panel content and the drag handle', () => {
		render(
			<ResizablePanelGroup orientation="vertical">
				<ResizablePanel defaultSize="50%">left</ResizablePanel>
				<ResizableHandle withHandle />
				<ResizablePanel defaultSize="50%">right</ResizablePanel>
			</ResizablePanelGroup>
		)

		expect(screen.getByText('left')).toBeInTheDocument()
		expect(screen.getByText('right')).toBeInTheDocument()
		expect(screen.getByRole('separator')).toBeInTheDocument()
	})

	it('applies the data-slot attributes the styles hang off', () => {
		const { container } = render(
			<ResizablePanelGroup orientation="horizontal">
				<ResizablePanel defaultSize="100%">only</ResizablePanel>
				<ResizableHandle />
			</ResizablePanelGroup>
		)

		expect(container.querySelector('[data-slot="resizable-panel-group"]')).not.toBeNull()
		expect(container.querySelector('[data-slot="resizable-panel"]')).not.toBeNull()
		expect(container.querySelector('[data-slot="resizable-handle"]')).not.toBeNull()
	})
})
