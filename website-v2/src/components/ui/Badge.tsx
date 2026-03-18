import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border-transparent',
        teal:
          'bg-primary/10 text-primary border-primary/20',
        amber:
          'bg-amber-500/15 text-amber-700 border-transparent dark:text-amber-400',
        green:
          'bg-emerald-500/15 text-emerald-700 border-transparent dark:text-emerald-400',
        neutral:
          'bg-muted text-muted-foreground border-border',
        outline:
          'border-border text-foreground bg-transparent',
        destructive:
          'bg-destructive text-destructive-foreground border-transparent',
        secondary:
          'bg-secondary text-secondary-foreground border-transparent',
      },
    },
    defaultVariants: {
      variant: 'teal',
    },
  }
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant = 'teal', ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
export type { BadgeProps }
