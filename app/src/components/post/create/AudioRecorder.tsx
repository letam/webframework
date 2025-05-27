import { useState, useRef, useEffect } from 'react'
import { Mic, Square, Play, Pause, Loader2, SkipBack, SkipForward } from 'lucide-react'
import fixWebmDuration from 'webm-duration-fix'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { isSafari } from '@/lib/utils/browser'
import { supportedAudioMimeType } from '@/lib/utils/media'
import { getSettings } from '@/lib/utils/settings'
import { convertToWav } from '@/lib/utils/audio'

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

const AudioRecorder = ({
	onAudioCaptured,
	disabled,
}: { onAudioCaptured: (audioBlob: Blob) => void; disabled?: boolean }) => {
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

			// delay recording state update by 1 second in safari
			if (isSafari()) {
				setTimeout(() => {
					setStatus('recording')
				}, 1000)
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

	const formatTime = (timeInSeconds: number): string => {
		const minutes = Math.floor(timeInSeconds / 60)
		const seconds = Math.floor(timeInSeconds % 60)
		return `${minutes}:${seconds.toString().padStart(2, '0')}`
	}

	const handleTimeUpdate = () => {
		if (audioRef.current) {
			setCurrentTime(audioRef.current.currentTime)
		}
	}

	const handleLoadedMetadata = () => {
		if (audioRef.current) {
			setDuration(audioRef.current.duration)
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
				progressIntervalRef.current = setInterval(handleTimeUpdate, 100)
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
		setCurrentTime(0)
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

				{audioURL && !isProcessing(status) && (
					<div className="flex items-center space-x-2">
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={() => seekAudio(currentTime - 5)}
							className="w-8 h-8 rounded-full"
							disabled={disabled}
						>
							<SkipBack className="h-4 w-4" />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={togglePlayback}
							className="w-10 h-10 rounded-full"
							disabled={disabled}
						>
							{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={() => seekAudio(currentTime + 5)}
							className="w-8 h-8 rounded-full"
							disabled={disabled}
						>
							<SkipForward className="h-4 w-4" />
						</Button>
					</div>
				)}

				<StatusMessage status={status} showNormalizingMessage={showNormalizingMessage} />
			</div>

			{audioURL && !isProcessing(status) && (
				<div className="flex flex-col space-y-1">
					<div className="flex items-center space-x-2">
						<span className="text-xs text-muted-foreground">{formatTime(currentTime)}</span>
						<div
							className="flex-1 h-1 bg-secondary rounded-full overflow-hidden cursor-pointer relative"
							onClick={(e) => {
								const rect = e.currentTarget.getBoundingClientRect()
								const clickPosition = e.clientX - rect.left
								const percentage = clickPosition / rect.width
								const newTime = percentage * duration
								seekAudio(newTime)
							}}
							onKeyDown={(e) => {
								if (e.key === 'ArrowLeft') {
									seekAudio(currentTime - 1)
								} else if (e.key === 'ArrowRight') {
									seekAudio(currentTime + 1)
								} else if (e.key === 'Home') {
									seekAudio(0)
								} else if (e.key === 'End') {
									seekAudio(duration)
								}
							}}
							role="slider"
							tabIndex={0}
							aria-label="Audio progress"
							aria-valuemin={0}
							aria-valuemax={duration}
							aria-valuenow={currentTime}
						>
							<div
								className="h-full bg-primary transition-all duration-100"
								style={{ width: `${(currentTime / duration) * 100}%` }}
							/>
						</div>
						<span className="text-xs text-muted-foreground">{formatTime(duration)}</span>
					</div>
				</div>
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
}

export default AudioRecorder
