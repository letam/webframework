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

interface LoginFormData extends Record<string, unknown> {
	username: string
	password: string
}

export const LoginModal = () => {
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
		} catch (error) {
			console.error('Error logging in:', error)
			form.setError('root', { message: 'An error occurred while logging in' })
		}
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="default">Login</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Login</DialogTitle>
				</DialogHeader>
				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="username"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Username</FormLabel>
									<FormControl>
										<Input {...field} />
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
										<Input type="password" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						{form.formState.errors.root && (
							<p className="text-sm font-medium text-destructive">
								{form.formState.errors.root.message}
							</p>
						)}
						<Button type="submit" className="w-full">
							Login
						</Button>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	)
}
