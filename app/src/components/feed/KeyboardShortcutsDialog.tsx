import type React from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

type Shortcut = {
	keys: string[]
	label: string
	/** Word shown between keys: "then" for a sequence (g then g), "or" for aliases. */
	join?: 'then' | 'or'
}

const SHORTCUTS: Shortcut[] = [
	{ keys: ['j'], label: 'Next post' },
	{ keys: ['k'], label: 'Previous post' },
	{ keys: ['l'], label: 'Like or unlike' },
	{ keys: ['o', 'Enter'], label: 'Open post in new tab', join: 'or' },
	{ keys: ['n'], label: 'New post' },
	{ keys: ['/'], label: 'Search the feed' },
	{ keys: ['g', 'g'], label: 'Jump to top', join: 'then' },
	{ keys: ['?'], label: 'Show this help' },
	{ keys: ['Esc'], label: 'Clear selection' },
]

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
	<kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-xs font-medium text-foreground shadow-xs">
		{children}
	</kbd>
)

interface KeyboardShortcutsDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({
	open,
	onOpenChange,
}) => {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Keyboard shortcuts</DialogTitle>
					<DialogDescription>Move through the feed without leaving the keyboard.</DialogDescription>
				</DialogHeader>
				<ul className="mt-2 divide-y divide-border/60">
					{SHORTCUTS.map((shortcut) => (
						<li
							key={shortcut.label}
							className="flex items-center justify-between gap-4 py-2 text-sm"
						>
							<span className="text-muted-foreground">{shortcut.label}</span>
							<span className="flex items-center gap-1">
								{shortcut.keys.map((key, index) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: keys are a fixed, static caption
									<span key={index} className="flex items-center gap-1">
										{shortcut.join && index > 0 && (
											<span className="text-xs text-muted-foreground">{shortcut.join}</span>
										)}
										<Kbd>{key}</Kbd>
									</span>
								))}
							</span>
						</li>
					))}
				</ul>
			</DialogContent>
		</Dialog>
	)
}
