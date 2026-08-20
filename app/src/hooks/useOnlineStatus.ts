import { useSyncExternalStore } from 'react'

let online = typeof navigator === 'undefined' || navigator.onLine
const listeners = new Set<() => void>()

const setOnline = (next: boolean) => {
	if (online === next) return
	online = next
	for (const listener of listeners) listener()
}

const handleOnline = () => setOnline(true)
const handleOffline = () => setOnline(false)

const subscribe = (listener: () => void) => {
	if (listeners.size === 0 && typeof window !== 'undefined') {
		window.addEventListener('online', handleOnline)
		window.addEventListener('offline', handleOffline)
	}
	listeners.add(listener)

	return () => {
		listeners.delete(listener)
		if (listeners.size === 0 && typeof window !== 'undefined') {
			window.removeEventListener('online', handleOnline)
			window.removeEventListener('offline', handleOffline)
		}
	}
}

const getSnapshot = () => online
const getServerSnapshot = () => true

export const useOnlineStatus = () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
