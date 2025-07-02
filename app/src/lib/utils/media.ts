// Reference: Mime types listed in WebRTC samples: https://github.com/webrtc/samples/blob/28f28227bd38bb05aabceae5c73b857083f75423/src/content/getusermedia/record/js/main.js#L93
// Reference: Web video codec guide: https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs

export const videoMimeTypes = [
	'video/webm;codecs=vp9,opus',
	'video/webm;codecs=vp8,opus',
	'video/webm;codecs=h264,opus',
	'video/webm;codecs=av01,opus',
	'video/x-matroska;codecs=hvc1.1.6.L186.B0,opus',
	'video/mp4;codecs=vp9,mp4a.40.2',
	'video/mp4;codecs=vp9,opus',
	'video/mp4;codecs=avc1.64003E,mp4a.40.2',
	'video/mp4;codecs=avc1.64003E,opus',
	'video/mp4;codecs=avc3.64003E,mp4a.40.2',
	'video/mp4;codecs=avc3.64003E,opus',
	'video/mp4;codecs=hvc1.1.6.L186.B0,mp4a.40.2',
	'video/mp4;codecs=hvc1.1.6.L186.B0,opus',
	'video/mp4;codecs=hev1.1.6.L186.B0,mp4a.40.2',
	'video/mp4;codecs=hev1.1.6.L186.B0,opus',
	'video/mp4;codecs=av01.0.19M.08,mp4a.40.2',
	'video/mp4;codecs=av01.0.19M.08,opus',
	'video/mp4',
]

export function getSupportedVideoMimeTypes() {
	return videoMimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export const supportedVideoMimeType = getSupportedVideoMimeTypes()[0]
console.log('INFO: supportedVideoMimeType', supportedVideoMimeType)

export const audioMimeTypes = [
	'audio/webm;codecs=opus',
	'audio/mp4;codecs=mp4a.40.2',
	'audio/mp4;codecs=opus',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
]

export function getSupportedAudioMimeTypes() {
	return audioMimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export const supportedAudioMimeType = getSupportedAudioMimeTypes()[0]
console.log('INFO: supportedAudioMimeType', supportedAudioMimeType)
export const mimeTypes = [...videoMimeTypes, ...audioMimeTypes]

/**
 * Parses a duration string from a media record into seconds
 * @param durationString The duration string (e.g., "0:01:30.500000" or "1:30")
 * @returns The duration in seconds, or 0 if parsing fails
 */
export const parseDurationString = (durationString?: string): number => {
	if (!durationString) return 0

	try {
		// Handle Django DurationField format: "0:01:30.500000"
		if (durationString.includes(':')) {
			const parts = durationString.split(':')
			if (parts.length === 3) {
				// Format: "0:01:30.500000"
				const hours = Number.parseInt(parts[0], 10)
				const minutes = Number.parseInt(parts[1], 10)
				const secondsWithMs = Number.parseFloat(parts[2])
				return hours * 3600 + minutes * 60 + secondsWithMs
			}
			if (parts.length === 2) {
				// Format: "1:30"
				const minutes = Number.parseInt(parts[0], 10)
				const seconds = Number.parseInt(parts[1], 10)
				return minutes * 60 + seconds
			}
		}

		// Try parsing as a simple number (seconds)
		const seconds = Number.parseFloat(durationString)
		if (!Number.isNaN(seconds)) {
			return seconds
		}

		return 0
	} catch (error) {
		console.error('Error parsing duration string:', durationString, error)
		return 0
	}
}
