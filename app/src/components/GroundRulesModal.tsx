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
import { Label } from '@/components/ui/label'
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
	{
		id: 'be-awesome',
		title: 'Be Awesome',
		description: 'Be awesome to everyone and everything. Start with your self.',
		icon: <Smile className="h-5 w-5 text-yellow-500 flex-shrink-0" />,
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
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-xl">
						<AlertTriangle className="h-6 w-6 text-amber-500" />
						Community Ground Rules
					</DialogTitle>
					<DialogDescription className="mt-2">
						Review the community rules below. Check all boxes to proceed.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					<div className="space-y-4">
						{groundRules.map((rule) => (
							<label
								key={rule.id}
								htmlFor={rule.id}
								className="w-full p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer block focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2"
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
										<span className="font-medium whitespace-nowrap">{rule.title}</span>
									</div>
								</div>
								<p className="text-sm text-muted-foreground ml-6 mt-2">{rule.description}</p>
							</label>
						))}
					</div>

					<div className="flex justify-end space-x-2">
						<Button
							onClick={handleAccept}
							className={`${allRulesAccepted ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-400 hover:bg-gray-500 cursor-not-allowed'}`}
						>
							I Accept All Rules
						</Button>
					</div>

					{!allRulesAccepted && hasAttemptedAccept && (
						<div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg border border-border">
							Please check all boxes to accept the ground rules and continue.
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
