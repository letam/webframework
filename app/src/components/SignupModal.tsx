import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useAuth } from '@/hooks/useAuth'
import { signup } from '@/lib/api/auth'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'

interface SignupFormData extends Record<string, unknown> {
	username: string
	password1: string
	password2: string
}

interface SignupModalProps {
	triggerClassName?: string
	onSignupSuccess?: () => void
	onOpenChange?: (open: boolean) => void
}

export const SignupModal = ({
	triggerClassName,
	onSignupSuccess,
	onOpenChange,
}: SignupModalProps) => {
	const [open, setOpen] = useState(false)
	const { refreshAuthStatus } = useAuth()
	const form = useForm<SignupFormData>()
	const isMobile = useIsMobile()

	const onSubmit = async (data: SignupFormData) => {
		try {
			await signup(data)

			await refreshAuthStatus()
			handleOpenChange(false)
			if (onSignupSuccess) {
				onSignupSuccess()
			}
		} catch (error) {
			console.error('Error signing up:', error)
			if (error instanceof Error) {
				try {
					const errors = JSON.parse(error.message)
					// Handle field-specific errors
					for (const field of Object.keys(errors)) {
						if (field === 'form') {
							form.setError('root', { message: errors[field][0] })
						} else if (field in data) {
							form.setError(field as 'username' | 'password1' | 'password2', {
								message: errors[field][0],
							})
						}
					}
				} catch {
					form.setError('root', { message: 'An error occurred while signing up' })
				}
			} else {
				form.setError('root', { message: 'An error occurred while signing up' })
			}
		}
	}

	const handleOpenChange = (nextOpen: boolean) => {
		setOpen(nextOpen)
		if (onOpenChange) {
			onOpenChange(nextOpen)
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button
					variant="default"
					className={cn(
						'bg-primary text-primary-foreground font-mono text-[0.7rem] uppercase tracking-[0.18em] hover:bg-primary/90 transition-colors',
						triggerClassName
					)}
				>
					<div className="flex items-center gap-2">
						<UserPlus className="h-4 w-4" />
						<span>Sign Up</span>
					</div>
				</Button>
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-[425px] rounded-xl border border-border bg-card"
				onOpenAutoFocus={(event) => {
					if (isMobile) {
						event.preventDefault() // Prevent Radix's default autofocus
						// Note: For iOS: Prevent mobile keyboard from rendering before dialog is fully rendered. Otherwise the dialog does not shift up into view, and we cannot press the arrow on virtual keyboard to focus the next input.
						return
					}
				}}
			>
				<DialogHeader className="space-y-1 pb-2">
					<p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground text-center">
						Join the Sphere
					</p>
					<DialogTitle className="font-display text-3xl font-light text-center text-foreground">
						Create <span className="italic text-primary">Account</span>
					</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pt-2">
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
										Username
									</FormLabel>
									<FormControl>
										<Input placeholder="Choose a username" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password1"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
										Password
									</FormLabel>
									<FormControl>
										<Input type="password" placeholder="Create a password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password2"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
										Confirm Password
									</FormLabel>
									<FormControl>
										<Input type="password" placeholder="Confirm your password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{form.formState.errors.root && (
							<p className="text-sm font-medium text-destructive text-center">
								{form.formState.errors.root.message}
							</p>
						)}
						<Button
							type="submit"
							className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-mono text-[0.7rem] uppercase tracking-[0.15em]"
						>
							Create Account
						</Button>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
