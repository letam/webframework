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

	// biome-ignore lint/correctness/useExhaustiveDependencies: executed when videoUrl changes
	useEffect(() => {
		setIsPlaying(false)
		const player = videoRef.current

		return () => {
			if (player) {
				player.pause()
			}
		}
	}, [videoUrl])

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
					})
					.catch((error) => {
						console.error('Video playback error:', error)
						setIsPlaying(false)
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
				src={videoUrl}
				className="w-full rounded-md"
				onEnded={handleEnded}
				preload="metadata"
				controls={isPlaying}
			>
				<track kind="captions" label="English" />
			</video>

			{!isPlaying && (
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
		</div>
	)
}
