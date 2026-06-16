import { useLocation } from 'react-router'
import { useEffect } from 'react'

const NotFound = () => {
	const location = useLocation()

	useEffect(() => {
		console.error('404 Error: User attempted to access non-existent route:', location.pathname)
	}, [location.pathname])

	return (
		<div className="relative min-h-screen flex items-center justify-center overflow-hidden">
			{/* Echo field decoration */}
			<div className="echo-field absolute inset-0 pointer-events-none" />

			<div className="relative z-10 text-center px-6 flex flex-col items-center gap-6">
				{/* Eyebrow */}
				<div className="flex items-center gap-2.5">
					<span className="on-air-dot" />
					<span className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
						Error · 404 · Off Air
					</span>
				</div>

				{/* Display headline */}
				<h1 className="font-display text-6xl font-light leading-tight">
					Signal <span className="italic text-primary">Lost</span>
				</h1>

				{/* Explanatory line */}
				<p className="font-mono text-[0.75rem] uppercase tracking-[0.15em] text-muted-foreground max-w-xs">
					The frequency you're looking for is no longer broadcasting.
				</p>

				{/* EQ motif */}
				<div className="eq text-primary">
					<span className="eq-bar" />
					<span className="eq-bar" />
					<span className="eq-bar" />
				</div>

				{/* Return home CTA */}
				<a
					href="/"
					className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
				>
					Return Home
				</a>
			</div>
		</div>
	)
}

export default NotFound
