import { useState, useRef } from 'react'
import { Mic, Square, Play, Pause, Loader2 } from 'lucide-react'
import fixWebmDuration from 'webm-duration-fix'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { isSafari } from '@/lib/utils/browser'
import { supportedAudioMimeType } from '@/lib/utils/media'

const normalizeAudio = async (audioBlob: Blob): Promise<Blob> => {
	try {
		const audioContext = new AudioContext()
		const arrayBuffer = await audioBlob.arrayBuffer()
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

		// Create a new buffer with the same number of channels
		const normalizedBuffer = audioContext.createBuffer(
			audioBuffer.numberOfChannels,
			audioBuffer.length,
			audioBuffer.sampleRate
		)

		// Normalize each channel
		for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
			const channelData = audioBuffer.getChannelData(channel)
			const normalizedData = normalizedBuffer.getChannelData(channel)

			// Find the maximum amplitude
			let maxAmplitude = 0
			for (let i = 0; i < channelData.length; i++) {
				maxAmplitude = Math.max(maxAmplitude, Math.abs(channelData[i]))
			}

			console.log('Original max amplitude:', maxAmplitude) // DEBUG

			// Apply normalization if needed
			const gain = maxAmplitude > 0 ? 0.8 / maxAmplitude : 1
			console.log('Applied gain:', gain) // DEBUG

			for (let i = 0; i < channelData.length; i++) {
				normalizedData[i] = channelData[i] * gain
			}

			// DEBUG
			// Verify the new max amplitude
			let newMaxAmplitude = 0
			for (let i = 0; i < normalizedData.length; i++) {
				newMaxAmplitude = Math.max(newMaxAmplitude, Math.abs(normalizedData[i]))
			}
			console.log('New max amplitude:', newMaxAmplitude)
			// END DEBUG
		}

		const offlineContext = new OfflineAudioContext(
			normalizedBuffer.numberOfChannels,
			normalizedBuffer.length,
			normalizedBuffer.sampleRate
		)
		const source = offlineContext.createBufferSource()
		source.buffer = normalizedBuffer
		source.connect(offlineContext.destination)
		source.start()

		const renderedBuffer = await offlineContext.startRendering()

		// Convert to WAV format for all browsers to ensure compatibility
		const wavBlob = new Blob([await convertToWav(renderedBuffer)], { type: 'audio/wav' })
		return wavBlob
	} catch (error) {
		console.error('Error normalizing audio:', error)
		return audioBlob // Return original blob if normalization fails
	}
}

// Helper function to convert AudioBuffer to WAV format
const convertToWav = async (audioBuffer: AudioBuffer): Promise<ArrayBuffer> => {
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

const AudioRecorder = ({ onAudioCaptured }: { onAudioCaptured: (audioBlob: Blob) => void }) => {
	const [isRecording, setIsRecording] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [audioURL, setAudioURL] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const audioChunksRef = useRef<Blob[]>([])
	const audioRef = useRef<HTMLAudioElement | null>(null)

	const startRecording = async () => {
		try {
			setIsLoading(true)
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedAudioMimeType })
			mediaRecorderRef.current = mediaRecorder
			audioChunksRef.current = []

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					audioChunksRef.current.push(e.data)
				}
			}

			mediaRecorder.onstop = () => {
				;(async () => {
					try {
						let audioBlob = await fixWebmDuration(
							new Blob(audioChunksRef.current, { type: audioChunksRef.current[0]?.type })
						)
						audioBlob = await normalizeAudio(audioBlob)
						const audioUrl = URL.createObjectURL(audioBlob)
						setAudioURL(audioUrl)
						onAudioCaptured(audioBlob)
					} catch (error) {
						console.error('Error processing audio:', error)
						toast.error('Error processing audio recording')
					}
				})()
			}

			mediaRecorder.start()

			// delay recording state update by 1 second in safari
			if (isSafari()) {
				setTimeout(() => {
					setIsRecording(true)
					setIsLoading(false)
				}, 1000)
			} else {
				setIsRecording(true)
				setIsLoading(false)
			}
		} catch (error) {
			console.error('Error accessing microphone:', error)
			toast.error('Unable to access microphone. Please check permissions.')
			setIsLoading(false)
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
			mediaRecorderRef.current.stop()
			// Stop all audio tracks
			for (const track of mediaRecorderRef.current.stream.getTracks()) {
				track.stop()
			}
			setIsRecording(false)
		}
	}

	const togglePlayback = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
			} else {
				audioRef.current.play()
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="flex flex-col space-y-2">
			<div className="flex items-center space-x-2">
				{!isRecording ? (
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={startRecording}
						className="w-10 h-10 rounded-full"
						disabled={isLoading}
					>
						{isLoading ? (
							<Loader2 className="h-5 w-5 text-primary animate-spin" />
						) : (
							<Mic className="h-5 w-5 text-primary" />
						)}
					</Button>
				) : (
					<Button
						type="button"
						variant="destructive"
						size="icon"
						onClick={stopRecording}
						className="w-10 h-10 rounded-full animate-pulse-gentle"
					>
						<Square className="h-5 w-5" />
					</Button>
				)}

				{audioURL && !isRecording && !isLoading && (
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={togglePlayback}
						className="w-10 h-10 rounded-full"
					>
						{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
					</Button>
				)}

				{isLoading && (
					<span className="text-sm text-muted-foreground">Initializing microphone...</span>
				)}
				{isRecording && <span className="text-sm text-primary">Recording...</span>}

				{audioURL && !isRecording && !isLoading && (
					<span className="text-sm text-muted-foreground">Audio recorded</span>
				)}
			</div>

			{audioURL && (
				<audio ref={audioRef} src={audioURL} className="hidden" onEnded={handlePlaybackEnded}>
					<track kind="captions" label="English" />
				</audio>
			)}
		</div>
	)
}

export default AudioRecorder
