import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import Navbar from '@/components/Navbar'
import { getSettings, updateSettings } from '@/lib/utils/settings'

const SettingsPage = () => {
	const [normalizeAudio, setNormalizeAudio] = useState(getSettings().normalizeAudio)
	const [videoQuality, setVideoQuality] = useState(getSettings().videoQuality)

	useEffect(() => {
		updateSettings({ normalizeAudio, videoQuality })
	}, [normalizeAudio, videoQuality])

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
				</div>
			</div>
		</div>
	)
}

export default SettingsPage
