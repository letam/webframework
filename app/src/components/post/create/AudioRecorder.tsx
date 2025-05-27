import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'
import fixWebmDuration from 'webm-duration-fix'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { isIOS, isSafari } from '@/lib/utils/browser'
import { supportedAudioMimeType } from '@/lib/utils/media'
import { getSettings } from '@/lib/utils/settings'
import { convertToWav } from '@/lib/utils/audio'
import { AudioControls } from '@/components/post/MediaPlayer'

type RecordingStatus = 'idle' | 'loading' | 'recording' | 'normalizing' | 'ready'

interface StatusMessageProps {
	status: RecordingStatus
	showNormalizingMessage: boolean
}

const isProcessing = (status: RecordingStatus): boolean => {
	return ['recording', 'loading', 'normalizing'].includes(status)
}

const StatusMessage = ({ status, showNormalizingMessage }: StatusMessageProps) => {
	if (status === 'loading') {
		return <span className="text-sm text-muted-foreground">Initializing microphone...</span>
	}
	if (status === 'recording') {
		return <span className="text-sm text-primary">Recording...</span>
	}
	if (status === 'normalizing' && showNormalizingMessage) {
		return <span className="text-sm text-muted-foreground">Normalizing audio...</span>
	}
	if (status === 'ready') {
		return <span className="text-sm text-muted-foreground">Audio recorded</span>
	}
	return null
}

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

export interface AudioRecorderRef {
	stopRecording: () => void
	getStatus: () => RecordingStatus
}

const AudioRecorder = forwardRef<
	AudioRecorderRef,
	{
		onAudioCaptured: (audioBlob: Blob) => void
		disabled?: boolean
		submitStatus?: '' | 'preparing' | 'compressing' | 'submitting'
	}
>(({ onAudioCaptured, disabled, submitStatus = '' }, ref) => {
	const [status, setStatus] = useState<RecordingStatus>('idle')
	const [showNormalizingMessage, setShowNormalizingMessage] = useState(false)
	const [audioURL, setAudioURL] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [duration, setDuration] = useState<number>(0)
	const [currentTime, setCurrentTime] = useState<number>(0)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const audioChunksRef = useRef<Blob[]>([])
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const normalizingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const progressIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

	const startRecording = async () => {
		if (disabled) return

		try {
			setStatus('loading')
			// Clean up previous audio state
			if (audioURL) {
				URL.revokeObjectURL(audioURL)
				setAudioURL(null)
			}
			setIsPlaying(false)

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
						let audioBlob = new Blob(audioChunksRef.current, {
							type: audioChunksRef.current[0]?.type,
						})

						// Only normalize if the setting is enabled
						if (getSettings().normalizeAudio) {
							setStatus('normalizing')
							normalizingTimeoutRef.current = setTimeout(() => {
								setShowNormalizingMessage(true)
							}, 500)
							audioBlob = await normalizeAudio(audioBlob)
							if (normalizingTimeoutRef.current) {
								clearTimeout(normalizingTimeoutRef.current)
							}
							setShowNormalizingMessage(false)
						} else {
							audioBlob = await fixWebmDuration(audioBlob)
						}

						const audioUrl = URL.createObjectURL(audioBlob)
						setAudioURL(audioUrl)
						onAudioCaptured(audioBlob)
						setStatus('ready')
					} catch (error) {
						console.error('Error processing audio:', error)
						toast.error('Error processing audio recording')
						setStatus('idle')
						setShowNormalizingMessage(false)
					}
				})()
			}

			mediaRecorder.start()

			// In Safari desktop app, delay recording state update by 500ms since the microphone does not always start recording immediately
			if (isSafari() && !isIOS()) {
				setTimeout(() => {
					setStatus('recording')
				}, 500)
			} else {
				setStatus('recording')
			}
		} catch (error) {
			console.error('Error accessing microphone:', error)
			toast.error('Unable to access microphone. Please check permissions.')
			setStatus('idle')
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && status === 'recording') {
			mediaRecorderRef.current.stop()
			// Stop all audio tracks
			for (const track of mediaRecorderRef.current.stream.getTracks()) {
				track.stop()
			}
		}
	}

	const handleTimeUpdate = () => {
		if (audioRef.current) {
			const currentTime = audioRef.current.currentTime
			setCurrentTime(currentTime)
			// If we're very close to the end, let the ended event handle it
			if (currentTime >= duration - 0.1) {
				if (progressIntervalRef.current) {
					clearInterval(progressIntervalRef.current)
				}
			}
		}
	}

	const handleLoadedMetadata = () => {
		if (audioRef.current) {
			// Add a small buffer to the duration to prevent early cutoff
			setDuration(audioRef.current.duration + 0.1)
		}
	}

	const seekAudio = (seconds: number) => {
		if (audioRef.current) {
			audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration))
		}
	}

	const togglePlayback = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
				if (progressIntervalRef.current) {
					clearInterval(progressIntervalRef.current)
				}
			} else {
				audioRef.current.play()
				// Use a shorter interval for smoother progress updates
				progressIntervalRef.current = setInterval(handleTimeUpdate, 50)
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
		setCurrentTime(duration) // Set to exact duration
		if (progressIntervalRef.current) {
			clearInterval(progressIntervalRef.current)
		}
	}

	useEffect(() => {
		return () => {
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current)
			}
		}
	}, [])

	useImperativeHandle(ref, () => ({
		stopRecording,
		getStatus: () => status,
	}))

	return (
		<div className="flex flex-col space-y-2">
			<div className="flex items-center space-x-2">
				{status !== 'recording' ? (
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={startRecording}
						className="w-10 h-10 rounded-full"
						disabled={status === 'loading' || disabled}
					>
						{status === 'loading' ? (
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
						disabled={disabled}
					>
						<Square className="h-5 w-5" />
					</Button>
				)}

				<StatusMessage status={status} showNormalizingMessage={showNormalizingMessage} />
			</div>

			{audioURL && !isProcessing(status) && submitStatus === '' && (
				<AudioControls
					audioRef={audioRef}
					isPlaying={isPlaying}
					duration={duration}
					currentTime={currentTime}
					onPlayPause={togglePlayback}
					onSeek={seekAudio}
					disabled={disabled}
				/>
			)}

			{audioURL && (
				<audio
					ref={audioRef}
					className="hidden"
					onEnded={handlePlaybackEnded}
					onTimeUpdate={handleTimeUpdate}
					onLoadedMetadata={handleLoadedMetadata}
				>
					<source src={audioURL} />
					<track kind="captions" label="English" />
				</audio>
			)}
		</div>
	)
})

export default AudioRecorder
