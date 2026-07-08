'use client'

/** shadcn/ui スタイルの Command（cmdk ラッパ）。駅名検索などのコマンドパレット用。 */

import { type ComponentProps } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '@/lib/utils'

export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn('flex w-full flex-col', className)} {...props} />
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <CommandPrimitive.Input
      className={cn(
        'h-11 w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400',
        className,
      )}
      {...props}
    />
  )
}

export function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      className={cn('max-h-72 overflow-y-auto overflow-x-hidden p-1', className)}
      {...props}
    />
  )
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none data-[selected=true]:bg-indigo-50 data-[selected=true]:text-indigo-900',
        className,
      )}
      {...props}
    />
  )
}
