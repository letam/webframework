// Add type declaration for navigator.userAgentData
declare global {
	interface Navigator {
		userAgentData?: {
			platform: string
		}
	}
}

export const isIOS = (): boolean => {
	// Modern detection using navigator.userAgentData
	if (navigator.userAgentData?.platform) {
		return ['iOS', 'iPadOS'].includes(navigator.userAgentData.platform)
	}

	// Fallback to user agent string check
	const userAgent = navigator.userAgent

	// Check for iOS/iPadOS devices
	if (/iPad|iPhone|iPod/.test(userAgent)) {
		return true
	}

	// Check for iPadOS (newer iPads that report as Mac)
	if (/Macintosh/.test(userAgent) && /iPad/.test(userAgent)) {
		return true
	}

	return false
}

export const isSafari = (): boolean => {
	// Modern detection using navigator.userAgentData
	if (navigator.userAgentData?.platform) {
		return navigator.userAgentData.platform === 'macOS' && !/Chrome/.test(navigator.userAgent)
	}

	// Fallback to user agent string check
	const userAgent = navigator.userAgent
	return /Safari/.test(userAgent) && !/Chrome/.test(userAgent)
}
