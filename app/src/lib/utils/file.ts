/**
 * Gets the file extension from a path or URL, with fallback to media type
 * @param path The file path or URL
 * @param mediaType The type of media (audio or video)
 * @returns The file extension
 */
export const getFileExtension = (path: string, mediaType?: 'audio' | 'video'): string => {
	// Default extension based on media type
	const defaultExtension = mediaType === 'audio' ? 'mp3' : 'mp4'

	// Try to get extension from URL pathname
	try {
		const url = new URL(path)
		const extension = url.pathname.split('.').pop()
		if (extension) return extension
	} catch {
		// If URL parsing fails, try to get extension from the path directly
		const extension = path.split('/').pop()?.split('.').pop()
		if (extension) return extension
	}

	return defaultExtension
}

interface DownloadFileOptions {
	url: string
	filename: string
}

/**
 * Downloads a file from a URL
 * @param options The download options containing the URL and desired filename
 */
export const downloadFile = ({ url, filename }: DownloadFileOptions): void => {
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	document.body.removeChild(link)
}
