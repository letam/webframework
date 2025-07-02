import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isDesktop, isFirefox } from '@/lib/utils/browser'

interface AudioControlsProps {
	audioRef: React.RefObject<HTMLAudioElement>
	isPlaying: boolean
	duration: number
	currentTime: number
	onPlayPause: () => void
	onSeek: (time: number) => void
	disabled?: boolean
}

const formatTime = (timeInSeconds: number): string => {
	const minutes = Math.floor(timeInSeconds / 60)
	const seconds = Math.floor(timeInSeconds % 60)
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const AudioControls: React.FC<AudioControlsProps> = ({
	audioRef,
	isPlaying,
	duration,
	currentTime,
	onPlayPause,
	onSeek,
	disabled = false,
}) => {
	return (
		<div className="flex flex-col space-y-2">
			<div className="flex items-center justify-center space-x-2">
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={() => onSeek(currentTime - 5)}
					className="w-8 h-8 rounded-full"
					disabled={disabled}
				>
					<SkipBack className="h-4 w-4" />
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={onPlayPause}
					onKeyDown={(e) => {
						if (e.key === 'ArrowLeft') {
							e.preventDefault()
							onSeek(currentTime - 1)
						} else if (e.key === 'ArrowRight') {
							e.preventDefault()
							onSeek(currentTime + 1)
						} else if (e.key === 'Home') {
							e.preventDefault()
							onSeek(0)
						} else if (e.key === 'End') {
							e.preventDefault()
							onSeek(duration)
						}
					}}
					className="w-10 h-10 rounded-full"
					disabled={disabled}
				>
					{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
				</Button>
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={() => onSeek(currentTime + 5)}
					className="w-8 h-8 rounded-full"
					disabled={disabled}
				>
					<SkipForward className="h-4 w-4" />
				</Button>
			</div>

			<div className="flex items-center space-x-2">
				<span className="text-xs text-muted-foreground">{formatTime(currentTime)}</span>
				<div
					className="flex-1 h-1 bg-secondary rounded-full overflow-hidden cursor-pointer relative"
					onClick={(e) => {
						const rect = e.currentTarget.getBoundingClientRect()
						const clickPosition = e.clientX - rect.left
						const percentage = clickPosition / rect.width
						const newTime = percentage * duration
						onSeek(newTime)
					}}
					onKeyDown={(e) => {
						if (e.key === ' ') {
							e.preventDefault() // Prevent page scroll
							onPlayPause()
						} else if (e.key === 'ArrowLeft') {
							onSeek(currentTime - 1)
						} else if (e.key === 'ArrowRight') {
							onSeek(currentTime + 1)
						} else if (e.key === 'Home') {
							onSeek(0)
						} else if (e.key === 'End') {
							onSeek(duration)
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
	)
}

interface AudioPlayerProps {
	audioUrl: string
	mimeType: string
	duration?: number
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
	audioUrl,
	mimeType,
	duration: initialDuration,
}) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const [isLoading, setIsLoading] = useState(false)
	const [showLoading, setShowLoading] = useState(false)
	const [isLoaded, setIsLoaded] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [duration, setDuration] = useState<number>(initialDuration || 0)
	const [currentTime, setCurrentTime] = useState<number>(0)
	const audioRef = useRef<HTMLAudioElement | null>(null)
	const audioBlobRef = useRef<Blob | null>(null)
	const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const progressIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when audioUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(false)
		setShowLoading(false)
		setIsLoaded(false)
		setDuration(initialDuration || 0)
		setCurrentTime(0)
		audioBlobRef.current = null
		const player = audioRef.current

		return () => {
			if (player) {
				player.pause()
				player.removeAttribute('src')
				player.load()
			}
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
			if (progressIntervalRef.current) {
				clearInterval(progressIntervalRef.current)
			}
		}
	}, [audioUrl])

	useEffect(() => {
		if (isLoading) {
			loadingTimeoutRef.current = setTimeout(() => {
				setShowLoading(true)
			}, 500)
		} else {
			setShowLoading(false)
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
		}

		return () => {
			if (loadingTimeoutRef.current) {
				clearTimeout(loadingTimeoutRef.current)
			}
		}
	}, [isLoading])

	const loadAudio = async () => {
		if (audioBlobRef.current) {
			// Audio is already cached
			if (audioRef.current) {
				audioRef.current.src = URL.createObjectURL(audioBlobRef.current)
			}
			return
		}

		setIsLoading(true)
		setError(null)

		try {
			const response = await fetch(audioUrl)
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			const blob = await response.blob()
			audioBlobRef.current = blob

			if (audioRef.current) {
				audioRef.current.src = URL.createObjectURL(blob)
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to load audio'
			setError(`Failed to load audio: ${errorMessage}`)
			setIsLoading(false)
		}
	}

	const handleError = (e: React.SyntheticEvent<HTMLAudioElement, Event>) => {
		const audio = e.target as HTMLAudioElement
		const error = audio.error
		if (error) {
			let errorMessage = 'Audio playback error: '
			switch (error.code) {
				case MediaError.MEDIA_ERR_ABORTED:
					errorMessage += 'Playback was interrupted. Please try again.'
					break
				case MediaError.MEDIA_ERR_NETWORK:
					errorMessage += 'A network error occurred. Please check your connection.'
					break
				case MediaError.MEDIA_ERR_DECODE:
					errorMessage += 'The audio format is not supported by your browser.'
					break
				case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMessage += 'The audio source is not supported.'
					break
				default:
					errorMessage += 'An unknown error occurred.'
			}
			setError(errorMessage)
			setIsLoading(false)
			console.error('Audio error details:', error)
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
			// Use the provided duration if available, otherwise use the audio element's duration
			const audioDuration = initialDuration || audioRef.current.duration
			// Add a small buffer to the duration to prevent early cutoff
			setDuration(audioDuration + 0.1)
		}
		setIsLoading(false)
		setIsLoaded(true)
		setError(null)
	}

	const seekAudio = (seconds: number) => {
		if (audioRef.current) {
			audioRef.current.currentTime = Math.max(0, Math.min(seconds, duration))
		}
	}

	const togglePlayback = async () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
				setIsPlaying(false)
				if (progressIntervalRef.current) {
					clearInterval(progressIntervalRef.current)
				}
			} else {
				const isAutoplayDisabled = isDesktop() && isFirefox() // TODO: get value directly from browser API

				if (!isLoaded && !isAutoplayDisabled) {
					await loadAudio()
				}

				// Reset all other audio playback first
				for (const audio of document.querySelectorAll('audio')) {
					if (audio !== audioRef.current) {
						audio.pause()
					}
				}

				// Play this audio
				audioRef.current
					.play()
					.then(() => {
						setIsPlaying(true)
						setError(null)
						// Use a shorter interval for smoother progress updates
						progressIntervalRef.current = setInterval(handleTimeUpdate, 50)
					})
					.catch((error) => {
						console.error('Audio playback error:', error)
						setIsPlaying(false)
						setError(`Failed to play audio: ${error.message}`)
					})

				if (!isLoaded && isAutoplayDisabled) {
					await loadAudio()
				}
			}
		}
	}

	const handleEnded = () => {
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

	return (
		<div className="mt-4 bg-accent/10 rounded-md p-3 relative">
			<AudioControls
				audioRef={audioRef}
				isPlaying={isPlaying}
				duration={duration}
				currentTime={currentTime}
				onPlayPause={togglePlayback}
				onSeek={seekAudio}
				disabled={isLoading}
			/>

			<audio
				ref={audioRef}
				onEnded={handleEnded}
				onError={handleError}
				onLoadedMetadata={handleLoadedMetadata}
				onTimeUpdate={handleTimeUpdate}
				preload="none"
			>
				<track kind="captions" label="English" />
			</audio>

			{showLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
					<div className="text-sm text-muted-foreground">Loading audio...</div>
				</div>
			)}

			{error && (
				<div className="absolute inset-0 flex items-center justify-center bg-accent/10 backdrop-blur-sm">
					<div className="text-sm text-destructive text-center p-4">
						<p>{error}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setError(null)
								setIsLoading(true)
								setIsLoaded(false)
								audioBlobRef.current = null
								if (audioRef.current) {
									audioRef.current.load()
								}
							}}
							className="mt-2"
						>
							Try Again
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}

