import { useState, useRef, useEffect } from 'react'
import { Video, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { supportedVideoMimeType } from '@/lib/utils/media'
import { isIOS } from '@/lib/utils/browser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSettings } from '@/lib/utils/settings'
import { assembleRecording, fixRecordingDuration } from '@/lib/utils/webmDuration'

interface VideoRecorderModalProps {
	onVideoCaptured: (videoBlob: Blob) => void
	open: boolean
	onOpenChange: (open: boolean) => void
}

export const VideoRecorderModal: React.FC<VideoRecorderModalProps> = ({
	onVideoCaptured,
	open,
	onOpenChange,
}) => {
	const [isRecording, setIsRecording] = useState(false)
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[425px] h-[420px] flex flex-col"
				// Same guard as the audio recorder: a stray tap outside mid-take must not
				// discard it, while Escape and the close button still close.
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
					<VideoRecorder
						onVideoCaptured={onVideoCaptured}
						onRecordingChange={setIsRecording}
						onCancel={() => onOpenChange(false)}
						autoStart={true}
					/>
				</div>
			</DialogContent>
		</Dialog>
	)
}

const formatTime = (seconds: number): string => {
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

// Map a getUserMedia rejection to a message that tells the user what to fix.
const cameraErrorMessage = (error: unknown): string => {
	if (error instanceof DOMException) {
		if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
			return 'Camera access was blocked. Allow it in your browser settings, then try again.'
		}
		if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
			return 'No camera was found. Connect one and try again.'
		}
		if (error.name === 'NotReadableError') {
			return 'Your camera is in use by another app. Close it and try again.'
		}
	}
	return 'Unable to access camera or microphone. Please check permissions and try again.'
}

interface VideoRecorderProps {
	onVideoCaptured: (videoBlob: Blob) => void
	disabled?: boolean
	autoStart?: boolean
	/** Reports whether a take is in progress, from start until its blob is finalized. */
	onRecordingChange?: (recording: boolean) => void
	/** Called when the user dismisses the native camera (iOS) without recording. */
	onCancel?: () => void
}

