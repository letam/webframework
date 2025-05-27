import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import Navbar from '@/components/Navbar'
import { getSettings, updateSettings } from '@/lib/utils/settings'

const SettingsPage = () => {
	const [normalizeAudio, setNormalizeAudio] = useState(getSettings().normalizeAudio)

	useEffect(() => {
		updateSettings({ normalizeAudio })
	}, [normalizeAudio])

	return (
		<div className="min-h-screen bg-background">
			<Navbar />
			<div className="container px-4 py-8">
				<div className="max-w-2xl mx-auto">
					<h1 className="text-3xl font-bold mb-8">Settings</h1>

					<Card>
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
				</div>
			</div>
		</div>
	)
}

export default SettingsPage
