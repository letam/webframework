import { Button } from '@/components/ui/button'
import { captureException } from '@/lib/monitoring'
import { Component, type ErrorInfo, type ReactNode } from 'react'

type AppErrorBoundaryProps = {
	children: ReactNode
}

type AppErrorBoundaryState = {
	error: Error | null
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
	state: AppErrorBoundaryState = {
		error: null,
	}

	static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
		return { error }
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error('Unhandled render error:', error, info)
		captureException(error)
	}

	render() {
		if (this.state.error) {
			return (
				<div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
					<div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
						<h1 className="font-semibold text-2xl">Something went wrong</h1>
						<p className="mt-2 text-muted-foreground text-sm">
							An unexpected error occurred. Reloading usually fixes it.
						</p>
						<Button className="mt-6" onClick={() => window.location.reload()}>
							Reload page
						</Button>
						<details className="mt-6 text-muted-foreground text-xs">
							<summary>Error details</summary>
							<pre className="mt-2 whitespace-pre-wrap break-words">{String(this.state.error)}</pre>
						</details>
					</div>
				</div>
			)
		}

		return this.props.children
	}
}

export default AppErrorBoundary
