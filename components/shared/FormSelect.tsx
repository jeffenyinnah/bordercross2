import { cn } from '@/lib/utils'

/**
 * Native select styled like the inputs. Used where options are ids: the Base UI
 * Select shows the raw value unless it is given every item's label.
 */
export function FormSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-lg border border-input bg-white px-2.5 text-sm outline-none',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
