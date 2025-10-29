export function registerServiceWorker(): void {
	if (!import.meta.env.PROD) {
		return
	}

	if (!('serviceWorker' in navigator)) {
		return
	}

	const register = () => {
		// Use the correct path based on environment
		const swPath = import.meta.env.PROD ? '/static/app/sw.js' : '/sw.js'

		navigator.serviceWorker.register(swPath).catch((error) => {
			console.error('Service worker registration failed:', error)
		})
	}

	if (document.readyState === 'complete') {
		register()
	} else {
		window.addEventListener('load', register, { once: true })
	}
}

export function unregisterServiceWorker(): void {
	if (!('serviceWorker' in navigator)) {
		return
	}

	navigator.serviceWorker.ready
		.then((registration) => registration.unregister())
		.catch(() => {
			// Swallow errors silently to avoid crashing the app when service worker cannot be unregistered.
		})
}
