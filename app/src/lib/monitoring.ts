// Error monitoring. @sentry/react is imported dynamically so the SDK never
// lands in the bundle's critical path and is skipped entirely without a DSN.

let sentry: typeof import('@sentry/react') | undefined

export const initMonitoring = () => {
	const dsn = import.meta.env.VITE_SENTRY_DSN
	if (!dsn) return
	import('@sentry/react')
		.then((Sentry) => {
			Sentry.init({ dsn, environment: import.meta.env.MODE })
			sentry = Sentry
		})
		.catch((error) => {
			console.error('Failed to initialize monitoring:', error)
		})
}

export const captureException = (error: unknown) => {
	sentry?.captureException(error)
}
