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
export const getMimeTypeFromPath = (path: string | null): string | null => {
	if (!path) {
		return null
	}
	return getMimeTypeFromExtension(getFileExtension(path))
}

const getMimeTypeFromExtension = (extension: string): string => {
	if (extension === 'mp3') {
		return 'audio/mpeg'
	}
	return `video/${extension}`
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
