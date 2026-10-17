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
	// Guard: this module is pulled into every feed render (Post.tsx imports
	// parseDurationString below), and a browser/webview without MediaRecorder
	// would otherwise throw here at import time — a blank page React never mounts.
	if (typeof MediaRecorder === 'undefined') return []
	return videoMimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export const supportedVideoMimeType = getSupportedVideoMimeTypes()[0]

export const audioMimeTypes = [
	'audio/webm;codecs=opus',
	'audio/mp4;codecs=mp4a.40.2',
	'audio/mp4;codecs=opus',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
]

export function getSupportedAudioMimeTypes() {
	if (typeof MediaRecorder === 'undefined') return []
	return audioMimeTypes.filter((mimeType) => MediaRecorder.isTypeSupported(mimeType))
}

export const supportedAudioMimeType = getSupportedAudioMimeTypes()[0]
export const mimeTypes = [...videoMimeTypes, ...audioMimeTypes]

// Django's DurationField serializes as "[D ]HH:MM:SS[.ffffff]" — the day count is
// space-separated, so a 25-hour recording arrives as "1 01:00:03", not "25:00:03".
// Negative durations ("-1 23:59:59") deliberately don't match: media can't have one.
const DJANGO_DURATION = /^(?:(\d+) )?(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/
const MINUTES_SECONDS = /^(\d+):(\d{1,2})$/

/**
 * Parses a duration string from a media record into seconds
 * @param durationString The duration string (e.g., "00:01:30.500000", "1 01:00:03" or "1:30")
 * @returns The duration in seconds, or 0 if parsing fails
 */
export const parseDurationString = (durationString?: string): number => {
	if (!durationString) return 0

	const django = DJANGO_DURATION.exec(durationString)
	if (django) {
		const [, days = '0', hours, minutes, seconds] = django
		return Number(days) * 86_400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)
	}

	const minutesSeconds = MINUTES_SECONDS.exec(durationString)
	if (minutesSeconds) {
		return Number(minutesSeconds[1]) * 60 + Number(minutesSeconds[2])
	}

	// A bare number of seconds. Number() rejects trailing junk that parseFloat accepts.
	const seconds = Number(durationString)
	return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
}
