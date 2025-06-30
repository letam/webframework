import { useState, useRef, forwardRef, useImperativeHandle, useEffect } from 'react'
import { Video, Square, Play, Pause } from 'lucide-react'
import fixWebmDuration from 'webm-duration-fix'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'
import { supportedVideoMimeType } from '@/lib/utils/media'
import { isIOS } from '@/lib/utils/browser'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getSettings } from '@/lib/utils/settings'

export interface VideoRecorderRef {
	reset: () => void
}

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
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px] h-[420px] flex flex-col">
				<DialogHeader className="text-center py-2">
					<DialogTitle className="flex items-center justify-center gap-2">
						<Video className="h-5 w-5" />
						Record Video
					</DialogTitle>
				</DialogHeader>
				<div className="flex-1 flex flex-col">
					<VideoRecorder onVideoCaptured={onVideoCaptured} autoStart={true} />
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

const VideoRecorder = forwardRef<
	VideoRecorderRef,
	{
		onVideoCaptured: (videoBlob: Blob) => void
		disabled?: boolean
		autoStart?: boolean
	}
>(({ onVideoCaptured, disabled, autoStart = false }, ref) => {
	const [isRecording, setIsRecording] = useState(false)
	const [videoURL, setVideoURL] = useState<string | null>(null)
	const [isPlaying, setIsPlaying] = useState(false)
	const [recordingTime, setRecordingTime] = useState<number>(0)
	const mediaRecorderRef = useRef<MediaRecorder | null>(null)
	const videoChunksRef = useRef<Blob[]>([])
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const streamRef = useRef<MediaStream | null>(null)
	const fileInputRef = useRef<HTMLInputElement>(null)
	const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

	useEffect(() => {
		if (autoStart && !isRecording && !videoURL) {
			startRecording()
		}
	}, [autoStart, isRecording, videoURL])

	const reset = () => {
		setIsRecording(false)
		setRecordingTime(0)
		if (videoURL) {
			URL.revokeObjectURL(videoURL)
			setVideoURL(null)
		}
		setIsPlaying(false)
		videoChunksRef.current = []
		if (mediaRecorderRef.current) {
			mediaRecorderRef.current = null
		}
		if (streamRef.current) {
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

	useImperativeHandle(ref, () => ({
		reset,
	}))

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
					const videoBlob = await fixWebmDuration(
						new Blob(videoChunksRef.current, { type: videoChunksRef.current[0]?.type })
					)
					const videoUrl = URL.createObjectURL(videoBlob)
					setVideoURL(videoUrl)
					onVideoCaptured(videoBlob)

					// Remove preview
					if (videoRef.current) {
						videoRef.current.srcObject = null
					}
				})()
			}

			mediaRecorder.start()
			startTimer({ reset: true })
			setIsRecording(true)
		} catch (error) {
			console.error('Error accessing camera/microphone:', error)
			toast.error('Unable to access camera or microphone. Please check permissions.')
		}
	}

	const stopRecording = () => {
		if (mediaRecorderRef.current && isRecording) {
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

	const togglePlayback = () => {
		if (videoRef.current && videoURL) {
			if (isPlaying) {
				videoRef.current.pause()
			} else {
				videoRef.current.play()
			}
			setIsPlaying(!isPlaying)
		}
	}

	const handlePlaybackEnded = () => {
		setIsPlaying(false)
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
						onEnded={handlePlaybackEnded}
						style={{ transform: 'scaleX(-1)' }} // Mirror the video for selfie view
					/>
					{!isRecording && !videoURL && (
						<div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
							<Video className="h-12 w-12 opacity-50" />
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
})

export default VideoRecorder
