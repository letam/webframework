import { useState, useRef, useEffect } from 'react'
import { Square, Pause, Play, Loader2, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'
// webm-duration-fix (and its Node polyfills) is only needed once a recording
// stops, so it is imported dynamically to keep it out of the initial bundle.
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { isIOS, isSafari } from '@/lib/utils/browser'
import { supportedAudioMimeType } from '@/lib/utils/media'
import { getSettings } from '@/lib/utils/settings'
import { convertToWav } from '@/lib/utils/audio'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface AudioRecorderModalProps {
	onAudioCaptured: (audioBlob: Blob) => void
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const AudioRecorderModal: React.FC<AudioRecorderModalProps> = ({
	onAudioCaptured,
	open,
	onOpenChange,
}) => {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px] h-[300px] flex flex-col">
				<DialogHeader className="text-center py-2">
					<DialogTitle className="flex items-center justify-center gap-2">
						<Mic className="h-5 w-5" />
						Record Audio
					</DialogTitle>
				</DialogHeader>
				<div className="flex-1 flex flex-col">
					<AudioRecorder onAudioCaptured={onAudioCaptured} autoStart={true} />
				</div>
			</DialogContent>
		</Dialog>
	)
}

type RecordingStatus =
	| 'idle'
	| 'loading'
	| 'recording'
	| 'paused'
	| 'normalizing'
	| 'ready'
	| 'error'

interface StatusMessageProps {
	status: RecordingStatus
	showNormalizingMessage: boolean
	recordingTime?: number
	errorMessage?: string | null
}

const formatTime = (seconds: number): string => {
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// Map a getUserMedia rejection to a message that tells the user what to fix.
const micErrorMessage = (error: unknown): string => {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
			return 'Microphone access was blocked. Allow it in your browser settings, then try again.'
		}
		if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
			return 'No microphone was found. Connect one and try again.'
		}
		if (error.name === 'NotReadableError') {
			return 'Your microphone is in use by another app. Close it and try again.'
		}
	}
	return 'Unable to access microphone. Please check permissions and try again.'
}

