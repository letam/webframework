import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { SERVER_HOST } from '@/lib/constants'
import { getFetchOptions } from '@/lib/utils/fetch'
import { useAuth } from '@/hooks/useAuth'
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
import { LogIn } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/hooks/use-mobile'

interface LoginFormData extends Record<string, unknown> {
	username: string
	password: string
}

interface LoginModalProps {
	triggerClassName?: string
	onLoginSuccess?: () => void
	onOpenChange?: (open: boolean) => void
}

export const LoginModal = ({ triggerClassName, onLoginSuccess, onOpenChange }: LoginModalProps) => {
	const [open, setOpen] = useState(false)
	const { refreshAuthStatus } = useAuth()
	const form = useForm<LoginFormData>()
	const isMobile = useIsMobile()

	const onSubmit = async (data: LoginFormData) => {
		try {
			const options = await getFetchOptions('POST', data)
			const response = await fetch(`${SERVER_HOST}/auth/login/`, options)

			if (!response.ok) {
				const errors = await response.json()
				if (errors.form) {
					form.setError('root', { message: errors.form[0] })
				}
				return
			}

			await refreshAuthStatus()
			handleOpenChange(false)
			if (onLoginSuccess) {
				onLoginSuccess()
			}
		} catch (error) {
			console.error('Error logging in:', error)
			form.setError('root', { message: 'An error occurred while logging in' })
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
					variant="outline"
					className={cn(
						'border-border font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary',
						triggerClassName
					)}
				>
					<div className="flex items-center gap-2">
						<LogIn className="h-4 w-4" />
						<span>Login</span>
					</div>
				</Button>
			</DialogTrigger>
			<DialogContent
				className="sm:max-w-[425px] rounded-xl border border-border bg-card"
				onOpenAutoFocus={(event) => {
					if (isMobile) {
						// Note: For iOS: Prevent mobile keyboard from rendering before dialog is fully rendered. Otherwise the dialog does not shift up into view, and we cannot press the arrow on virtual keyboard to focus the next input.
						event.preventDefault() // Prevent Radix's default autofocus
						return
					}
				}}
			>
				<DialogHeader className="space-y-1 pb-2">
					<p className="font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground text-center">
						Welcome Back
					</p>
					<DialogTitle className="font-display text-3xl font-light text-center text-foreground">
						Sign <span className="italic text-primary">In</span>
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
										<Input placeholder="Enter your username" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="password"
							render={({ field }) => (
								<FormItem>
									<FormLabel className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
										Password
									</FormLabel>
									<FormControl>
										<Input type="password" placeholder="Enter your password" {...field} />
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
							Sign In
						</Button>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
