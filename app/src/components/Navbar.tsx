import { Link } from 'react-router'
import { Home, User, Menu, X } from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useState } from 'react'

const Navbar = () => {
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

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
							to="/profile"
							className="transition-colors hover:text-foreground/80 text-foreground/60"
						>
							<div className="flex items-center gap-1">
								<User className="h-4 w-4" />
								<span>Profile</span>
							</div>
						</Link>
					</nav>

					<ThemeToggle />

					{/* Mobile Menu Button */}
					<button
						type="button"
						className="md:hidden p-2 rounded-md hover:bg-accent"
						onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
					>
						{isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
					</button>
				</div>

				{/* Mobile Navigation */}
				{isMobileMenuOpen && (
					<div className="absolute top-14 left-0 right-0 bg-background border-b md:hidden">
						<nav className="container py-4 flex flex-col space-y-4">
							<Link
								to="/"
								className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-foreground/80 text-foreground/60"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								<Home className="h-4 w-4" />
								<span>Home</span>
							</Link>
							<Link
								to="/profile"
								className="flex items-center gap-2 text-sm font-medium transition-colors hover:text-foreground/80 text-foreground/60"
								onClick={() => setIsMobileMenuOpen(false)}
							>
								<User className="h-4 w-4" />
								<span>Profile</span>
							</Link>
						</nav>
					</div>
				)}
			</div>
		</header>
	)
}

export default Navbar
