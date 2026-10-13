import { useState, useRef, useEffect } from 'react'
import { Square, Pause, Play, Loader2, Mic, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { isIOS, isSafari } from '@/lib/utils/browser'
import { supportedAudioMimeType } from '@/lib/utils/media'
import { getSettings } from '@/lib/utils/settings'
import { convertToWav } from '@/lib/utils/audio'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
	captureErrorMessage,
	captureSupportError,
	classifyCaptureError,
	finalizeRecording,
	formatRecordingTime,
	interruptionToast,
	isRetryableCaptureError,
	stopStreamTracks,
	watchStreamInterruptions,
	type CaptureAction,
	type CaptureErrorKind,
	type RecordingStatus,
} from '@/lib/utils/capture'
import { useRecordingClock } from '@/hooks/useRecordingClock'
interface AudioRecorderModalProps {
	onAudioCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead: () => void
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const AudioRecorderModal: React.FC<AudioRecorderModalProps> = ({
	onAudioCaptured,
	onUploadInstead,
	open,
	onOpenChange,
}) => {
	const [isCapturing, setIsCapturing] = useState(false)
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[425px] min-h-[324px] flex flex-col"
				onInteractOutside={(e) => {
					if (isCapturing) e.preventDefault()
				}}
			>
				<DialogHeader className="text-center py-2">
					<DialogTitle className="flex items-center justify-center gap-2">
						<Mic className="h-5 w-5" />
						Record Audio
					</DialogTitle>
				</DialogHeader>
				<div className="flex-1 flex flex-col">
					{/* Radix keeps DialogContent mounted for its exit animation. Unmounting the
				    recorder with `open` runs its reset at once, so a take that finishes
				    processing after X/Esc cannot still be attached or posted. */}
					{open && (
						<AudioRecorder
							onAudioCaptured={onAudioCaptured}
							onCapturingChange={setIsCapturing}
							onUploadInstead={onUploadInstead}
							autoStart={true}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

interface StatusMessageProps {
	status: RecordingStatus | 'normalizing'
	seconds: number
	deviceMuted: boolean
	errorKind: CaptureErrorKind | null
}
const StatusMessage = ({ status, seconds, deviceMuted, errorKind }: StatusMessageProps) => {
	if (status === 'error' && errorKind)
		return (
			<div className="flex items-center justify-center px-4 text-center text-base">
				<span className="text-muted-foreground">
					{captureErrorMessage(errorKind, 'microphone')}
				</span>
			</div>
		)
	if (status === 'idle') return null
	const showClock = status === 'recording' || status === 'paused' || status === 'finishing'
	return (
		<div className="flex flex-col items-center justify-center gap-2 text-base">
			<div className="flex items-center justify-center gap-2">
				{(status === 'loading' || status === 'finishing' || status === 'normalizing') && (
					<Loader2 className="h-5 w-5 animate-spin" />
				)}
				{status === 'paused' && <Pause className="h-5 w-5 text-muted-foreground" />}
				<span
					className={status === 'recording' ? 'text-primary font-medium' : 'text-muted-foreground'}
				>
					{status === 'loading' && 'Initializing microphone...'}
					{status === 'recording' &&
						(deviceMuted ? 'Microphone paused by your device' : 'Recording...')}
					{status === 'paused' && 'Recording paused'}
					{status === 'finishing' && 'Finishing recording...'}
					{status === 'normalizing' && 'Normalizing audio...'}
				</span>
			</div>
			{showClock && (
				<div className="text-2xl font-mono font-bold text-primary tabular-nums">
					{formatRecordingTime(seconds)}
				</div>
			)}
		</div>
	)
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
		return finalizeRecording(audioBlob)
	}
}

interface AudioRecorderProps {
	onAudioCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead?: () => void
	disabled?: boolean
	autoStart?: boolean
	/** Reports a take in progress until its blob is handled. */
	onCapturingChange?: (capturing: boolean) => void
}

const AudioRecorder = ({
	onAudioCaptured,
	onCapturingChange,
	onUploadInstead,
	disabled,
	autoStart = false,
}: AudioRecorderProps) => {
	const [status, setStatus] = useState<RecordingStatus | 'normalizing'>('idle')
	const [errorKind, setErrorKind] = useState<CaptureErrorKind | null>(null)
	const [deviceMuted, setDeviceMuted] = useState(false)
	const clock = useRecordingClock()
	const hasAutoStartedRef = useRef(false)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const unwatchRef = useRef<(() => void) | null>(null)
	const chunksRef = useRef<Blob[]>([])
	const stopActionRef = useRef<CaptureAction>('attach')
	const interruptionRef = useRef<'ended' | 'error' | null>(null)
	// Invalidate a permission request if the dialog closes before it resolves.
	const captureAttemptRef = useRef(0)
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

	const isBusy =
		status === 'loading' ||
		status === 'recording' ||
		status === 'finishing' ||
		status === 'paused' ||
		status === 'normalizing'
	useEffect(() => {
		onCapturingChange?.(isBusy)
	}, [isBusy, onCapturingChange])

	const reset = () => {
		captureAttemptRef.current++
		unwatchRef.current?.()
		unwatchRef.current = null
		const recorder = mediaRecorderRef.current
		if (recorder) {
			// Detach handlers before stopping so a discarded recording cannot attach.
			recorder.ondataavailable = null
			recorder.onstop = null
			recorder.onerror = null
			if (recorder.state !== 'inactive') recorder.stop()
			mediaRecorderRef.current = null
		}
		stopStreamTracks(streamRef.current)
		streamRef.current = null
		chunksRef.current = []
		clock.reset()
		teardownMeter()
		interruptionRef.current = null
		setDeviceMuted(false)
		setErrorKind(null)
		setStatus('idle')
	}

	const startRecording = async () => {
		if (disabled) return
		setErrorKind(null)
		setDeviceMuted(false)
		interruptionRef.current = null
		stopActionRef.current = 'attach'
		const unsupported = captureSupportError()
		if (unsupported) {
			setErrorKind(unsupported)
			setStatus('error')
			return
		}
		const attempt = ++captureAttemptRef.current
		setStatus('loading')
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			if (captureAttemptRef.current !== attempt) {
				stopStreamTracks(stream)
				return
			}
			streamRef.current = stream
			unwatchRef.current = watchStreamInterruptions(stream, (event) => {
				if (event === 'muted') setDeviceMuted(true)
				else if (event === 'unmuted') setDeviceMuted(false)
				else {
					if (interruptionRef.current === null) interruptionRef.current = 'ended'
					try {
						if (recorder.state !== 'inactive') recorder.stop()
					} catch {
						// The browser may already have stopped the recorder.
					}
				}
			})
			const recorder = new MediaRecorder(stream, { mimeType: supportedAudioMimeType })
			mediaRecorderRef.current = recorder
			chunksRef.current = []
			// Feed the level meter from the same stream (best-effort).
			try {
				const audioContext = new AudioContext()
				audioContext.resume().catch(() => {})
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
			recorder.ondataavailable = (e) => {
				if (e.data.size > 0) chunksRef.current.push(e.data)
			}
			recorder.onerror = () => {
				if (interruptionRef.current === null) interruptionRef.current = 'error'
				try {
					if (recorder.state !== 'inactive') recorder.stop()
				} catch {
					// The browser may already have stopped the recorder.
				}
			}
			recorder.onstop = () => {
				unwatchRef.current?.()
				unwatchRef.current = null
				stopStreamTracks(streamRef.current)
				streamRef.current = null
				teardownMeter()
				clock.pause()
				setStatus('finishing')
				const interruption = interruptionRef.current
				const action = interruption ? 'attach' : stopActionRef.current
				void (async () => {
					const raw = new Blob(chunksRef.current, {
						type: chunksRef.current[0]?.type ?? recorder.mimeType,
					})
					if (raw.size === 0) {
						setErrorKind(interruption === 'ended' ? 'disconnected-empty' : 'empty')
						setStatus('error')
						return
					}
					try {
						let take = raw
						if (getSettings().normalizeAudio) {
							setStatus('normalizing')
							take = await normalizeAudio(raw)
						} else take = await finalizeRecording(raw)
						if (mediaRecorderRef.current !== recorder) return
						if (interruption) toast.info(interruptionToast(interruption, 'microphone'))
						onAudioCaptured(take, action)
						setStatus('idle')
					} catch (error) {
						console.error('Error processing audio recording:', error)
						if (mediaRecorderRef.current !== recorder) return
						setErrorKind('processing')
						setStatus('error')
					}
				})()
			}
			recorder.start()
			clock.start()
			// Safari desktop may need 500 ms before the microphone begins capturing.
			if (isSafari() && !isIOS()) {
				setTimeout(() => {
					if (mediaRecorderRef.current === recorder && recorder.state === 'recording')
						setStatus('recording')
				}, 500)
			} else setStatus('recording')
		} catch (error) {
			if (captureAttemptRef.current !== attempt) return
			console.error('Error accessing microphone:', error)
			unwatchRef.current?.()
			unwatchRef.current = null
			stopStreamTracks(streamRef.current)
			streamRef.current = null
			teardownMeter()
			setErrorKind(classifyCaptureError(error))
			setStatus('error')
		}
	}

	const pauseRecording = () => {
		if (mediaRecorderRef.current && status === 'recording') {
			mediaRecorderRef.current.pause()
			clock.pause()
			stopMeter()
			setStatus('paused')
		} else if (mediaRecorderRef.current && status === 'paused') {
			mediaRecorderRef.current.resume()
			clock.resume()
			startMeter()
			setStatus('recording')
		}
	}
	const stopRecording = (action: CaptureAction) => {
		if (mediaRecorderRef.current && (status === 'recording' || status === 'paused')) {
			stopActionRef.current = action
			clock.pause()
			stopMeter()
			setStatus('finishing')
			mediaRecorderRef.current.stop()
		}
	}
	const startRecordingRef = useRef(startRecording)
	startRecordingRef.current = startRecording
	const resetRef = useRef(reset)
	resetRef.current = reset
	useEffect(() => {
		if (autoStart && status === 'idle' && !hasAutoStartedRef.current) {
			hasAutoStartedRef.current = true
			void startRecordingRef.current()
		}
	}, [autoStart, status])
	useEffect(
		() => () => {
			// Re-arm auto-start so a remount of the same instance (StrictMode) starts again.
			hasAutoStartedRef.current = false
			resetRef.current()
		},
		[]
	)

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 flex flex-col items-center justify-center gap-3">
				{(status === 'recording' || status === 'paused' || status === 'finishing') && (
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
					seconds={clock.seconds}
					deviceMuted={deviceMuted}
					errorKind={errorKind}
				/>
			</div>
			<div className="flex flex-wrap justify-center gap-3 mt-auto pt-6">
				{status === 'error' && errorKind && (
					<>
						{isRetryableCaptureError(errorKind) && (
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									reset()
									void startRecording()
								}}
								disabled={disabled}
							>
								<Mic className="h-5 w-5" />
								Try again
							</Button>
						)}
						{onUploadInstead && (
							<Button type="button" variant="ghost" onClick={onUploadInstead}>
								Upload a file instead
							</Button>
						)}
					</>
				)}
				{(status === 'recording' || status === 'paused') && (
					<>
						<Button
							type="button"
							variant="outline"
							size="icon"
							onClick={pauseRecording}
							disabled={disabled}
							autoFocus={status === 'recording'}
							aria-label={status === 'recording' ? 'Pause' : 'Resume'}
							title={status === 'recording' ? 'Pause' : 'Resume'}
						>
							{status === 'recording' ? (
								<Pause className="h-5 w-5" />
							) : (
								<Play className="h-5 w-5" />
							)}
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => stopRecording('attach')}
							disabled={disabled}
						>
							<Square className="h-5 w-5" />
							Stop
						</Button>
						<Button type="button" onClick={() => stopRecording('post')} disabled={disabled}>
							<Send className="h-5 w-5" />
							Post
						</Button>
					</>
				)}
			</div>
		</div>
	)
}
export default AudioRecorder
