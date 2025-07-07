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

interface SignupFormData extends Record<string, unknown> {
	username: string
	password1: string
	password2: string
}

interface SignupModalProps {
	triggerClassName?: string
	onSignupSuccess?: () => void
}

export const SignupModal = ({ triggerClassName, onSignupSuccess }: SignupModalProps) => {
	const [open, setOpen] = useState(false)
	const { refreshAuthStatus } = useAuth()
	const form = useForm<SignupFormData>()

	const onSubmit = async (data: SignupFormData) => {
		try {
			await signup(data)

			await refreshAuthStatus()
			setOpen(false)
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

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					className={cn(
						'transition-colors hover:text-foreground/80 text-foreground/60',
						triggerClassName
					)}
				>
					<div className="flex items-center gap-2">
						<UserPlus className="h-4 w-4" />
						<span>Sign Up</span>
					</div>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle className="text-2xl font-bold text-center">Create Account</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Username</FormLabel>
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
									<FormLabel>Password</FormLabel>
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
									<FormLabel>Confirm Password</FormLabel>
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
						<Button type="submit" className="w-full bg-primary hover:bg-primary/90">
							Create Account
						</Button>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
