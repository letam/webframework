/**
 * Gets the file extension from a path or URL
 * @param path The file path or URL
 * @returns The file extension
 */
export const getFileExtension = (path: string): string => {
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
	throw new Error('No extension found')
}

interface DownloadFileOptions {
	url: string
	filename: string
}

/**
 * Gets the MIME type from a file name or URL
 * @param path The file name or URL
 * @returns The MIME type
 */
export const getMimeTypeFromPath = (path: string): string => {
	const extension = path.split('.').pop()?.toLowerCase()
	switch (extension) {
		case 'mp3':
			return 'audio/mpeg'
		case 'wav':
			return 'audio/wav'
		case 'ogg':
			return 'audio/ogg'
		case 'mp4':
			return 'video/mp4'
		case 'webm':
			return 'video/webm'
		default:
			return 'application/octet-stream'
	}
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