interface VideoPlayerProps {
	videoUrl: string
	mimeType: string
	duration?: number
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
	videoUrl,
	mimeType,
	duration: initialDuration,
}) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [isLoaded, setIsLoaded] = useState(false)
	const [duration, setDuration] = useState<number>(initialDuration || 0)
	const videoBlobRef = useRef<Blob | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when videoUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(false)
		setIsLoaded(false)
		setDuration(initialDuration || 0)
		videoBlobRef.current = null
		const player = videoRef.current

		// Cleanup function
		return () => {
			if (player) {
				player.pause()
				player.removeAttribute('src')
				player.load()
			}
		}
	}, [videoUrl])

	const loadVideo = async () => {
		if (videoBlobRef.current) {
			// Video is already cached
			if (videoRef.current) {
				videoRef.current.src = URL.createObjectURL(videoBlobRef.current)
			}
			return
		}

		setIsLoading(true)
		setError(null)

		try {
			const response = await fetch(videoUrl)
			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`)
			}
			const blob = await response.blob()
			videoBlobRef.current = blob

			if (videoRef.current) {
				videoRef.current.src = URL.createObjectURL(blob)
			}
		} catch (err) {
			const errorMessage = err instanceof Error ? err.message : 'Failed to load video'
			setError(`Failed to load video: ${errorMessage}`)
			setIsLoading(false)
		}
	}

	const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
		const video = e.target as HTMLVideoElement
		const error = video.error
		if (error) {
			let errorMessage = 'Video playback error: '
			switch (error.code) {
				case MediaError.MEDIA_ERR_ABORTED:
					errorMessage += 'Playback was interrupted. Please try again.'
					break
				case MediaError.MEDIA_ERR_NETWORK:
					errorMessage += 'A network error occurred. Please check your connection.'
					break
				case MediaError.MEDIA_ERR_DECODE:
					errorMessage += 'The video format is not supported by your browser.'
					break
				case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMessage += 'The video source is not supported.'
					break
				default:
					errorMessage += 'An unknown error occurred.'
			}
			setError(errorMessage)
			setIsLoading(false)
			console.error('Video error details:', error)
		}
	}

	const handleLoadedMetadata = () => {
		if (videoRef.current) {
			// Use the provided duration if available, otherwise use the video element's duration
			const videoDuration = initialDuration || videoRef.current.duration
			setDuration(videoDuration)
		}
		setIsLoading(false)
		setIsLoaded(true)
		setError(null)
	}

	const togglePlayback = async () => {
		if (videoRef.current) {
			if (isPlaying) {
				videoRef.current.pause()
				setIsPlaying(false)
			} else {
				if (!isLoaded) {
					await loadVideo()
				}

				// Reset all other video playback first
				for (const video of document.querySelectorAll('video')) {
					if (video !== videoRef.current) {
						video.pause()
					}
				}

				// Play this video
				videoRef.current
					.play()
					.then(() => {
						setIsPlaying(true)
						setError(null)
					})
					.catch((error) => {
						console.error('Video playback error:', error)
						setIsPlaying(false)
						setError(`Failed to play video: ${error.message}`)
					})
			}
		}
	}

	const handleEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="mt-4 relative rounded-md overflow-hidden">
			<video
				ref={videoRef}
				className="w-full rounded-md"
				onEnded={handleEnded}
				onError={handleError}
				onLoadedMetadata={handleLoadedMetadata}
				controls={isPlaying}
			>
				<track kind="captions" label="English" />
				Your browser does not support the video tag.
			</video>

			{isLoading && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
					Loading video...
				</div>
			)}

			{!isPlaying && !isLoading && !error && (
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={togglePlayback}
					className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-primary/80 hover:bg-primary"
				>
					<Play className="h-6 w-6 text-white" />
				</Button>
			)}

			{error && (
				<div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white p-4 text-center">
					<div>
						<p>{error}</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => {
								setError(null)
								setIsLoading(true)
								setIsLoaded(false)
								videoBlobRef.current = null
								if (videoRef.current) {
									videoRef.current.load()
								}
							}}
							className="mt-2"
						>
							Try Again
						</Button>
					</div>
				</div>
			)}
		</div>
	)
}
