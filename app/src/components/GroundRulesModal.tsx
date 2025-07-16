import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { AlertTriangle, Shield, Heart, Users } from 'lucide-react'

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
		icon: <Heart className="h-5 w-5 text-red-500 flex-shrink-0" />,
	},
	{
		id: 'be-respectful',
		title: 'Be Respectful',
		description: 'Respect different opinions and perspectives. Engage in constructive discussions.',
		icon: <Users className="h-5 w-5 text-blue-500 flex-shrink-0" />,
	},
	{
		id: 'safe-environment',
		title: 'Safe Environment',
		description: 'Help maintain a safe and welcoming environment for all users.',
		icon: <Shield className="h-5 w-5 text-green-500 flex-shrink-0" />,
	},
]

export const GroundRulesModal = () => {
	const [isOpen, setIsOpen] = useState(false)
	const [acceptedRules, setAcceptedRules] = useState<Set<string>>(new Set())
	const [hasAcceptedBefore, setHasAcceptedBefore] = useState(false)

	useEffect(() => {
		const saved = localStorage.getItem(GROUND_RULES_KEY)
		if (saved) {
			setHasAcceptedBefore(true)
		} else {
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
		}
	}

	const allRulesAccepted = acceptedRules.size === groundRules.length

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<AlertTriangle className="h-6 w-6 text-amber-500" />
						Community Ground Rules
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-6">
					<div className="text-sm text-muted-foreground">
						Before you can access our community, please review and accept our ground rules:
					</div>

					<div className="space-y-4">
						{groundRules.map((rule) => (
							<button
								key={rule.id}
								type="button"
								className="w-full text-left p-3 rounded-lg border cursor-pointer hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
								onClick={() => {
									const isCurrentlyAccepted = acceptedRules.has(rule.id)
									handleRuleToggle(rule.id, !isCurrentlyAccepted)
								}}
								aria-pressed={acceptedRules.has(rule.id)}
							>
								<div className="flex items-start space-x-3">
									<Checkbox
										id={rule.id}
										checked={acceptedRules.has(rule.id)}
										onCheckedChange={(checked) => handleRuleToggle(rule.id, checked as boolean)}
										className="mt-0.5"
									/>
									<div className="flex items-center gap-2 min-w-0 flex-1">
										{rule.icon}
										<Label
											htmlFor={rule.id}
											className="font-medium whitespace-nowrap cursor-pointer"
										>
											{rule.title}
										</Label>
									</div>
								</div>
								<p className="text-sm text-muted-foreground ml-6 mt-2">{rule.description}</p>
							</button>
						))}
					</div>

					<div className="flex justify-end space-x-2">
						<Button
							onClick={handleAccept}
							disabled={!allRulesAccepted}
							className="bg-green-600 hover:bg-green-700"
						>
							I Accept All Rules
						</Button>
					</div>

					{!allRulesAccepted && (
						<div className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg border border-amber-200">
							Please check all boxes to accept the ground rules and continue.
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
