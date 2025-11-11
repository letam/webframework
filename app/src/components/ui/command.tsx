import * as React from 'react'
import type { DialogProps } from '@radix-ui/react-dialog'
import { Command as CommandPrimitive, useCommandState } from 'cmdk'
import { Search, X } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Dialog, DialogContent } from '@/components/ui/dialog'

const Command = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
	<CommandPrimitive
		ref={ref}
		className={cn(
			'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
			className
		)}
		{...props}
	/>
))
Command.displayName = CommandPrimitive.displayName

type CommandDialogProps = DialogProps

const CommandDialog = ({ children, ...props }: CommandDialogProps) => {
	return (
		<Dialog {...props}>
			<DialogContent className="overflow-hidden p-0 shadow-lg">
				<Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5">
					{children}
				</Command>
			</DialogContent>
		</Dialog>
	)
}

type CommandInputProps = React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
	enableClearButton?: boolean
}

const CommandInput = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Input>,
	CommandInputProps
>(({ className, enableClearButton = false, ...props }, forwardedRef) => {
	type InputElement = React.ElementRef<typeof CommandPrimitive.Input>

	const inputRef = React.useRef<InputElement | null>(null)
	const searchValue = useCommandState((state) => state.search)

	const handleClear = React.useCallback(() => {
		const input = inputRef.current
		if (!input) {
			return
		}

		const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set

		valueSetter?.call(input, '')
		if (!valueSetter) {
			input.value = ''
		}

		input.dispatchEvent(new Event('input', { bubbles: true }))
		props.onValueChange?.('')
		input.focus()
	}, [props.onValueChange])

	const setRefs = React.useCallback(
		(node: InputElement | null) => {
			inputRef.current = node

			if (typeof forwardedRef === 'function') {
				forwardedRef(node)
			} else if (forwardedRef) {
				;(forwardedRef as React.MutableRefObject<InputElement | null>).current = node
			}
		},
		[forwardedRef]
	)

	const showClearButton =
		enableClearButton && typeof searchValue === 'string' && searchValue.length > 0

	return (
		<div className="flex items-center border-b px-3" cmdk-input-wrapper="">
			<Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
			<CommandPrimitive.Input
				ref={setRefs}
				className={cn(
					'flex h-11 w-full rounded-md bg-transparent py-3 text-base outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm',
					className
				)}
				{...props}
			/>
			{showClearButton ? (
				<button
					type="button"
					onClick={handleClear}
					aria-label="Clear search"
					className="ml-2 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
				>
					<X className="size-3.5" />
				</button>
			) : null}
		</div>
	)
})

CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.List>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.List
		ref={ref}
		className={cn('max-h-[300px] overflow-y-auto overflow-x-hidden', className)}
		{...props}
	/>
))

CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Empty>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
	<CommandPrimitive.Empty ref={ref} className="py-6 text-center text-sm" {...props} />
))

CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandGroup = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Group>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Group
		ref={ref}
		className={cn(
			'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
			className
		)}
		{...props}
	/>
))

CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandSeparator = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Separator>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Separator
		ref={ref}
		className={cn('-mx-1 h-px bg-border', className)}
		{...props}
	/>
))
CommandSeparator.displayName = CommandPrimitive.Separator.displayName

const CommandItem = React.forwardRef<
	React.ElementRef<typeof CommandPrimitive.Item>,
	React.ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
	<CommandPrimitive.Item
		ref={ref}
		className={cn(
			"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-hidden data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50",
			className
		)}
		{...props}
	/>
))

CommandItem.displayName = CommandPrimitive.Item.displayName

const CommandShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn('ml-auto text-xs tracking-widest text-muted-foreground', className)}
			{...props}
		/>
	)
}
CommandShortcut.displayName = 'CommandShortcut'

export {
	Command,
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandShortcut,
	CommandSeparator,
}
