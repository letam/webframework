import { useState } from 'react'
import { Link } from 'react-router'
import { Home, Menu, LogOut, Settings } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { EchoMark } from '@/components/EchoMark'
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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { identityGradient } from '@/lib/utils/identity'

const navLinkClass =
	'rounded-md text-foreground/60 transition-colors hover:text-foreground/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

// lucide-react v1 dropped brand icons, so we ship the GitHub mark locally.
// Matches lucide's icon markup (24x24, currentColor stroke) for visual parity.
const GithubIcon = ({ className }: { className?: string }) => (
	<svg
		className={className}
		xmlns="http://www.w3.org/2000/svg"
		width="24"
		height="24"
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C4 2 3 2 3 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 2 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
		<path d="M9 18c-4.51 2-5-2-7-2" />
	</svg>
)

const Navbar = () => {
	const { isAuthenticated, refreshAuthStatus, avatar, username } = useAuth()
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const userInitial = username?.[0]?.toUpperCase() ?? '?'
	const renderProfileAvatar = () => (
		<Avatar className="h-5 w-5">
			<AvatarImage src={avatar ?? undefined} alt={username ?? 'Profile'} />
			<AvatarFallback
				className="text-[10px] text-white"
				style={{ background: identityGradient(username ?? '') }}
			>
				{userInitial}
			</AvatarFallback>
		</Avatar>
	)

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
			<div className="mx-auto max-w-[1400px] px-4 sm:px-8 flex h-14 items-center justify-between">
				<div className="flex items-center">
					<Link
						to="/"
						className="mr-6 flex items-center space-x-2 rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					>
						<EchoMark className="h-6 w-6" />
						<span className="text-xl font-bold tracking-tight gradient-text">EchoSphere</span>
					</Link>
				</div>

				<div className="flex items-center gap-4">
					{/* Desktop Navigation */}
					<nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
						<Link to="/" className={navLinkClass}>
							<div className="flex items-center gap-1">
								<Home className="h-4 w-4" />
								<span>Home</span>
							</div>
						</Link>
						<Link to="/settings" className={navLinkClass}>
							<div className="flex items-center gap-1">
								<Settings className="h-4 w-4" />
								<span>Settings</span>
							</div>
						</Link>
						<a
							href="https://github.com/letam/webframework"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="GitHub repository"
							title="GitHub repository"
							className={navLinkClass}
						>
							<div className="flex items-center">
								<GithubIcon className="h-4 w-4" />
							</div>
						</a>
						{isAuthenticated && (
							<Link to="/profile" className={navLinkClass}>
								<div className="flex items-center gap-1">
									{renderProfileAvatar()}
									<span>Profile</span>
								</div>
							</Link>
						)}
						{isAuthenticated ? (
							<Button
								variant="ghost"
								className="hover:text-foreground/80 text-foreground/60"
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
							<DropdownMenuItem asChild>
								<a
									href="https://github.com/letam/webframework"
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center gap-2"
								>
									<GithubIcon className="h-4 w-4" />
									<span>GitHub</span>
								</a>
							</DropdownMenuItem>
							{isAuthenticated && (
								<DropdownMenuItem asChild>
									<Link to="/profile" className="flex items-center gap-2">
										{renderProfileAvatar()}
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
											onOpenChange={(open) => {
												if (!open) {
													setDropdownOpen(false)
												}
											}}
										/>
									</DropdownMenuItem>
									<DropdownMenuItem asChild>
										<SignupModal
											triggerClassName="w-full justify-start text-black dark:text-white -ml-2"
											onSignupSuccess={() => setDropdownOpen(false)}
											onOpenChange={(open) => {
												if (!open) {
													setDropdownOpen(false)
												}
											}}
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
