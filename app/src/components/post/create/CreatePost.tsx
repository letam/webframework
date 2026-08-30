import type React from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	Mic,
	Video,
	Image,
	Loader2,
	Upload,
	Globe,
	Link2,
	Lock,
	Bold,
	Italic,
	Cloud,
	CloudOff,
} from 'lucide-react'
import { AudioRecorderModal } from './AudioRecorder'
import { VideoRecorderModal } from './VideoRecorder'
import MediaPreview from './MediaPreview'
import type { CreatePostRequest, PostVisibility } from '@/types/post'
import { convertWavToWebM, getAudioExtension } from '@/lib/utils/audio'
import { getSettings } from '@/lib/utils/settings'
import { applyMarkdownShortcut, toggleMarker } from '@/lib/utils/richText'
import { modifierKeyLabel } from '@/lib/utils/browser'
import { useAuth } from '@/hooks/useAuth'
import { useOutbox } from '@/hooks/useOutbox'
import { useComposerDraft } from '@/hooks/useComposerDraft'
import type { ComposerDraft } from '@/lib/utils/composerDraft'
import { enqueuePost, MAX_QUEUED_MEDIA_BYTES, setSyncMode, type SyncMode } from '@/lib/outbox'
import { registerComposerLoader } from '@/lib/composerBridge'
import type { OutboxEntry } from '@/lib/utils/outboxDb'

interface CreatePostProps {
	onPostCreated: (post: CreatePostRequest) => Promise<void> | void
}

type SubmitStatus = '' | 'preparing' | 'compressing' | 'submitting'

const MEDIA_CAP_TOAST = `This file is too big to queue (${Math.round(
	MAX_QUEUED_MEDIA_BYTES / (1024 * 1024)
)} MB limit).`

const VISIBILITY_OPTIONS = [
	{
		value: 'public',
		label: 'Public',
		description: 'Anyone can see this post',
		icon: Globe,
	},
	{
		value: 'unlisted',
		label: 'Link only',
		description: 'Hidden from the feed; anyone with the link can see it',
		icon: Link2,
	},
	{
		value: 'private',
		label: 'Private',
		description: 'Only you can see this post',
		icon: Lock,
	},
] satisfies {
	value: PostVisibility
	label: string
	description: string
	icon: React.ComponentType<{ className?: string }>
}[]

const getMediaExtension = (mimeType: string, mediaType: 'audio' | 'video'): string => {
	if (mediaType === 'audio') {
		return getAudioExtension(mimeType)
	}
	const baseType = mimeType.split(';')[0] // Remove codec information
	return baseType === 'video/webm'
		? 'webm'
		: baseType === 'video/mp4'
			? 'mp4'
			: baseType === 'video/ogg'
				? 'ogg'
				: 'webm' // Default to webm as it's most widely supported
}

