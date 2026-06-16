import { useState, useEffect } from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle, Shield, Heart, Users, Smile } from 'lucide-react'

const GROUND_RULES_KEY = 'ground-rules-accepted'

interface GroundRule {
	id: string
	title: string
	description: string
	icon: React.ReactNode
}

const groundRules: GroundRule[] = [
	{
		id: 'no-hate',
		title: 'No Hate or Harm',
		description:
			'Treat everyone with respect and kindness. No hate speech, harassment, or harmful content.',
		icon: <Heart className="h-5 w-5 text-primary flex-shrink-0" />,
	},
	{
		id: 'be-respectful',
		title: 'Be Respectful',
		description: 'Respect different opinions and perspectives. Engage in constructive discussions.',
		icon: <Users className="h-5 w-5 text-foreground/70 flex-shrink-0" />,
	},
	{
		id: 'safe-environment',
		title: 'Safe Environment',
		description: 'Help maintain a safe and welcoming environment for all users.',
		icon: <Shield className="h-5 w-5 text-gold flex-shrink-0" />,
	},
	{
		id: 'be-awesome',
		title: 'Be Awesome',
		description: 'Be awesome to everyone and everything. Start with your self.',
		icon: <Smile className="h-5 w-5 text-gold flex-shrink-0" />,
	},
]

export const GroundRulesModal = () => {
	const [isOpen, setIsOpen] = useState(false)
	const [acceptedRules, setAcceptedRules] = useState<Set<string>>(new Set())
	const [hasAttemptedAccept, setHasAttemptedAccept] = useState(false)

	useEffect(() => {
		const saved = localStorage.getItem(GROUND_RULES_KEY)
		if (!saved) {
			setIsOpen(true)
		}
	}, [])

	const handleRuleToggle = (ruleId: string, checked: boolean) => {
		const newAccepted = new Set(acceptedRules)
		if (checked) {
			newAccepted.add(ruleId)
		} else {
			newAccepted.delete(ruleId)
		}
		setAcceptedRules(newAccepted)
	}

	const handleAccept = () => {
		if (acceptedRules.size === groundRules.length) {
			localStorage.setItem(GROUND_RULES_KEY, JSON.stringify(Array.from(acceptedRules)))
			setIsOpen(false)
		} else {
			setHasAttemptedAccept(true)
		}
	}

	const allRulesAccepted = acceptedRules.size === groundRules.length

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogContent className="sm:max-w-[500px] bg-card border-border">
				<DialogHeader className="space-y-3">
					{/* Eyebrow kicker */}
					<p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
						Before You Tune In
					</p>
					<DialogTitle className="flex items-center gap-2 font-display text-2xl font-light">
						<AlertTriangle className="h-5 w-5 text-primary flex-shrink-0" />
						Community <span className="italic text-primary">Ground Rules</span>
					</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						Review the community rules below. Check all boxes to proceed.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6 pt-1">
					<div className="space-y-3">
						{groundRules.map((rule) => {
							const isAccepted = acceptedRules.has(rule.id)
							const isUnmet = hasAttemptedAccept && !isAccepted
							return (
								<label
									key={rule.id}
									htmlFor={rule.id}
									className={[
										'w-full p-3 rounded-lg border transition-colors cursor-pointer block',
										isAccepted
											? 'border-primary/50 bg-primary/5'
											: isUnmet
												? 'border-destructive bg-background/60'
												: 'border-border bg-background/60 hover:border-border/80 hover:bg-accent/30',
									].join(' ')}
								>
									<div className="flex items-start space-x-3">
										<Checkbox
											id={rule.id}
											checked={isAccepted}
											onCheckedChange={(checked) => handleRuleToggle(rule.id, checked as boolean)}
											className="mt-0.5 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
										/>
										<div className="flex items-center gap-2 min-w-0 flex-1">
											{rule.icon}
											<span className="font-medium text-foreground whitespace-nowrap">
												{rule.title}
											</span>
										</div>
									</div>
									<p className="text-sm text-muted-foreground ml-6 mt-2">{rule.description}</p>
								</label>
							)
						})}
					</div>

					<div className="flex justify-end space-x-2">
						<Button
							onClick={handleAccept}
							disabled={false}
							className={
								allRulesAccepted
									? 'bg-primary hover:bg-primary/90 text-primary-foreground font-mono text-[0.7rem] uppercase tracking-[0.15em]'
									: 'bg-muted text-muted-foreground hover:bg-muted cursor-not-allowed font-mono text-[0.7rem] uppercase tracking-[0.15em]'
							}
						>
							I Accept All Rules
						</Button>
					</div>

					{!allRulesAccepted && hasAttemptedAccept && (
						<div className="text-sm text-destructive bg-destructive/5 p-3 rounded-lg border border-destructive/30 font-mono text-[0.7rem] uppercase tracking-[0.12em]">
							Please check all boxes to accept the ground rules and continue.
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