const VideoRecorder = ({
	onVideoCaptured,
	onRecordingChange,
	onCancel,
	disabled,
	autoStart = false,
}: VideoRecorderProps) => {
	const [isRecording, setIsRecording] = useState(false)
	// Stop is clicked -> the recorder's final chunk and onstop processing still run.
	// The take isn't safe to discard until that finishes.
	const [isFinalizing, setIsFinalizing] = useState(false)
	const [videoURL, setVideoURL] = useState<string | null>(null)
	const [recordingTime, setRecordingTime] = useState<number>(0)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const videoChunksRef = useRef<Blob[]>([])
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
	// Auto-start at most once per mount so a failed getUserMedia can't retry in a loop.
	const hasAutoStartedRef = useRef(false)

	const isBusy = isRecording || isFinalizing
	useEffect(() => {
		onRecordingChange?.(isBusy)
	}, [isBusy, onRecordingChange])

	// On iOS the recorder hands off to the native camera via the hidden file input.
	// Dismissing that camera fires `cancel` (not `change`), which left the dialog
	// open on an empty video placeholder with no controls. Treat it as cancelling
	// the recording. React doesn't wire `onCancel` on inputs, so listen directly.
	useEffect(() => {
		const input = fileInputRef.current
		if (!input || !onCancel) return
		input.addEventListener('cancel', onCancel)
		return () => input.removeEventListener('cancel', onCancel)
	}, [onCancel])

	// biome-ignore lint/correctness/useExhaustiveDependencies: auto-start should only respond to the external trigger and current recording state
	useEffect(() => {
		if (autoStart && !isRecording && !videoURL && !hasAutoStartedRef.current) {
			hasAutoStartedRef.current = true
			startRecording()
		}
	}, [autoStart, isRecording, videoURL])

	// biome-ignore lint/correctness/useExhaustiveDependencies: cleanup should only run when this recorder unmounts
	useEffect(() => {
		return () => {
			reset()
		}
	}, [])

	// Revoking the object URL lives here, not in `reset`. The unmount cleanup above
	// captures render 1's `reset`, whose `videoURL` is still null, so a revoke from
	// there never ran and the recorded blob stayed pinned for the tab's lifetime.
	// Everything else `reset` touches is a ref, which is always current. Keying on
	// the URL also releases a take that a re-record or a second file pick replaced.
	useEffect(() => {
		if (!videoURL) return
		return () => URL.revokeObjectURL(videoURL)
	}, [videoURL])

	const reset = () => {
		setIsRecording(false)
		setIsFinalizing(false)
		setRecordingTime(0)
		setErrorMessage(null)
		// Dropping the URL from state is what revokes it; see the effect above.
		setVideoURL(null)
		videoChunksRef.current = []
		const recorder = mediaRecorderRef.current
		if (recorder) {
			// Detach handlers first so stopping below can't fire an onstop that calls
			// back after we've torn down (e.g. on unmount).
			recorder.ondataavailable = null
			recorder.onstop = null
			if (recorder.state !== 'inactive') {
				recorder.stop()
			}
			mediaRecorderRef.current = null
		}
		if (streamRef.current) {
			// Release the camera + mic: without this, closing the modal mid-record
			// leaves the browser's recording indicator on and the devices hot.
			for (const track of streamRef.current.getTracks()) {
				track.stop()
			}
			streamRef.current = null
		}
		if (videoRef.current) {
			videoRef.current.srcObject = null
		}
		if (timerRef.current) {
			clearInterval(timerRef.current)
			timerRef.current = undefined
		}
	}

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		try {
			const videoUrl = URL.createObjectURL(file)
			setVideoURL(videoUrl)
			onVideoCaptured(file)
		} catch (error) {
			console.error('Error processing video file:', error)
			toast.error('Error processing video file')
		}
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
		}
	}

	const startRecording = async () => {
		if (disabled) return

		// On iOS, use native camera input
		if (isIOS()) {
			fileInputRef.current?.click()
			return
		}

		try {
			setErrorMessage(null)
			const settings = getSettings()
			const videoConstraints = {
				facingMode: 'user',
				...(settings.videoQuality === 'high'
					? {
							width: { ideal: 1280 },
							height: { ideal: 720 },
						}
					: {
							width: { ideal: 854 },
							height: { ideal: 480 },
						}),
				aspectRatio: 16 / 9,
			}

			const stream = await navigator.mediaDevices.getUserMedia({
				video: videoConstraints,
				audio: true,
			})
			streamRef.current = stream

			// Display preview
			if (videoRef.current) {
				videoRef.current.srcObject = stream
				// Ensure the video starts playing
				await videoRef.current.play().catch((error) => {
					console.error('Error playing video preview:', error)
				})
			}

			const mediaRecorder = new MediaRecorder(stream, {
				mimeType: supportedVideoMimeType,
				videoBitsPerSecond: settings.videoQuality === 'high' ? 2500000 : 1000000, // 2.5 Mbps for high, 1 Mbps for low
			})
			mediaRecorderRef.current = mediaRecorder
			videoChunksRef.current = []

			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					videoChunksRef.current.push(e.data)
				}
			}

			mediaRecorder.onstop = () => {
				stopTimer()
				;(async () => {
					try {
						const videoBlob = await fixRecordingDuration(assembleRecording(videoChunksRef.current))
						const videoUrl = URL.createObjectURL(videoBlob)
						setVideoURL(videoUrl)
						onVideoCaptured(videoBlob)
					} catch (error) {
						// Without this, a failed duration-fix or dynamic import rejects unhandled
						// and the recording vanishes with no feedback (mirrors AudioRecorder.onstop).
						console.error('Error processing video recording:', error)
						toast.error('Error processing video recording')
					} finally {
						setIsFinalizing(false)
						// Remove preview on success or failure so a dead live stream isn't left attached.
						if (videoRef.current) {
							videoRef.current.srcObject = null
						}
					}
				})()
			}

			mediaRecorder.start()
			startTimer({ reset: true })
			setIsRecording(true)
		} catch (error) {
			const message = cameraErrorMessage(error)
			console.error('Error accessing camera/microphone:', error)
			toast.error(message)
			setErrorMessage(message)
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
			setIsFinalizing(true)
			mediaRecorderRef.current.stop()
			// Stop all tracks
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop()
				}
			}
			setIsRecording(false)
		}
	}

	return (
		<div className="flex flex-col h-full">
			<div className="flex-1 flex flex-col">
				<div className="relative w-full max-w-[320px] mx-auto aspect-video bg-black rounded-md overflow-hidden">
					<video
						ref={videoRef}
						className={`w-full h-full ${isRecording || videoURL ? 'object-cover' : 'hidden'}`}
						autoPlay={isRecording}
						muted={isRecording}
						loop={false}
						playsInline
						src={videoURL || undefined}
						style={{ transform: 'scaleX(-1)' }} // Mirror the video for selfie view
					/>
					{!isRecording && !videoURL && !errorMessage && (
						<div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
							<Video className="h-12 w-12 opacity-50" />
						</div>
					)}
					{!isRecording && !videoURL && errorMessage && (
						<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
							<span className="text-sm text-white/80">{errorMessage}</span>
							<Button type="button" variant="secondary" size="sm" onClick={startRecording}>
								<Video className="h-4 w-4" />
								<span>Try again</span>
							</Button>
						</div>
					)}
				</div>
			</div>

			{isRecording && (
				<div className="flex flex-col items-center justify-center gap-4 mt-4 pb-4">
					<div className="flex flex-col items-center justify-center gap-2">
						<div className="flex items-center gap-2 text-sm text-primary">
							<div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
							<span>Recording video...</span>
						</div>
						<div className="text-2xl font-mono font-bold text-primary">
							{formatTime(recordingTime)}
						</div>
					</div>
					<Button
						type="button"
						variant="destructive"
						size="lg"
						onClick={stopRecording}
						className="flex items-center gap-2 px-8 animate-pulse-gentle"
						disabled={disabled}
					>
						<Square className="h-5 w-5" />
						<span>Stop Recording</span>
					</Button>
				</div>
			)}

			{/* Hidden file input for iOS */}
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
