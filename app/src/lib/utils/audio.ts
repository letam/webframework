import fixWebmDuration from 'webm-duration-fix'

/**
 * Converts a WAV audio blob to WebM format with Opus codec
 * @param wavBlob The WAV audio blob to convert
 * @returns Promise resolving to a WebM audio blob
 */
export const convertWavToWebM = async (wavBlob: Blob): Promise<Blob> => {
	try {
		const audioContext = new AudioContext()
		const arrayBuffer = await wavBlob.arrayBuffer()
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

		// Create a MediaStreamDestination
		const destination = audioContext.createMediaStreamDestination()
		const source = audioContext.createBufferSource()
		source.buffer = audioBuffer
		source.connect(destination)
		source.start()

		// Create a MediaRecorder to capture the stream
		const mediaRecorder = new MediaRecorder(destination.stream, {
			mimeType: 'audio/webm;codecs=opus',
		})
		const chunks: Blob[] = []

		return new Promise((resolve, reject) => {
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					chunks.push(e.data)
				}
			}

			mediaRecorder.onstop = async () => {
				try {
					const webmBlob = await fixWebmDuration(
						new Blob(chunks, { type: 'audio/webm;codecs=opus' })
					)
					resolve(webmBlob)
				} catch (error) {
					reject(error)
				}
			}

			mediaRecorder.start()
			// Stop after the audio duration
			setTimeout(() => {
				mediaRecorder.stop()
				source.stop()
				audioContext.close()
			}, audioBuffer.duration * 1000)
		})
	} catch (error) {
		console.error('Error converting to WebM:', error)
		throw error
	}
}

/**
 * Gets the appropriate file extension for an audio MIME type
 * @param mimeType The MIME type to get the extension for
 * @returns The file extension
 */
export const getAudioExtension = (mimeType: string): string => {
	const baseType = mimeType.split(';')[0] // Remove codec information
	return baseType === 'audio/webm'
		? 'webm'
		: baseType === 'audio/mp4'
			? 'm4a'
			: baseType === 'audio/ogg'
				? 'ogg'
				: 'webm' // Default to webm as it's most widely supported
}
