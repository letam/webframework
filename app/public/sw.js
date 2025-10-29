const CACHE_NAME = 'webframework-cache-v1'
const OFFLINE_URL = '/'

// Assets to cache on install
const STATIC_ASSETS = [
	'/',
	'/static/app/index.html',
	'/static/app/manifest.webmanifest',
	'/static/app/pwa-icon.svg',
	'/static/app/vite-logo.svg',
]

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) => {
				// Cache static assets
				return cache.addAll(STATIC_ASSETS.map((url) => new Request(url, { cache: 'reload' })))
			})
			.catch(() => {})
			.then(() => self.skipWaiting())
	)
})

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
			)
			.then(() => self.clients.claim())
	)
})

self.addEventListener('fetch', (event) => {
	const { request } = event

	if (request.method !== 'GET' || request.url.startsWith('chrome-extension')) {
		return
	}

	const requestURL = new URL(request.url)

	if (requestURL.origin !== self.location.origin) {
		return
	}

	event.respondWith(
		caches.open(CACHE_NAME).then(async (cache) => {
			try {
				const response = await fetch(request)
				if (
					response &&
					response.status === 200 &&
					response.type === 'basic' &&
					!request.url.includes('/__vite_ping') &&
					!request.url.includes('/api/') // Don't cache API responses
				) {
					cache.put(request, response.clone()).catch(() => {})
				}
				return response
			} catch (error) {
				// Try to serve from cache
				const cachedResponse = await cache.match(request)
				if (cachedResponse) {
					return cachedResponse
				}

				// For navigation requests, serve the offline page
				if (request.mode === 'navigate') {
					const offlineResponse =
						(await cache.match('/static/app/index.html')) || (await cache.match(OFFLINE_URL))
					if (offlineResponse) {
						return offlineResponse
					}
				}

				// For API requests, return a proper offline response
				if (request.url.includes('/api/')) {
					return new Response(
						JSON.stringify({
							error: 'Offline',
							message: 'This feature is not available offline',
						}),
						{
							status: 503,
							statusText: 'Service Unavailable',
							headers: { 'Content-Type': 'application/json' },
						}
					)
				}

				throw error
			}
		})
	)
})
