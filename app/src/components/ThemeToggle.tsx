import { Moon, Sun, Check, Monitor } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/components/ThemeProvider'

export function ThemeToggle() {
	const { theme, setTheme } = useTheme()

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon" className="rounded-full">
					<Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
					<Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
					<span className="sr-only">Toggle theme</span>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => setTheme('light')} className="flex items-center gap-2">
					<Sun className="h-4 w-4" />
					<span>Light</span>
					{theme === 'light' && <Check className="h-4 w-4 ml-auto" />}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme('dark')} className="flex items-center gap-2">
					<Moon className="h-4 w-4" />
					<span>Dark</span>
					{theme === 'dark' && <Check className="h-4 w-4 ml-auto" />}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => setTheme('system')} className="flex items-center gap-2">
					<Monitor className="h-4 w-4" />
					<span>System</span>
					{theme === 'system' && <Check className="h-4 w-4 ml-auto" />}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
