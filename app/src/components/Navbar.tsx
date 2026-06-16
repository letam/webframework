import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { Home, User, Menu, LogOut, Settings, Github } from 'lucide-react'
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
import { cn } from '@/lib/utils'

const NavLink = ({
	to,
	label,
	icon: Icon,
	active,
}: {
	to: string
	label: string
	icon: typeof Home
	active: boolean
}) => (
	<Link
		to={to}
		className={cn(
			'group relative flex items-center gap-1.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] transition-colors',
			active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
		)}
	>
		<Icon className="h-3.5 w-3.5" />
		<span>{label}</span>
		<span
			className={cn(
				'absolute -bottom-0.5 left-0 h-px bg-primary transition-all duration-300',
				active ? 'w-full' : 'w-0 group-hover:w-full'
			)}
		/>
	</Link>
)

const Navbar = () => {
	const { isAuthenticated, refreshAuthStatus } = useAuth()
	const [dropdownOpen, setDropdownOpen] = useState(false)
	const { pathname } = useLocation()

	const handleLogout = async () => {
		try {
			await logout()
			await refreshAuthStatus()
		} catch (error) {
			console.error('Error logging out:', error)
		}
	}

	return (
		<header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/65">
			<div className="mx-auto flex h-16 max-w-[1400px] items-center justify-between px-4 sm:px-8">
				<div className="flex items-center gap-3">
					<Link to="/" className="group flex items-center gap-2.5" aria-label="Echo Sphere — home">
						{/* Echo-ring brand glyph */}
						<span className="relative flex h-7 w-7 items-center justify-center">
							<span className="absolute inset-0 rounded-full border border-foreground/30" />
							<span className="absolute inset-[5px] rounded-full border border-foreground/45" />
							<span className="h-1.5 w-1.5 rounded-full bg-primary transition-transform duration-300 group-hover:scale-125" />
						</span>
						<span className="flex flex-col leading-none">
							<span className="font-display text-[1.35rem] font-semibold tracking-tight text-foreground">
								Echo<span className="text-primary">Sphere</span>
							</span>
							<span className="hidden font-mono text-[0.55rem] uppercase tracking-[0.32em] text-muted-foreground sm:block">
								field dispatches
							</span>
						</span>
					</Link>

					{/* On-air status — sound made visible */}
					<span className="ml-1 hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 lg:inline-flex">
						<span className="on-air-dot" />
						<span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-primary">
							On Air
						</span>
					</span>
				</div>

				<div className="flex items-center gap-5">
					{/* Desktop Navigation */}
					<nav className="hidden items-center gap-6 md:flex">
						<NavLink to="/" label="Home" icon={Home} active={pathname === '/'} />
						<NavLink
							to="/settings"
							label="Settings"
							icon={Settings}
							active={pathname === '/settings'}
						/>
						<a
							href="https://github.com/letam/webframework"
							target="_blank"
							rel="noopener noreferrer"
							aria-label="GitHub repository"
							title="GitHub repository"
							className="text-muted-foreground transition-colors hover:text-foreground"
						>
							<Github className="h-4 w-4" />
						</a>
						{isAuthenticated && (
							<NavLink to="/profile" label="Profile" icon={User} active={pathname === '/profile'} />
						)}
						{isAuthenticated ? (
							<button
								type="button"
								className="group relative flex items-center gap-1.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
								onClick={handleLogout}
							>
								<LogOut className="h-3.5 w-3.5" />
								<span>Logout</span>
							</button>
						) : (
							<div className="flex items-center gap-2">
								<LoginModal />
								<SignupModal />
							</div>
						)}
					</nav>

					<div className="h-5 w-px bg-border max-md:hidden" />

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
									<Github className="h-4 w-4" />
									<span>GitHub</span>
								</a>
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
