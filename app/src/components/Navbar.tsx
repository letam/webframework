import { Link } from 'react-router'
import { Home, User } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

const Navbar = () => {
	return (
		<header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/60">
			<div className="container flex h-14 items-center">
				<div className="mr-4 hidden md:flex">
					<Link to="/" className="mr-6 flex items-center space-x-2">
						<span className="text-xl font-bold gradient-text">EchoSphere</span>
					</Link>
					<nav className="flex items-center space-x-6 text-sm font-medium">
						<Link to="/" className="transition-colors hover:text-foreground/80 text-foreground/60">
							<div className="flex items-center gap-1">
								<Home className="h-4 w-4" />
								<span>Home</span>
							</div>
						</Link>
						<Link
							to="/profile"
							className="transition-colors hover:text-foreground/80 text-foreground/60"
						>
							<div className="flex items-center gap-1">
								<User className="h-4 w-4" />
								<span>Profile</span>
							</div>
						</Link>
					</nav>
				</div>

				<div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
					<nav className="flex items-center">
						<ThemeToggle />
					</nav>
				</div>
			</div>
		</header>
	)
}

export default Navbar
