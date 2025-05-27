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
			// Stop after the audio duration plus a small buffer
			setTimeout(
				() => {
					mediaRecorder.stop()
					source.stop()
					audioContext.close()
				},
				audioBuffer.duration * 1000 + 100
			) // Add 100ms buffer
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

/**
 * Converts an AudioBuffer to WAV format as an ArrayBuffer.
 * This function creates a standard WAV file with PCM encoding, 16-bit depth,
 * and preserves the original sample rate and number of channels.
 *
 * The WAV format includes:
 * - RIFF header with WAVE identifier
 * - fmt chunk with PCM format details
 * - data chunk containing the audio samples
 *
 * @param audioBuffer - The AudioBuffer to convert to WAV format
 * @returns Promise resolving to an ArrayBuffer containing the WAV file data
 * @throws Will throw an error if the audio data cannot be processed
 */
export const convertToWav = async (audioBuffer: AudioBuffer): Promise<ArrayBuffer> => {
	const numChannels = audioBuffer.numberOfChannels
	const sampleRate = audioBuffer.sampleRate
	const format = 1 // PCM
	const bitDepth = 16
	const bytesPerSample = bitDepth / 8
	const blockAlign = numChannels * bytesPerSample
	const byteRate = sampleRate * blockAlign
	const dataSize = audioBuffer.length * blockAlign
	const buffer = new ArrayBuffer(44 + dataSize)
	const view = new DataView(buffer)

	// Write WAV header
	writeString(view, 0, 'RIFF')
	view.setUint32(4, 36 + dataSize, true)
	writeString(view, 8, 'WAVE')
	writeString(view, 12, 'fmt ')
	view.setUint32(16, 16, true)
	view.setUint16(20, format, true)
	view.setUint16(22, numChannels, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, byteRate, true)
	view.setUint16(32, blockAlign, true)
	view.setUint16(34, bitDepth, true)
	writeString(view, 36, 'data')
	view.setUint32(40, dataSize, true)

	// Write audio data
	const offset = 44
	const channelData = []
	for (let i = 0; i < numChannels; i++) {
		channelData.push(audioBuffer.getChannelData(i))
	}

	let pos = 0
	while (pos < audioBuffer.length) {
		for (let i = 0; i < numChannels; i++) {
			const sample = Math.max(-1, Math.min(1, channelData[i][pos]))
			const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff
			view.setInt16(offset + pos * blockAlign + i * bytesPerSample, value, true)
		}
		pos++
	}

	return buffer
}

const writeString = (view: DataView, offset: number, string: string) => {
	for (let i = 0; i < string.length; i++) {
		view.setUint8(offset + i, string.charCodeAt(i))
	}
}
