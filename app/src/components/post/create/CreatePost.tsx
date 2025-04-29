import type React from 'react'
import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/sonner'
import TextPostTab from './TextPostTab'
import AudioPostTab from './AudioPostTab'
import VideoPostTab from './VideoPostTab'
import MediaPreview from './MediaPreview'

interface CreatePostProps {
	onPostCreated: (post: {
		id: string
		text: string
		mediaType?: 'audio' | 'video'
		mediaUrl?: string
		timestamp: Date
		username: string
		userAvatar: string
		likes: number
	}) => void
}

const CreatePost: React.FC<CreatePostProps> = ({ onPostCreated }) => {
	const [postText, setPostText] = useState('')
	const [mediaType, setMediaType] = useState<'text' | 'audio' | 'video'>('text')
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
	const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
	const [audioFile, setAudioFile] = useState<File | null>(null)
	const [videoFile, setVideoFile] = useState<File | null>(null)

	const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setPostText(e.target.value)
	}

	const handleAudioCaptured = (blob: Blob) => {
		setAudioBlob(blob)
		setMediaType('audio')
	}

	const handleVideoCaptured = (blob: Blob) => {
		setVideoBlob(blob)
		setVideoFile(null) // Clear uploaded video file
		setMediaType('video')
	}

	const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file?.type.startsWith('audio/')) {
			setAudioFile(file)
			setAudioBlob(null) // Clear recorded audio
			setMediaType('audio')
		} else if (file) {
			toast.error('Please select a valid audio file')
		}
	}

	const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file?.type.startsWith('video/')) {
			setVideoFile(file)
			setVideoBlob(null) // Clear recorded video
			setMediaType('video')
		} else if (file) {
			toast.error('Please select a valid video file')
		}
	}

	const clearMedia = () => {
		setAudioBlob(null)
		setVideoBlob(null)
		setAudioFile(null)
		setVideoFile(null)
		setMediaType('text')
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!postText.trim() && !audioBlob && !audioFile && !videoBlob && !videoFile) {
			toast.error('Please enter some text or add media')
			return
		}

		let mediaUrl = ''
		let finalMediaType: 'audio' | 'video' | undefined

		// In a real app, we would upload the blob to a server and get a URL back
		// For this demo, we'll create object URLs
		if (mediaType === 'audio' && (audioBlob || audioFile)) {
			const blob = audioFile || audioBlob
			if (blob) {
				mediaUrl = URL.createObjectURL(blob)
				finalMediaType = 'audio'
			}
		} else if (mediaType === 'video' && (videoBlob || videoFile)) {
			const blob = videoFile || videoBlob
			if (blob) {
				mediaUrl = URL.createObjectURL(blob)
				finalMediaType = 'video'
			}
		}

		// Create the post
		const newPost = {
			id: Date.now().toString(),
			text: postText,
			mediaType: finalMediaType,
			mediaUrl: mediaUrl || undefined,
			timestamp: new Date(),
			username: 'user1',
			userAvatar: 'https://ui-avatars.com/api/?name=User&background=7c3aed&color=fff',
			likes: 0,
		}

		onPostCreated(newPost)

		// Reset form
		setPostText('')
		setAudioBlob(null)
		setVideoBlob(null)
		setAudioFile(null)
		setVideoFile(null)
		setMediaType('text')

		toast.success('Post created successfully!')
	}

	return (
		<div className="bg-card rounded-lg shadow-xs p-4 border">
			<form onSubmit={handleSubmit}>
				<Textarea
					placeholder="What's happening?"
					value={postText}
					onChange={handlePostTextChange}
					className="w-full resize-none mb-4 border-none focus-visible:ring-0 py-2 px-3 text-base"
				/>

				<MediaPreview
					mediaType={mediaType}
					audioBlob={audioBlob}
					audioFile={audioFile}
					videoBlob={videoBlob}
					videoFile={videoFile}
					onClearMedia={clearMedia}
				/>

				<Tabs defaultValue="text" value={mediaType} className="mt-2">
					<TabsList className="grid w-full grid-cols-3 mb-4">
						<TabsTrigger value="text" onClick={() => setMediaType('text')}>
							Text
						</TabsTrigger>
						<TabsTrigger value="audio" onClick={() => setMediaType('audio')}>
							Audio
						</TabsTrigger>
						<TabsTrigger value="video" onClick={() => setMediaType('video')}>
							Video
						</TabsTrigger>
					</TabsList>

					<TabsContent value="text">
						<TextPostTab onSubmit={() => {}} />
					</TabsContent>

					<TabsContent value="audio">
						<AudioPostTab
							onAudioCaptured={handleAudioCaptured}
							onAudioFileChange={handleAudioFileChange}
							onSubmit={() => {}}
						/>
					</TabsContent>

					<TabsContent value="video">
						<VideoPostTab
							onVideoCaptured={handleVideoCaptured}
							onVideoFileChange={handleVideoFileChange}
							onSubmit={() => {}}
						/>
					</TabsContent>
				</Tabs>
			</form>
		</div>
	)
}

export default CreatePost
