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

interface LoginFormData extends Record<string, unknown> {
	username: string
	password: string
}

interface LoginModalProps {
	triggerClassName?: string
	onLoginSuccess?: () => void
}

export const LoginModal = ({ triggerClassName, onLoginSuccess }: LoginModalProps) => {
	const [open, setOpen] = useState(false)
	const { refreshAuthStatus } = useAuth()
	const form = useForm<LoginFormData>()

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
			setOpen(false)
			if (onLoginSuccess) {
				onLoginSuccess()
			}
		} catch (error) {
			console.error('Error logging in:', error)
			form.setError('root', { message: 'An error occurred while logging in' })
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
						<LogIn className="h-4 w-4" />
						<span>Login</span>
					</div>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle className="text-2xl font-bold text-center">Welcome Back</DialogTitle>
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
									<FormLabel>Password</FormLabel>
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
						<Button type="submit" className="w-full bg-primary hover:bg-primary/90">
							Sign In
						</Button>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
