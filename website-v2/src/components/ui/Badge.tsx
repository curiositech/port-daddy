import * as React from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'teal' | 'amber' | 'green' | 'neutral'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
}

const variantClasses: Record<BadgeVariant, string> = {
  teal: 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)] border border-[var(--badge-teal-border)]',
  amber: 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)] border border-transparent',
  green: 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] border border-transparent',
  neutral: 'bg-[var(--bg-overlay)] text-[var(--text-muted)] border border-[var(--border-subtle)]',
}

export function Badge({ variant = 'teal', className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        'px-2.5 py-0.5 rounded-[var(--p-radius-full)]',
        'text-xs font-semibold uppercase tracking-wider',
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
