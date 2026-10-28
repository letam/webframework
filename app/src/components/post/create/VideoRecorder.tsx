import { useState, useRef, useEffect } from 'react'
import { Video, Square, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { supportedVideoMimeType } from '@/lib/utils/media'
import { isIOS } from '@/lib/utils/browser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSettings } from '@/lib/utils/settings'
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
interface VideoRecorderModalProps {
	onVideoCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead: () => void
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const VideoRecorderModal: React.FC<VideoRecorderModalProps> = ({
	onVideoCaptured,
	onUploadInstead,
	open,
	onOpenChange,
}) => {
	const [isRecording, setIsRecording] = useState(false)
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[425px] min-h-[420px] flex flex-col"
				onInteractOutside={(e) => {
					if (isRecording) e.preventDefault()
				}}
			>
				<DialogHeader className="text-center py-2">
					<DialogTitle className="flex items-center justify-center gap-2">
						<Video className="h-5 w-5" />
						Record Video
					</DialogTitle>
				</DialogHeader>
				<div className="flex-1 flex flex-col">
					{/* Radix keeps DialogContent mounted for its exit animation. Unmounting the
				    recorder with `open` runs its reset at once, so a take that finishes
				    processing after X/Esc cannot still be attached or posted. */}
					{open && (
						<VideoRecorder
							onVideoCaptured={onVideoCaptured}
							onRecordingChange={setIsRecording}
							onCancel={() => onOpenChange(false)}
							onUploadInstead={onUploadInstead}
							autoStart={true}
						/>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

interface VideoRecorderProps {
	onVideoCaptured: (blob: Blob, action: CaptureAction) => void
	onUploadInstead?: () => void
	disabled?: boolean
	autoStart?: boolean
	/** Reports a take in progress until its blob is handled. */
	onRecordingChange?: (capturing: boolean) => void
	/** Called when the native camera is dismissed without a recording. */
	onCancel?: () => void
}
const VideoRecorder = ({
	onVideoCaptured,
	onRecordingChange,
	onCancel,
	onUploadInstead,
	disabled,
	autoStart = false,
}: VideoRecorderProps) => {
	const [status, setStatus] = useState<RecordingStatus>('idle')
	const [errorKind, setErrorKind] = useState<CaptureErrorKind | null>(null)
	const [deviceMuted, setDeviceMuted] = useState(false)
	const clock = useRecordingClock()
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const unwatchRef = useRef<(() => void) | null>(null)
	const chunksRef = useRef<Blob[]>([])
	const stopActionRef = useRef<CaptureAction>('attach')
	const interruptionRef = useRef<'ended' | 'error' | null>(null)
	const captureAttemptRef = useRef(0)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const hasAutoStartedRef = useRef(false)

	const isBusy = status === 'loading' || status === 'recording' || status === 'finishing'
	useEffect(() => {
		onRecordingChange?.(isBusy)
	}, [isBusy, onRecordingChange])

	// React does not wire onCancel for file inputs. iOS dismisses its camera with
	// this event rather than change, so close the dialog instead of stranding it.
	useEffect(() => {
		const input = fileInputRef.current
		if (!input || !onCancel) return
		input.addEventListener('cancel', onCancel)
		return () => input.removeEventListener('cancel', onCancel)
	}, [onCancel])

	const reset = () => {
		captureAttemptRef.current++
		unwatchRef.current?.()
		unwatchRef.current = null
		const recorder = mediaRecorderRef.current
		if (recorder) {
			recorder.ondataavailable = null
			recorder.onstop = null
			recorder.onerror = null
			if (recorder.state !== 'inactive') recorder.stop()
			mediaRecorderRef.current = null
		}
		stopStreamTracks(streamRef.current)
		streamRef.current = null
		if (videoRef.current) videoRef.current.srcObject = null
		chunksRef.current = []
		clock.reset()
		interruptionRef.current = null
		setDeviceMuted(false)
		setErrorKind(null)
		setStatus('idle')
	}
	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) onVideoCaptured(file, 'attach')
	}
	const startRecording = async () => {
		if (disabled) return
		setErrorKind(null)
		setDeviceMuted(false)
		interruptionRef.current = null
		stopActionRef.current = 'attach'
		// On iOS, use native camera input; cancellation closes the dialog.
		if (isIOS()) {
			fileInputRef.current?.click()
			return
		}
		const unsupported = captureSupportError()
		if (unsupported) {
			setErrorKind(unsupported)
			setStatus('error')
			return
		}
		const attempt = ++captureAttemptRef.current
		setStatus('loading')
		try {
			const settings = getSettings()
			const videoConstraints = {
				facingMode: 'user',
				...(settings.videoQuality === 'high'
					? { width: { ideal: 1280 }, height: { ideal: 720 } }
					: { width: { ideal: 854 }, height: { ideal: 480 } }),
				aspectRatio: 16 / 9,
			}
			let stream: MediaStream
			try {
				stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true })
			} catch (error) {
				if (captureAttemptRef.current !== attempt) return
				if (classifyCaptureError(error) !== 'overconstrained') throw error
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: 'user' },
					audio: true,
				})
			}
			if (captureAttemptRef.current !== attempt) {
				stopStreamTracks(stream)
				return
			}
			streamRef.current = stream
			// Display preview.
			if (videoRef.current) {
				videoRef.current.srcObject = stream
				await videoRef.current
					.play()
					.catch((error) => console.error('Error playing video preview:', error))
			}
			if (captureAttemptRef.current !== attempt) return
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
			const recorder = new MediaRecorder(stream, {
				mimeType: supportedVideoMimeType,
				videoBitsPerSecond: settings.videoQuality === 'high' ? 2500000 : 1000000,
			})
			mediaRecorderRef.current = recorder
			chunksRef.current = []
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
				clock.pause()
				setStatus('finishing')
				const interruption = interruptionRef.current
				const action = interruption ? 'attach' : stopActionRef.current
				void (async () => {
					try {
						const raw = new Blob(chunksRef.current, {
							type: chunksRef.current[0]?.type ?? recorder.mimeType,
						})
						if (raw.size === 0) {
							setErrorKind(interruption === 'ended' ? 'disconnected-empty' : 'empty')
							setStatus('error')
							return
						}
						const take = await finalizeRecording(raw)
						if (mediaRecorderRef.current !== recorder) return
						// No preview URL here: the parent closes the dialog in this same update, so this
						// component unmounts before an effect could revoke one. MediaPreview shows the take.
						if (interruption) toast.info(interruptionToast(interruption, 'camera'))
						onVideoCaptured(take, action)
						setStatus('idle')
					} catch (error) {
						console.error('Error processing video recording:', error)
						if (mediaRecorderRef.current !== recorder) return
						setErrorKind('processing')
						setStatus('error')
					} finally {
						if (mediaRecorderRef.current === recorder && videoRef.current)
							videoRef.current.srcObject = null
					}
				})()
			}
			recorder.start()
			clock.start()
			setStatus('recording')
		} catch (error) {
			if (captureAttemptRef.current !== attempt) return
			console.error('Error accessing camera/microphone:', error)
			unwatchRef.current?.()
			unwatchRef.current = null
			stopStreamTracks(streamRef.current)
			streamRef.current = null
			if (videoRef.current) videoRef.current.srcObject = null
			setErrorKind(classifyCaptureError(error))
			setStatus('error')
		}
	}
	const stopRecording = (action: CaptureAction) => {
		if (mediaRecorderRef.current && status === 'recording') {
			stopActionRef.current = action
			clock.pause()
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

	const previewVisible = status === 'recording' || status === 'finishing'
	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 flex flex-col">
				<div
					className={`relative w-full max-w-[320px] mx-auto min-h-[180px] bg-black rounded-md overflow-hidden ${status === 'error' ? '' : 'aspect-video'}`}
				>
					<video
						ref={videoRef}
						className={`w-full h-full ${previewVisible ? 'object-cover' : 'hidden'}`}
						autoPlay={status === 'recording'}
						muted
						loop={false}
						playsInline
						style={{ transform: 'scaleX(-1)' }}
					/>
					{status === 'idle' && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
							<Video className="h-12 w-12 opacity-50" />
							<Button type="button" onClick={startRecording} disabled={disabled}>
								<Video className="h-5 w-5" />
								Start recording
							</Button>
						</div>
					)}
					{status === 'loading' && (
						<div className="absolute inset-0 flex items-center justify-center gap-2 text-white/80">
							<Loader2 className="h-5 w-5 animate-spin" />
							<span>Initializing camera...</span>
						</div>
					)}
					{status === 'error' && errorKind && (
						<div className="relative flex min-h-[180px] flex-col items-center justify-center gap-3 p-4 text-center">
							<span className="text-sm text-white/80">
								{captureErrorMessage(errorKind, 'camera')}
							</span>
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
									<Video className="h-5 w-5" />
									Try again
								</Button>
							)}
							{onUploadInstead && (
								<Button
									type="button"
									variant="ghost"
									className="text-white/80"
									onClick={onUploadInstead}
								>
									Upload a file instead
								</Button>
							)}
						</div>
					)}
				</div>
			</div>
			{previewVisible && (
				<div className="flex flex-col items-center justify-center gap-4 mt-4 pb-4">
					<div className="flex flex-col items-center justify-center gap-2">
						<div className="flex items-center gap-2 text-sm text-primary">
							{status === 'finishing' ? (
								<Loader2 className="h-5 w-5 animate-spin" />
							) : (
								<div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
							)}
							<span>
								{status === 'finishing'
									? 'Finishing recording...'
									: deviceMuted
										? 'Camera paused by your device'
										: 'Recording video...'}
							</span>
						</div>
						<div className="text-2xl font-mono font-bold tabular-nums text-primary">
							{formatRecordingTime(clock.seconds)}
						</div>
					</div>
					{status === 'recording' && (
						<div className="flex justify-center gap-3">
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
						</div>
					)}
				</div>
			)}
			<input
				ref={fileInputRef}
				type="file"
				accept="video/*"
				capture="user"
				className="hidden"
				onChange={handleFileChange}
				disabled={disabled}
			/>
		</div>
	)
}
export default VideoRecorder