const StatusMessage = ({
	status,
	showNormalizingMessage,
	recordingTime,
	errorMessage,
}: StatusMessageProps) => {
	if (status === 'error') {
		return (
			<div className="flex items-center justify-center px-4 text-center text-base">
				<span className="text-muted-foreground">
					{errorMessage ?? 'Unable to access microphone. Please check permissions and try again.'}
				</span>
			</div>
		)
	}
	if (status === 'loading') {
		return (
			<div className="flex items-center justify-center gap-2 text-base">
				<Loader2 className="h-5 w-5 animate-spin" />
				<span className="text-muted-foreground">Initializing microphone...</span>
			</div>
		)
	}
	if (status === 'recording') {
		return (
			<div className="flex flex-col items-center justify-center gap-1 text-base">
				<span className="text-primary font-medium">Recording...</span>
				{recordingTime !== undefined && (
					<div className="text-2xl font-mono font-bold text-primary tabular-nums">
						{formatTime(recordingTime)}
					</div>
				)}
			</div>
		)
	}
	if (status === 'paused') {
		return (
			<div className="flex flex-col items-center justify-center gap-2 text-base">
				<div className="flex items-center gap-2">
					<Pause className="h-5 w-5 text-muted-foreground" />
					<span className="text-muted-foreground font-medium">Recording paused</span>
				</div>
				{recordingTime !== undefined && (
					<div className="text-2xl font-mono font-bold text-muted-foreground">
						{formatTime(recordingTime)}
					</div>
				)}
			</div>
		)
	}
	if (status === 'normalizing' && showNormalizingMessage) {
		return (
			<div className="flex items-center justify-center gap-2 text-base">
				<Loader2 className="h-5 w-5 animate-spin" />
				<span className="text-muted-foreground">Normalizing audio...</span>
			</div>
		)
	}
	if (status === 'ready') {
		return (
			<div className="flex items-center justify-center gap-2 text-base">
				<span className="text-muted-foreground font-medium">Audio recorded</span>
			</div>
		)
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

			// Apply normalization if needed
			const gain = maxAmplitude > 0 ? 0.8 / maxAmplitude : 1

			for (let i = 0; i < channelData.length; i++) {
				normalizedData[i] = channelData[i] * gain
			}
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

interface AudioRecorderProps {
	onAudioCaptured: (audioBlob: Blob) => void
	disabled?: boolean
	submitStatus?: '' | 'preparing' | 'compressing' | 'submitting'
	isProcessing?: boolean
	autoStart?: boolean
}

const AudioRecorder = ({
	onAudioCaptured,
	disabled,
	submitStatus = '',
	isProcessing = false,
	autoStart = false,
}: AudioRecorderProps) => {
	const [status, setStatus] = useState<RecordingStatus>('idle')
	const [showNormalizingMessage, setShowNormalizingMessage] = useState(false)
	const [audioURL, setAudioURL] = useState<string | null>(null)
	const [recordingTime, setRecordingTime] = useState<number>(0)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	// Guards the auto-start effect so a denied getUserMedia can't spin an infinite
	// retry loop: startRecording sends status back through 'error', but even a
	// bounce through 'idle' must not re-fire auto-start after the first attempt.
	const hasAutoStartedRef = useRef(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const audioChunksRef = useRef<Blob[]>([])
	const normalizingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
	// Live input-level meter (AnalyserNode drives the ring around the mic)
	const audioContextRef = useRef<AudioContext | null>(null)
	const analyserRef = useRef<AnalyserNode | null>(null)
	const meterRafRef = useRef<number | undefined>(undefined)
	const meterRef = useRef<HTMLSpanElement | null>(null)

	const startMeter = () => {
		const analyser = analyserRef.current
		if (!analyser) return
		const data = new Uint8Array(analyser.fftSize)
		const tick = () => {
			analyser.getByteTimeDomainData(data)
			let sum = 0
			for (let i = 0; i < data.length; i++) {
				const value = (data[i] - 128) / 128
				sum += value * value
			}
			const rms = Math.sqrt(sum / data.length)
			const level = Math.min(1, rms * 4)
			if (meterRef.current) {
				meterRef.current.style.transform = `scale(${1 + level * 1.1})`
				meterRef.current.style.opacity = `${0.25 + level * 0.55}`
			}
			meterRafRef.current = requestAnimationFrame(tick)
		}
		meterRafRef.current = requestAnimationFrame(tick)
	}

	const stopMeter = () => {
		if (meterRafRef.current !== undefined) {
			cancelAnimationFrame(meterRafRef.current)
			meterRafRef.current = undefined
		}
		if (meterRef.current) {
			meterRef.current.style.transform = 'scale(1)'
			meterRef.current.style.opacity = '0.25'
		}
	}

	const teardownMeter = () => {
		stopMeter()
		analyserRef.current = null
		if (audioContextRef.current) {
			audioContextRef.current.close().catch(() => {})
			audioContextRef.current = null
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: auto-start should only respond to the external trigger and current status
	useEffect(() => {
		if (autoStart && status === 'idle' && !hasAutoStartedRef.current) {
			hasAutoStartedRef.current = true
			startRecording()
		}
	}, [autoStart, status])

	const reset = () => {
		setStatus('idle')
		setShowNormalizingMessage(false)
		setRecordingTime(0)
		setErrorMessage(null)
		// Dropping the URL from state is what revokes it; see the effect below.
		setAudioURL(null)
		audioChunksRef.current = []
		const recorder = mediaRecorderRef.current
		if (recorder) {
			// Detach handlers first so stopping the tracks below can't fire an onstop
			// that normalizes and calls back after we've torn down (e.g. on unmount).
			recorder.ondataavailable = null
			recorder.onstop = null
			if (recorder.state !== 'inactive') {
				recorder.stop()
			}
			// Release the mic: without this, closing the modal mid-record leaves the
			// browser's recording indicator on and the microphone hot.
			for (const track of recorder.stream.getTracks()) {
				track.stop()
			}
			mediaRecorderRef.current = null
		}
		if (normalizingTimeoutRef.current) {
			clearTimeout(normalizingTimeoutRef.current)
		}
		if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = undefined
		}
		teardownMeter()
	}

	const startTimer = (opts: { reset: boolean } = { reset: false }) => {
		if (timerRef.current) {
			clearInterval(timerRef.current)
		}
		if (opts.reset) {
			setRecordingTime(0)
		}
		timerRef.current = setInterval(() => {
			setRecordingTime((prev) => prev + 1)
		}, 1000)
	}

	const stopTimer = () => {
		if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = undefined
		}
	}

	const startRecording = async () => {
		if (disabled) return

		try {
			setStatus('loading')
			setErrorMessage(null)
			// Clean up previous audio state; clearing it revokes the old take.
			setAudioURL(null)

			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedAudioMimeType })
			mediaRecorderRef.current = mediaRecorder
			audioChunksRef.current = []

			// Feed the level meter from the same stream (best-effort; recording works without it)
			try {
				const audioContext = new AudioContext()
				const source = audioContext.createMediaStreamSource(stream)
				const analyser = audioContext.createAnalyser()
				analyser.fftSize = 512
				source.connect(analyser)
				audioContextRef.current = audioContext
				analyserRef.current = analyser
				startMeter()
			} catch (meterError) {
				console.error('Could not start level meter:', meterError)
			}

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					audioChunksRef.current.push(e.data)
				}
			}

			mediaRecorder.onstop = () => {
				stopTimer()
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
							const { default: fixWebmDuration } = await import('webm-duration-fix')
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
			startTimer({ reset: true })

			// In Safari desktop app, delay recording state update by 500ms since the microphone does not always start recording immediately
			if (isSafari() && !isIOS()) {
				setTimeout(() => {
					setStatus('recording')
				}, 500)
			} else {
				setStatus('recording')
			}
		} catch (error) {
			const message = micErrorMessage(error)
			console.error('Error accessing microphone:', error)
			toast.error(message)
			setErrorMessage(message)
			// Terminal 'error' (not 'idle') so the auto-start effect can't retry in a
			// loop; the user retries explicitly via the button below.
			setStatus('error')
		}
	}

	const pauseRecording = () => {
		if (mediaRecorderRef.current && status === 'recording') {
			mediaRecorderRef.current.pause()
			stopTimer()
			stopMeter()
			setStatus('paused')
		} else if (mediaRecorderRef.current && status === 'paused') {
			mediaRecorderRef.current.resume()
			startTimer()
			startMeter()
			setStatus('recording')
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && (status === 'recording' || status === 'paused')) {
			mediaRecorderRef.current.stop()
			stopTimer()
			teardownMeter()
			// Stop all audio tracks
			for (const track of mediaRecorderRef.current.stream.getTracks()) {
				track.stop()
			}
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: cleanup should only run when this recorder unmounts
	useEffect(() => {
		return () => {
			reset()
		}
	}, [])

	// Revoking the object URL lives here, not in `reset`. The unmount cleanup above
	// captures render 1's `reset`, whose `audioURL` is still null, so a revoke from
	// there never ran and the recorded take stayed pinned for the tab's lifetime.
	// Everything else `reset` touches is a ref, which is always current.
	useEffect(() => {
		if (!audioURL) return
		return () => URL.revokeObjectURL(audioURL)
	}, [audioURL])

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 flex flex-col items-center justify-center gap-3">
				{(status === 'recording' || status === 'paused') && (
					<div className="relative flex h-20 w-20 items-center justify-center">
						<span
							ref={meterRef}
							aria-hidden="true"
							className="absolute inset-0 rounded-full bg-primary/25 transition-transform duration-100 ease-out"
							style={{ opacity: 0.25 }}
						/>
						<span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
							<Mic
								className={cn(
									'h-6 w-6',
									status === 'recording' ? 'text-primary' : 'text-muted-foreground'
								)}
							/>
						</span>
					</div>
				)}
				<StatusMessage
					status={status}
					showNormalizingMessage={showNormalizingMessage}
					recordingTime={recordingTime}
					errorMessage={errorMessage}
				/>
			</div>

			<div className="flex justify-center gap-4 mt-auto">
				{status === 'error' && (
					<Button
						type="button"
						variant="outline"
						size="lg"
						onClick={startRecording}
						disabled={isProcessing || !!submitStatus}
						className="flex items-center gap-2 px-8"
					>
						<Mic className="h-5 w-5" />
						<span>Try again</span>
					</Button>
				)}
				{(status === 'recording' || status === 'paused') && (
					<>
						<Button
							type="button"
							variant="outline"
							size="lg"
							onClick={pauseRecording}
							disabled={isProcessing || !!submitStatus}
							className="flex items-center gap-2 px-8"
							autoFocus={status === 'recording'}
						>
							{status === 'recording' ? (
								<>
									<Pause className="h-5 w-5" />
									<span>Pause</span>
								</>
							) : (
								<>
									<Play className="h-5 w-5" />
									<span>Resume</span>
								</>
							)}
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="lg"
							onClick={stopRecording}
							disabled={isProcessing || !!submitStatus}
							className="flex items-center gap-2 px-8"
						>
							<Square className="h-5 w-5" />
							<span>Stop Recording</span>
						</Button>
					</>
				)}
			</div>
		</div>
	)
}

export default AudioRecorder
