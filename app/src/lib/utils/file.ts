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
