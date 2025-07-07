import { useState } from 'react'
import { Link } from 'react-router'
import { Home, User, Menu, LogOut, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useAuth } from '@/hooks/useAuth'
import { logout } from '@/lib/api/auth'
import { LoginModal } from '@/components/LoginModal'
import { SignupModal } from '@/components/SignupModal'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

const Navbar = () => {
	const { isAuthenticated, refreshAuthStatus } = useAuth()
	const [dropdownOpen, setDropdownOpen] = useState(false)

	const handleLogout = async () => {
		try {
			await logout()
			await refreshAuthStatus()
		} catch (error) {
			console.error('Error logging out:', error)
		}
	}

	return (
		<header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
			<div className="container flex h-14 items-center justify-between">
				<div className="flex items-center">
					<Link to="/" className="mr-6 flex items-center space-x-2">
						<span className="text-xl font-bold gradient-text">EchoSphere</span>
					</Link>
				</div>

				<div className="flex items-center gap-4">
					{/* Desktop Navigation */}
					<nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
						<Link to="/" className="transition-colors hover:text-foreground/80 text-foreground/60">
							<div className="flex items-center gap-1">
								<Home className="h-4 w-4" />
								<span>Home</span>
							</div>
						</Link>
						<Link
							to="/settings"
							className="transition-colors hover:text-foreground/80 text-foreground/60"
						>
							<div className="flex items-center gap-1">
								<Settings className="h-4 w-4" />
								<span>Settings</span>
							</div>
						</Link>
						{isAuthenticated && (
							<Link
								to="/profile"
								className="transition-colors hover:text-foreground/80 text-foreground/60"
							>
								<div className="flex items-center gap-1">
									<User className="h-4 w-4" />
									<span>Profile</span>
								</div>
							</Link>
						)}
						{isAuthenticated ? (
							<Button
								variant="ghost"
								className="transition-colors hover:text-foreground/80 text-foreground/60"
								onClick={handleLogout}
							>
								<div className="flex items-center gap-1">
									<LogOut className="h-4 w-4" />
									<span>Logout</span>
								</div>
							</Button>
						) : (
							<div className="flex items-center gap-2">
								<LoginModal />
								<SignupModal />
							</div>
						)}
					</nav>

					<ThemeToggle />

					{/* Mobile Menu */}
					<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="md:hidden">
								<Menu className="h-5 w-5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem asChild>
								<Link to="/" className="flex items-center gap-2">
									<Home className="h-4 w-4" />
									<span>Home</span>
								</Link>
							</DropdownMenuItem>
							<DropdownMenuItem asChild>
								<Link to="/settings" className="flex items-center gap-2">
									<Settings className="h-4 w-4" />
									<span>Settings</span>
								</Link>
							</DropdownMenuItem>
							{isAuthenticated && (
								<DropdownMenuItem asChild>
									<Link to="/profile" className="flex items-center gap-2">
										<User className="h-4 w-4" />
										<span>Profile</span>
									</Link>
								</DropdownMenuItem>
							)}
							{isAuthenticated ? (
								<DropdownMenuItem onClick={handleLogout}>
									<div className="flex items-center gap-2">
										<LogOut className="h-4 w-4" />
										<span>Logout</span>
									</div>
								</DropdownMenuItem>
							) : (
								<>
									<DropdownMenuItem asChild>
										<LoginModal
											triggerClassName="w-full justify-start text-black dark:text-white -ml-2"
											onLoginSuccess={() => setDropdownOpen(false)}
										/>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<SignupModal
											triggerClassName="w-full justify-start text-black dark:text-white -ml-2"
											onSignupSuccess={() => setDropdownOpen(false)}
										/>
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</header>
	)
}

export default Navbar
