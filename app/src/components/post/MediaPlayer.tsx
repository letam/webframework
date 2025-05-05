import type React from 'react'
import { useState, useRef, useEffect } from 'react'
import { Play, Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AudioPlayerProps {
	audioUrl: string
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioUrl }) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const audioRef = useRef<HTMLAudioElement | null>(null)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when audioUrl changes
	useEffect(() => {
		setIsPlaying(false)
		const player = audioRef.current

		return () => {
			if (player) {
				player.pause()
			}
		}
	}, [audioUrl])

	const togglePlayback = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause()
				setIsPlaying(false)
			} else {
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
					})
					.catch((error) => {
						console.error('Audio playback error:', error)
						setIsPlaying(false)
					})
			}
		}
	}

	const handleEnded = () => {
		setIsPlaying(false)
	}

	return (
		<div className="mt-4 bg-accent/10 rounded-md p-3">
			<div className="flex items-center gap-3">
				<Button
					type="button"
					variant="outline"
					size="icon"
					onClick={togglePlayback}
					className="h-10 w-10 rounded-full"
				>
					{isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
				</Button>

				<div className="grow">
					<div className="h-1 bg-primary/20 rounded-full">
						<div
							className="h-full bg-primary rounded-full"
							style={{
								width: isPlaying ? '100%' : '0',
								transition: 'width linear 0.1s',
							}}
						/>
					</div>
				</div>

				<audio ref={audioRef} src={audioUrl} onEnded={handleEnded} preload="metadata">
					<track kind="captions" label="English" />
				</audio>
			</div>
		</div>
	)
}

interface VideoPlayerProps {
	videoUrl: string
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ videoUrl }) => {
	const [isPlaying, setIsPlaying] = useState(false)
	const videoRef = useRef<HTMLVideoElement | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when videoUrl changes
	useEffect(() => {
		setIsPlaying(false)
		setError(null)
		setIsLoading(true)
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
		setError(null)
	}

	const togglePlayback = () => {
		if (videoRef.current) {
			if (isPlaying) {
				videoRef.current.pause()
				setIsPlaying(false)
			} else {
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

	const videoType = videoUrl.split('.').pop()

	return (
		<div className="mt-4 relative rounded-md overflow-hidden">
			<video
				ref={videoRef}
				className="w-full rounded-md"
				onEnded={handleEnded}
				onError={handleError}
				onLoadedMetadata={handleLoadedMetadata}
				preload="metadata"
				controls={isPlaying}
			>
				<source src={videoUrl} type={`video/${videoType}`} />
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
