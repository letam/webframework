import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isDesktop, isFirefox } from '@/lib/utils/browser'
import { cn } from '@/lib/utils'

interface AudioControlsProps {
	isPlaying: boolean
	duration: number
	currentTime: number
	onPlayPause: () => void
	onSeek: (time: number) => void
	disabled?: boolean
	waveform?: number[] | null
}

const formatTime = (timeInSeconds: number): string => {
	const minutes = Math.floor(timeInSeconds / 60)
	const seconds = Math.floor(timeInSeconds % 60)
	return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const getWaveformSeekTime = (
	clientX: number,
	rectLeft: number,
	rectWidth: number,
	duration: number
): number => {
	if (rectWidth <= 0 || duration <= 0) {
		return 0
	}

	const percentage = Math.min(1, Math.max(0, (clientX - rectLeft) / rectWidth))
	return percentage * duration
}

const getProgressPercent = (currentTime: number, duration: number) => {
	if (duration <= 0) {
		return 0
	}
	return Math.min(100, Math.max(0, (currentTime / duration) * 100))
}

interface WaveformSeekBarProps {
	waveform: number[]
	duration: number
	currentTime: number
	onPlayPause: () => void
	onSeek: (time: number) => void
	disabled: boolean
}

const WaveformSeekBar: React.FC<WaveformSeekBarProps> = ({
	waveform,
	duration,
	currentTime,
	onPlayPause,
	onSeek,
	disabled,
}) => {
	const draggingRef = useRef(false)
	const progressPercent = getProgressPercent(currentTime, duration)

	const seekFromPointer = (clientX: number, element: HTMLElement) => {
		const rect = element.getBoundingClientRect()
		onSeek(getWaveformSeekTime(clientX, rect.left, rect.width, duration))
	}

	const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
		if (disabled) {
			return
		}
		draggingRef.current = true
		e.currentTarget.setPointerCapture?.(e.pointerId)
		seekFromPointer(e.clientX, e.currentTarget)
	}

	const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
		if (!draggingRef.current || disabled) {
			return
		}
		seekFromPointer(e.clientX, e.currentTarget)
	}

	const stopDragging = (e: React.PointerEvent<HTMLDivElement>) => {
		draggingRef.current = false
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId)
		}
	}

	return (
		<div
			className={cn(
				'flex h-12 flex-1 items-center gap-px rounded-md px-1',
				disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
			)}
			onPointerDown={handlePointerDown}
			onPointerMove={handlePointerMove}
			onPointerUp={stopDragging}
			onPointerCancel={stopDragging}
			onKeyDown={(e) => {
				if (e.key === ' ') {
					e.preventDefault()
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
			tabIndex={disabled ? -1 : 0}
			aria-label="Audio waveform progress"
			aria-valuemin={0}
			aria-valuemax={duration}
			aria-valuenow={currentTime}
		>
			{waveform.map((peak, index) => {
				const safePeak = Math.min(100, Math.max(0, peak))
				const height = Math.max(4, Math.round((safePeak / 100) * 44))
				const barPosition = waveform.length <= 1 ? 0 : (index / (waveform.length - 1)) * 100
				const isPlayed = barPosition <= progressPercent

				return (
					<div
						key={`${index}-${peak}`}
						className={cn(
							'pointer-events-none min-w-[1.5px] flex-1 rounded-[1.5px] motion-safe:transition-colors motion-safe:duration-100',
							isPlayed ? 'bg-gradient-to-t from-brand-1 to-brand-2' : 'bg-muted-foreground/30'
						)}
						style={{ height: `${height}px` }}
					/>
				)
			})}
		</div>
	)
}

export const AudioControls: React.FC<AudioControlsProps> = ({
	isPlaying,
	duration,
	currentTime,
	onPlayPause,
	onSeek,
	disabled = false,
	waveform,
}) => {
	const progressPercent = getProgressPercent(currentTime, duration)

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
				{waveform?.length ? (
					<WaveformSeekBar
						waveform={waveform}
						duration={duration}
						currentTime={currentTime}
						onPlayPause={onPlayPause}
						onSeek={onSeek}
						disabled={disabled}
					/>
				) : (
					<div
						className="relative h-1 flex-1 cursor-pointer overflow-hidden rounded-full bg-secondary"
						onClick={(e) => {
							const rect = e.currentTarget.getBoundingClientRect()
							onSeek(getWaveformSeekTime(e.clientX, rect.left, rect.width, duration))
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
							className="h-full bg-primary motion-safe:transition-all motion-safe:duration-100"
							style={{ width: `${progressPercent}%` }}
						/>
					</div>
				)}
				<span className="text-xs text-muted-foreground">{formatTime(duration)}</span>
			</div>
		</div>
	)
}

interface AudioPlayerProps {
	audioUrl: string
	duration?: number
	waveform?: number[] | null
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
	audioUrl,
	duration: initialDuration,
	waveform,
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
		const safeSeconds = Number.isFinite(seconds) ? seconds : 0
		const nextTime = Math.max(0, Math.min(safeSeconds, duration))
		if (audioRef.current) {
			audioRef.current.currentTime = nextTime
		}
		setCurrentTime(nextTime)
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
				isPlaying={isPlaying}
				duration={duration}
				currentTime={currentTime}
				onPlayPause={togglePlayback}
				onSeek={seekAudio}
				disabled={isLoading}
				waveform={waveform}
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
	thumbnail?: string | null
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoUrl, thumbnail }) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(false)
	const [isLoaded, setIsLoaded] = useState(false)
	const videoBlobRef = useRef<Blob | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when videoUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(false)
		setIsLoaded(false)
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
		<div className="relative mt-4 overflow-hidden rounded-md bg-black">
			<video
				ref={videoRef}
				className="aspect-video w-full rounded-md bg-black object-contain"
				onEnded={handleEnded}
				onError={handleError}
				onLoadedMetadata={handleLoadedMetadata}
				controls={isPlaying}
				poster={thumbnail || undefined}
				preload={thumbnail ? 'none' : 'metadata'}
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
