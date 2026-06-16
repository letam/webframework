import { useEffect, useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
			<div className="container px-4 py-10">
				<div className="mx-auto max-w-2xl">
					{/* Page header */}
					<header className="mb-8">
						<p className="eyebrow mb-2">Preferences</p>
						<h1 className="font-display text-4xl font-light tracking-tight text-foreground">
							Your <span className="italic text-primary">Settings</span>
						</h1>
						<hr className="rule-double mt-4" />
					</header>

					{/* Audio Settings panel */}
					<section className="mb-5">
						<p className="eyebrow mb-3">Audio</p>
						<div className="rounded-xl border border-border bg-card p-6">
							<h2 className="mb-0.5 font-display text-lg font-semibold text-foreground">
								Audio Settings
							</h2>
							<p className="mb-5 font-mono text-[0.72rem] text-muted-foreground">
								Configure your audio recording preferences
							</p>

							<div className="flex items-center justify-between gap-4">
								<div className="space-y-1">
									<Label htmlFor="normalize-audio" className="text-sm font-medium text-foreground">
										Normalize Audio
									</Label>
									<p className="font-mono text-[0.72rem] leading-relaxed text-muted-foreground">
										Automatically normalize audio levels when recording
									</p>
								</div>
								<Switch
									id="normalize-audio"
									checked={normalizeAudio}
									onCheckedChange={setNormalizeAudio}
									className="data-[state=checked]:bg-primary"
								/>
							</div>

							{/* Gold accent: audio affordance pill */}
							<div className="mt-5 inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1">
								<span className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-gold">
									Audio signal
								</span>
							</div>
						</div>
					</section>

					{/* Video Settings panel */}
					<section>
						<p className="eyebrow mb-3">Video</p>
						<div className="rounded-xl border border-border bg-card p-6">
							<h2 className="mb-0.5 font-display text-lg font-semibold text-foreground">
								Video Settings
							</h2>
							<p className="mb-5 font-mono text-[0.72rem] text-muted-foreground">
								Configure your video recording preferences
							</p>

							<div className="space-y-3">
								<Label className="text-sm font-medium text-foreground">Video Quality</Label>
								<RadioGroup
									value={videoQuality}
									onValueChange={(value) => setVideoQuality(value as 'low' | 'high')}
									className="flex flex-col space-y-2"
								>
									<div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent/50">
										<RadioGroupItem value="low" id="low" className="text-primary" />
										<Label htmlFor="low" className="cursor-pointer font-normal text-foreground">
											Low Quality (480p)
											<span className="ml-2 font-mono text-[0.68rem] text-muted-foreground">
												— Smaller file size
											</span>
										</Label>
									</div>
									<div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-colors hover:bg-accent/50">
										<RadioGroupItem value="high" id="high" className="text-primary" />
										<Label htmlFor="high" className="cursor-pointer font-normal text-foreground">
											High Quality (720p)
											<span className="ml-2 font-mono text-[0.68rem] text-muted-foreground">
												— Larger file size
											</span>
										</Label>
									</div>
								</RadioGroup>
							</div>
						</div>
					</section>
				</div>
			</div>
		</div>
	)
}

export default SettingsPage