const CreatePost: React.FC<CreatePostProps> = ({ onPostCreated }) => {
	const { isAuthenticated, isAuthResolved, userId } = useAuth()
	const { syncMode } = useOutbox()
	const [postText, setPostText] = useState('')
	const [mediaType, setMediaType] = useState<'text' | 'audio' | 'video' | 'image'>('text')
	const [visibility, setVisibility] = useState<PostVisibility>('public')
	const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
	const [videoBlob, setVideoBlob] = useState<Blob | null>(null)
	const [audioFile, setAudioFile] = useState<File | null>(null)
	const [videoFile, setVideoFile] = useState<File | null>(null)
	const [imageFile, setImageFile] = useState<File | null>(null)
	const [submitStatus, setSubmitStatus] = useState<SubmitStatus | ''>('')
	const [isFocused, setIsFocused] = useState(false)
	const [isAudioModalOpen, setIsAudioModalOpen] = useState(false)
	const [isVideoModalOpen, setIsVideoModalOpen] = useState(false)
	const textareaRef = useRef<HTMLTextAreaElement>(null)
	const audioInputRef = useRef<HTMLInputElement>(null)
	const uploadInputRef = useRef<HTMLInputElement>(null)
	const imageInputRef = useRef<HTMLInputElement>(null)
	const composerStateRef = useRef<{
		text: string
		visibility: PostVisibility
		mediaType: 'text' | 'audio' | 'video' | 'image'
		media: Blob | File | null
	}>({ text: '', visibility: 'public', mediaType: 'text', media: null })

	const hasNoMedia = !audioBlob && !audioFile && !videoBlob && !videoFile && !imageFile
	const canPost = !!postText.trim() || !hasNoMedia
	// The composer rests as a single quiet line and grows once it has attention or content
	const expanded = isFocused || canPost || !!submitStatus
	const VisibilityIcon =
		VISIBILITY_OPTIONS.find((option) => option.value === visibility)?.icon ?? Globe
	const SyncModeIcon = syncMode === 'auto' ? Cloud : CloudOff
	const modKey = modifierKeyLabel()

	// Read once on mount: autosave should not start or stop mid-compose because
	// another tab toggled the setting.
	const [draftsEnabled] = useState(() => getSettings().saveComposerDrafts)

	// The composer keeps a slot per media kind; only the one matching mediaType
	// holds anything, and only that one is worth persisting.
	const activeMedia =
		mediaType === 'audio'
			? (audioFile ?? audioBlob)
			: mediaType === 'video'
				? (videoFile ?? videoBlob)
				: mediaType === 'image'
					? imageFile
					: null
	composerStateRef.current = { text: postText, visibility, mediaType, media: activeMedia }

	const loadOutboxEntry = useCallback(
		(entry: OutboxEntry) => {
			if (postText.length > 0 || !hasNoMedia) return null

			const loadedVisibility = entry.visibility ?? 'public'
			let loadedMedia: File | null = null
			setPostText(entry.text)
			setVisibility(loadedVisibility)
			if (entry.media && entry.mediaType) {
				const file = new File([entry.media], entry.mediaName ?? 'restored', {
					type: entry.media.type,
				})
				loadedMedia = file
				setMediaType(entry.mediaType)
				if (entry.mediaType === 'audio') setAudioFile(file)
				if (entry.mediaType === 'video') setVideoFile(file)
				if (entry.mediaType === 'image') setImageFile(file)
			} else {
				setMediaType('text')
			}
			const loadedMediaType = entry.media && entry.mediaType ? entry.mediaType : 'text'
			composerStateRef.current = {
				text: entry.text,
				visibility: loadedVisibility,
				mediaType: loadedMediaType,
				media: loadedMedia,
			}
			textareaRef.current?.focus()
			return {
				rollback: () => {
					const current = composerStateRef.current
					if (
						current.text !== entry.text ||
						current.visibility !== loadedVisibility ||
						current.mediaType !== loadedMediaType ||
						current.media !== loadedMedia
					) {
						return false
					}
					setPostText('')
					setVisibility('public')
					setAudioBlob(null)
					setVideoBlob(null)
					setAudioFile(null)
					setVideoFile(null)
					setImageFile(null)
					setMediaType('text')
					composerStateRef.current = {
						text: '',
						visibility: 'public',
						mediaType: 'text',
						media: null,
					}
					return true
				},
			}
		},
		[hasNoMedia, postText]
	)

	useEffect(() => registerComposerLoader(loadOutboxEntry), [loadOutboxEntry])

	const restoreDraft = useCallback((stored: ComposerDraft) => {
		setPostText(stored.text)
		setVisibility(stored.visibility)

		const media = stored.media
		if (!media) {
			// Either there was never any media, or the quota rejected it and only
			// the words were kept. Do not leave the composer claiming a media type
			// it has no bytes for.
			setMediaType('text')
			return
		}

		setMediaType(stored.mediaType)
		// Rebuild a File when the original was one: submitPost renames bare
		// recordings but passes real uploads through untouched.
		const asFile = new File([media], stored.mediaName ?? 'restored', { type: media.type })

		if (stored.mediaType === 'audio') {
			if (stored.mediaIsFile) setAudioFile(asFile)
			else setAudioBlob(media)
		} else if (stored.mediaType === 'video') {
			if (stored.mediaIsFile) setVideoFile(asFile)
			else setVideoBlob(media)
		} else if (stored.mediaType === 'image') {
			// The image slot is File-only — no recorder produces one.
			setImageFile(asFile)
		}
	}, [])

	const {
		restored,
		clear: clearStoredDraft,
		acknowledgeRestore,
	} = useComposerDraft({
		// Hold off until auth actually answers: until then userId is null, which is
		// indistinguishable from a real anonymous user, so saving would route a
		// signed-in user's words to the shared anonymous slot. `isAuthResolved`
		// rather than `!isAuthLoading` because the loading gate also opens when the
		// check *failed*, and a failed check is exactly the case where the null is a
		// default rather than an answer.
		enabled: draftsEnabled && isAuthResolved,
		userId,
		text: postText,
		visibility,
		mediaType,
		media: activeMedia,
		isEmpty: !canPost,
		onRestore: restoreDraft,
	})

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		// Cmd/Ctrl+Enter posts; Cmd/Ctrl+B and Cmd/Ctrl+I format the selection.
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault()
			void submitPost(false)
			return
		}
		applyMarkdownShortcut(e, setPostText)
	}

	// Toolbar B/I buttons: wrap the textarea's current selection, same as the
	// keyboard shortcut, keeping focus and selection on the text.
	const formatSelection = (marker: string) => {
		const el = textareaRef.current
		if (!el) return
		const { value, start, end } = toggleMarker(el.value, el.selectionStart, el.selectionEnd, marker)
		setPostText(value)
		requestAnimationFrame(() => {
			el.focus()
			el.setSelectionRange(start, end)
		})
	}

	const handlePostTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		setPostText(e.target.value)
	}

	const handleAudioCaptured = (blob: Blob) => {
		setAudioBlob(blob)
		setMediaType('audio')
	}

	const handleVideoCaptured = (blob: Blob) => {
		setVideoBlob(blob)
		setVideoFile(null)
		setMediaType('video')
	}

	const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		// Reset the input so picking the same file again (e.g. after clearing) re-fires onChange.
		e.target.value = ''
		if (file?.type.startsWith('audio/')) {
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file) {
			toast.error('Please select a valid audio file')
		}
	}

	const handleUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		// Reset the input so picking the same file again (e.g. after clearing) re-fires onChange.
		e.target.value = ''
		if (!file) {
			toast.error('Please select a valid file')
			return
		}

		if (file.name.endsWith('.webm')) {
			// TODO: Detect if it's an audio vs video file
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file.type.startsWith('audio/')) {
			setAudioFile(file)
			setAudioBlob(null)
			setMediaType('audio')
		} else if (file.type.startsWith('video/')) {
			setVideoFile(file)
			setVideoBlob(null)
			setMediaType('video')
		} else if (file.type.startsWith('image/')) {
			setImageFile(file)
			setMediaType('image')
		} else {
			toast.error('Please select a valid file')
		}
	}

	const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		// Reset the input so picking the same file again (e.g. after clearing) re-fires onChange.
		e.target.value = ''
		if (file?.type.startsWith('image/')) {
			setImageFile(file)
			setMediaType('image')
		} else if (file) {
			toast.error('Please select a valid image file')
		}
	}

	const clearMedia = () => {
		setAudioBlob(null)
		setVideoBlob(null)
		setAudioFile(null)
		setVideoFile(null)
		setImageFile(null)
		setMediaType('text')
	}

	const resetComposer = () => {
		setPostText('')
		setVisibility('public')
		clearMedia()
		clearStoredDraft()
		textareaRef.current?.focus()
	}

	const prepareMediaFile = async (): Promise<{
		mediaType: 'audio' | 'video' | 'image'
		file: File
	} | null> => {
		let finalMediaType: 'audio' | 'video' | 'image' | undefined
		let file: File | null = null

		if (mediaType === 'audio' && (audioBlob || audioFile)) {
			const blob = audioFile || audioBlob
			if (blob) {
				finalMediaType = 'audio'
				if (!(blob instanceof File)) {
					// Only convert to WebM if normalization is enabled (since normalization converts the blob to WAV)
					if (getSettings().normalizeAudio) {
						setSubmitStatus('compressing')
						const webmBlob = await convertWavToWebM(blob)
						file = new File([webmBlob], `recording_${Date.now()}.webm`, {
							type: 'audio/webm;codecs=opus',
						})
					} else {
						const extension = getMediaExtension(blob.type, 'audio')
						file = new File([blob], `recording_${Date.now()}.${extension}`, { type: blob.type })
					}
				} else {
					file = blob
				}
			}
		} else if (mediaType === 'video' && (videoBlob || videoFile)) {
			const blob = videoFile || videoBlob
			if (blob) {
				finalMediaType = 'video'
				if (!(blob instanceof File)) {
					const extension = getMediaExtension(blob.type, 'video')
					file = new File([blob], `recording_${Date.now()}.${extension}`, { type: blob.type })
				} else {
					file = blob
				}
			}
		} else if (mediaType === 'image' && imageFile) {
			finalMediaType = 'image'
			file = imageFile
		}

		return finalMediaType && file ? { mediaType: finalMediaType, file } : null
	}

	const queuePost = async (
		isDraft: boolean,
		media: { mediaType: 'audio' | 'video' | 'image'; file: File } | null,
		id?: string
	) => {
		const settings = getSettings()
		const stored = await enqueuePost({
			id,
			author: isAuthenticated && userId !== null ? userId : isAuthResolved ? 'anon' : 'unknown',
			text: postText,
			visibility: isAuthenticated ? visibility : null,
			isDraft,
			linkPreviewsEnabled: settings.linkPreviews,
			autoTranscribe: settings.autoTranscribe && isAuthenticated,
			mediaType: media?.mediaType ?? null,
			media: media?.file ?? null,
			mediaName: media?.file.name ?? null,
		})

		if (!stored) {
			toast.error(
				media
					? "Couldn't queue this post — device storage is full."
					: "Couldn't save this post on this device."
			)
			return
		}

		resetComposer()
		toast(
			syncMode === 'local'
				? 'Saved on this device.'
				: isDraft
					? "Queued — will save to drafts when you're back online."
					: "Queued — will post when you're back online."
		)
	}

	// Throw away a restored draft the user did not want back.
	const discardRestoredDraft = () => {
		setPostText('')
		setVisibility('public')
		clearMedia()
		clearStoredDraft()
	}

	const submitPost = async (isDraft: boolean, e?: React.FormEvent) => {
		e?.preventDefault()

		if (submitStatus) {
			return
		}

		if (!postText.trim() && !audioBlob && !audioFile && !videoBlob && !videoFile && !imageFile) {
			toast.error('Please enter some text or add media')
			return
		}

		if (syncMode === 'local' || !navigator.onLine) {
			setSubmitStatus('preparing')
			try {
				const prepared = await prepareMediaFile()
				if (prepared && prepared.file.size > MAX_QUEUED_MEDIA_BYTES) {
					toast.error(MEDIA_CAP_TOAST)
					return
				}
				await queuePost(isDraft, prepared)
			} catch {
				toast.error('Failed to create post')
			} finally {
				setSubmitStatus('')
			}
			return
		}

		setSubmitStatus('preparing')
		let prepared: { mediaType: 'audio' | 'video' | 'image'; file: File } | null = null
		// A TypeError thrown *during* preparation is not a network drop; queueing then
		// would enqueue the text without its media.
		let prepareCompleted = false

		// The live request and the fallback queue entry share one client_uuid: if the
		// create landed but its response was lost, the flush replays instead of
		// duplicating.
		const clientUuid = crypto.randomUUID()

		try {
			prepared = await prepareMediaFile()
			prepareCompleted = true
			setSubmitStatus('submitting')
			const newPost: CreatePostRequest = {
				text: postText,
				client_uuid: clientUuid,
				media_type: prepared?.mediaType,
				media: prepared?.file ?? null,
				visibility: isAuthenticated ? visibility : undefined,
				is_draft: isDraft || undefined,
			}

			await onPostCreated(newPost)
			resetComposer()
			toast.success(isDraft ? 'Saved to drafts.' : 'Post created successfully!')
		} catch (error) {
			if (error instanceof TypeError && prepareCompleted) {
				if (prepared && prepared.file.size > MAX_QUEUED_MEDIA_BYTES) {
					toast.error(MEDIA_CAP_TOAST)
					return
				}
				await queuePost(isDraft, prepared, clientUuid)
			} else {
				toast.error('Failed to create post')
			}
		} finally {
			setSubmitStatus('')
		}
	}

	const handleSubmit = (e: React.FormEvent) => {
		void submitPost(false, e)
	}

	const openUploadFileSelector = () => {
		uploadInputRef.current?.click()
	}

	const openImageFileSelector = () => {
		imageInputRef.current?.click()
	}

	return (
		<div className="bg-card rounded-lg shadow-xs border max-w-lg mx-auto px-4 py-3">
			<form onSubmit={handleSubmit} className="flex flex-col w-full">
				<div className="-mx-2">
					<Textarea
						ref={textareaRef}
						data-composer-input
						placeholder="What's on your mind?"
						value={postText}
						onChange={handlePostTextChange}
						onKeyDown={handleKeyDown}
						onFocus={() => setIsFocused(true)}
						onBlur={() => setIsFocused(false)}
						className={`w-full resize-none border-none focus-visible:ring-0 py-1 px-2 text-base max-w-lg scroll-mt-20 transition-[min-height] duration-200 ease-out ${
							expanded ? 'min-h-24' : 'min-h-10'
						}`}
						rows={1}
						disabled={!!submitStatus}
					/>
				</div>

				<div className={submitStatus ? 'hidden' : ''}>
					<MediaPreview
						mediaType={mediaType}
						audioBlob={audioBlob}
						audioFile={audioFile}
						videoBlob={videoBlob}
						videoFile={videoFile}
						imageFile={imageFile}
						onClearMedia={clearMedia}
					/>
				</div>

				{restored && !submitStatus && (
					<div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
						<span>
							{restored.mediaOmitted
								? 'Restored your unsaved text. The attachment was too large to save.'
								: 'Restored your unsaved draft.'}
						</span>
						<div className="flex items-center gap-0.5">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs"
								onClick={discardRestoredDraft}
							>
								Discard
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-6 px-2 text-xs"
								onClick={acknowledgeRestore}
							>
								Keep
							</Button>
						</div>
					</div>
				)}

				<div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
					<TooltipProvider delayDuration={300}>
						<div className="flex items-center gap-0.5">
							{expanded && (
								<>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => formatSelection('**')}
												disabled={!!submitStatus}
												aria-label="Bold"
											>
												<Bold className="h-4 w-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Bold ({modKey}B)</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
												onMouseDown={(e) => e.preventDefault()}
												onClick={() => formatSelection('*')}
												disabled={!!submitStatus}
												aria-label="Italic"
											>
												<Italic className="h-4 w-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Italic ({modKey}I)</TooltipContent>
									</Tooltip>
									{hasNoMedia && <span className="mx-1 h-5 w-px bg-border" aria-hidden />}
								</>
							)}
							{hasNoMedia && (
								<>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full hover:bg-red-500/10"
												onClick={() => setIsAudioModalOpen(true)}
												disabled={!!submitStatus}
												aria-label="Record Audio"
											>
												<Mic className="h-5 w-5 text-red-500 dark:text-red-400" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Record audio</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full hover:bg-blue-500/10"
												onClick={() => setIsVideoModalOpen(true)}
												disabled={!!submitStatus}
												aria-label="Record Video"
											>
												<Video className="h-5 w-5 text-blue-500 dark:text-blue-400" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Record video</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full hover:bg-emerald-500/10"
												onClick={openImageFileSelector}
												disabled={!!submitStatus}
												aria-label="Image"
											>
												<Image className="h-5 w-5 text-emerald-500 dark:text-emerald-400" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Add an image</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-9 w-9 rounded-full hover:bg-violet-500/10"
												onClick={openUploadFileSelector}
												disabled={!!submitStatus}
												aria-label="Upload"
											>
												<Upload className="h-5 w-5 text-violet-500 dark:text-violet-400" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>Upload a file</TooltipContent>
									</Tooltip>
								</>
							)}
						</div>
					</TooltipProvider>

					<div className="flex items-center gap-3">
						{submitStatus && (
							<span className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								{submitStatus === 'compressing'
									? 'Compressing media...'
									: submitStatus === 'preparing'
										? 'Preparing post...'
										: 'Posting...'}
							</span>
						)}
						<TooltipProvider delayDuration={300}>
							<Tooltip>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-8 w-8 rounded-full text-muted-foreground"
												disabled={!!submitStatus}
												aria-label="Auto-sync"
											>
												<SyncModeIcon className="h-4 w-4" />
											</Button>
										</TooltipTrigger>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-72">
										<DropdownMenuRadioGroup
											value={syncMode}
											onValueChange={(value) => setSyncMode(value as SyncMode)}
										>
											<DropdownMenuRadioItem value="auto" className="items-start gap-2">
												<span className="grid gap-0.5">
													<span>Sync automatically</span>
													<span className="text-xs text-muted-foreground">
														Posts go online as soon as possible.
													</span>
												</span>
											</DropdownMenuRadioItem>
											<DropdownMenuRadioItem value="local" className="items-start gap-2">
												<span className="grid gap-0.5">
													<span>Stay on this device</span>
													<span className="text-xs text-muted-foreground">
														Posts wait here until you send them.
													</span>
												</span>
											</DropdownMenuRadioItem>
										</DropdownMenuRadioGroup>
									</DropdownMenuContent>
								</DropdownMenu>
								<TooltipContent>Auto-sync</TooltipContent>
							</Tooltip>
						</TooltipProvider>
						{isAuthenticated && expanded && (
							<TooltipProvider delayDuration={300}>
								<Tooltip>
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<TooltipTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													className="h-8 w-8 rounded-full text-muted-foreground"
													disabled={!!submitStatus}
													aria-label="Visibility"
												>
													<VisibilityIcon className="h-4 w-4" />
												</Button>
											</TooltipTrigger>
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="w-72">
											<DropdownMenuRadioGroup
												value={visibility}
												onValueChange={(value) => setVisibility(value as PostVisibility)}
											>
												{VISIBILITY_OPTIONS.map((option) => {
													const Icon = option.icon
													return (
														<DropdownMenuRadioItem
															key={option.value}
															value={option.value}
															className="items-start gap-2"
														>
															<Icon className="mt-0.5 h-4 w-4" />
															<span className="grid gap-0.5">
																<span>{option.label}</span>
																<span className="text-xs text-muted-foreground">
																	{option.description}
																</span>
															</span>
														</DropdownMenuRadioItem>
													)
												})}
											</DropdownMenuRadioGroup>
										</DropdownMenuContent>
									</DropdownMenu>
									<TooltipContent>Visibility</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
						{isAuthenticated && expanded && canPost && (
							<TooltipProvider delayDuration={300}>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={!!submitStatus}
											onClick={() => void submitPost(true)}
										>
											Draft
										</Button>
									</TooltipTrigger>
									<TooltipContent>Save as draft</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						)}
						<Button
							type="submit"
							size="sm"
							disabled={!canPost || !!submitStatus}
							className="rounded-full px-5 font-medium"
						>
							Post
						</Button>
					</div>
				</div>

				<input
					type="file"
					ref={audioInputRef}
					className="hidden"
					accept="audio/*"
					onChange={handleAudioFileChange}
					disabled={!!submitStatus}
				/>
				<input
					type="file"
					ref={uploadInputRef}
					className="hidden"
					accept={
						'audio/mp3, audio/wav, audio/mp4, audio/x-m4a, audio/aiff, audio/x-m4b' +
						', video/*, image/*'
					}
					onChange={handleUploadFileChange}
					disabled={!!submitStatus}
				/>
				<input
					type="file"
					ref={imageInputRef}
					data-testid="composer-image-input"
					className="hidden"
					accept="image/*"
					onChange={handleImageFileChange}
					disabled={!!submitStatus}
				/>
			</form>

			<AudioRecorderModal
				open={isAudioModalOpen}
				onOpenChange={setIsAudioModalOpen}
				onAudioCaptured={(blob) => {
					handleAudioCaptured(blob)
					setIsAudioModalOpen(false)
				}}
			/>

			<VideoRecorderModal
				open={isVideoModalOpen}
				onOpenChange={setIsVideoModalOpen}
				onVideoCaptured={(blob) => {
					handleVideoCaptured(blob)
					setIsVideoModalOpen(false)
				}}
			/>
		</div>
	)
}

export default CreatePost
