import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import Navbar from '@/components/Navbar'
import { getSettings, updateSettings } from '@/lib/utils/settings'
import { useAuth } from '@/hooks/useAuth'
import { getPosts, type PostsQueryScope } from '@/lib/api/posts'
import type { Post } from '@/types/post'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

const fetchAllPostPages = async (scope: PostsQueryScope) => {
	const firstPage = await getPosts(scope)
	const posts = [...firstPage.posts]
	let next = firstPage.next

	while (next) {
		const page = await getPosts(scope, next)
		posts.push(...page.posts)
		next = page.next
	}

	return posts
}

const dedupePosts = (posts: Post[]) =>
	Array.from(new Map(posts.map((post) => [post.id, post])).values())

const downloadJson = (data: unknown, filename: string) => {
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
	const url = URL.createObjectURL(blob)
	const link = document.createElement('a')

	link.href = url
	link.download = filename
	document.body.appendChild(link)
	link.click()
	link.remove()
	URL.revokeObjectURL(url)
}

const SettingsPage = () => {
	const initialSettings = getSettings()
	const { isAuthenticated, userId, username } = useAuth()
	const [normalizeAudio, setNormalizeAudio] = useState(initialSettings.normalizeAudio)
	const [autoTranscribe, setAutoTranscribe] = useState(initialSettings.autoTranscribe)
	const [linkPreviews, setLinkPreviews] = useState(initialSettings.linkPreviews)
	const [showLinkPreviews, setShowLinkPreviews] = useState(initialSettings.showLinkPreviews)
	const [videoQuality, setVideoQuality] = useState(initialSettings.videoQuality)
	const [saveComposerDrafts, setSaveComposerDrafts] = useState(initialSettings.saveComposerDrafts)
	const [postSyncDefault, setPostSyncDefault] = useState(initialSettings.postSyncDefault)
	const [isExporting, setIsExporting] = useState(false)

	useEffect(() => {
		updateSettings({
			normalizeAudio,
			autoTranscribe,
			linkPreviews,
			showLinkPreviews,
			videoQuality,
			saveComposerDrafts,
			postSyncDefault,
		})
	}, [
		normalizeAudio,
		autoTranscribe,
		linkPreviews,
		showLinkPreviews,
		videoQuality,
		saveComposerDrafts,
		postSyncDefault,
	])

	const handleExportPosts = async () => {
		if (!isAuthenticated || userId == null) {
			return
		}

		setIsExporting(true)

		try {
			const [authoredPosts, draftPosts] = await Promise.all([
				fetchAllPostPages({ author: userId }),
				fetchAllPostPages({ drafts: true }),
			])
			const exportedAt = new Date()
			const exportUsername = username ?? 'user'
			const payload = {
				exported_at: exportedAt.toISOString(),
				username: exportUsername,
				posts: dedupePosts([...authoredPosts, ...draftPosts]),
			}
			const dateStamp = exportedAt.toISOString().slice(0, 10)

			downloadJson(payload, `echosphere-export-${exportUsername}-${dateStamp}.json`)
		} catch (error) {
			console.error('Failed to export posts:', error)
			toast.error('Failed to export posts')
		} finally {
			setIsExporting(false)
		}
	}

	return (
		<div className="min-h-screen bg-background">
			<Navbar />
			<div className="container px-4 py-8">
				<div className="max-w-2xl mx-auto">
					<h1 className="text-3xl font-bold mb-8">Settings</h1>

					<Card className="mb-4">
						<CardHeader>
							<CardTitle>Audio Settings</CardTitle>
							<CardDescription>Configure your audio recording preferences</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="normalize-audio">Normalize Audio</Label>
										<p className="text-sm text-muted-foreground">
											Automatically normalize audio levels when recording
										</p>
									</div>
									<Switch
										id="normalize-audio"
										checked={normalizeAudio}
										onCheckedChange={setNormalizeAudio}
									/>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="auto-transcribe">Auto-transcribe recordings</Label>
										<p className="text-sm text-muted-foreground">
											Start transcription automatically when you post audio or video. Requires being
											signed in.
										</p>
									</div>
									<Switch
										id="auto-transcribe"
										checked={autoTranscribe}
										onCheckedChange={setAutoTranscribe}
									/>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card className="mb-4">
						<CardHeader>
							<CardTitle>Post Settings</CardTitle>
							<CardDescription>Configure your posting preferences</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="link-previews">Create link previews</Label>
										<p className="text-sm text-muted-foreground">
											Generate preview cards for links in your new posts
										</p>
									</div>
									<Switch
										id="link-previews"
										checked={linkPreviews}
										onCheckedChange={setLinkPreviews}
									/>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="show-link-previews">Show link previews</Label>
										<p className="text-sm text-muted-foreground">
											Display preview cards for links in posts you read
										</p>
									</div>
									<Switch
										id="show-link-previews"
										checked={showLinkPreviews}
										onCheckedChange={setShowLinkPreviews}
									/>
								</div>

								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="save-composer-drafts">Save unfinished posts</Label>
										<p className="text-sm text-muted-foreground">
											Keep what you are writing, and any recording you have not posted yet, on this
											device so a refresh does not lose it
										</p>
									</div>
									<Switch
										id="save-composer-drafts"
										checked={saveComposerDrafts}
										onCheckedChange={setSaveComposerDrafts}
									/>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card className="mb-4">
						<CardHeader>
							<CardTitle>Offline & sync</CardTitle>
							<CardDescription>Configure how new posts sync</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="space-y-2">
									<Label>New posts</Label>
									<p className="text-sm text-muted-foreground">
										Choose how the auto-sync switch in the composer starts.
									</p>
									<RadioGroup
										value={postSyncDefault}
										onValueChange={(value) =>
											setPostSyncDefault(value as 'auto' | 'local' | 'remember')
										}
										className="flex flex-col space-y-1"
									>
										<div className="flex items-start space-x-2">
											<RadioGroupItem value="auto" id="sync-auto" className="mt-0.5" />
											<div className="space-y-0.5">
												<Label htmlFor="sync-auto" className="font-normal">
													Sync automatically
												</Label>
												<p className="text-sm text-muted-foreground">
													Posts go online as soon as possible. Offline posts wait for a connection.
												</p>
											</div>
										</div>
										<div className="flex items-start space-x-2">
											<RadioGroupItem value="local" id="sync-local" className="mt-0.5" />
											<div className="space-y-0.5">
												<Label htmlFor="sync-local" className="font-normal">
													Stay on this device
												</Label>
												<p className="text-sm text-muted-foreground">
													Posts wait here until you send them.
												</p>
											</div>
										</div>
										<div className="flex items-start space-x-2">
											<RadioGroupItem value="remember" id="sync-remember" className="mt-0.5" />
											<div className="space-y-0.5">
												<Label htmlFor="sync-remember" className="font-normal">
													Remember my last choice
												</Label>
												<p className="text-sm text-muted-foreground">
													Start with whichever mode you used last.
												</p>
											</div>
										</div>
									</RadioGroup>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Video Settings</CardTitle>
							<CardDescription>Configure your video recording preferences</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="space-y-4">
								<div className="space-y-2">
									<Label>Video Quality</Label>
									<RadioGroup
										value={videoQuality}
										onValueChange={(value) => setVideoQuality(value as 'low' | 'high')}
										className="flex flex-col space-y-1"
									>
										<div className="flex items-center space-x-2">
											<RadioGroupItem value="low" id="low" />
											<Label htmlFor="low" className="font-normal">
												Low Quality (480p) - Smaller file size
											</Label>
										</div>
										<div className="flex items-center space-x-2">
											<RadioGroupItem value="high" id="high" />
											<Label htmlFor="high" className="font-normal">
												High Quality (720p) - Larger file size
											</Label>
										</div>
									</RadioGroup>
								</div>
							</div>
						</CardContent>
					</Card>

					{isAuthenticated && userId != null ? (
						<Card className="mt-4">
							<CardHeader>
								<CardTitle>Data</CardTitle>
								<CardDescription>Export a copy of your account content</CardDescription>
							</CardHeader>
							<CardContent>
								<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<p className="text-sm text-muted-foreground">
										JSON of all your posts and drafts. Media files are linked, not included.
									</p>
									<Button type="button" onClick={handleExportPosts} disabled={isExporting}>
										{isExporting ? (
											<>
												<Loader2 className="size-4 animate-spin" />
												Exporting…
											</>
										) : (
											'Export my posts'
										)}
									</Button>
								</div>
							</CardContent>
						</Card>
					) : null}
				</div>
			</div>
		</div>
	)
}

export default SettingsPage
