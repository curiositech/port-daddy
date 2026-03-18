import * as React from 'react'
import { cn } from '@/lib/utils'

type BadgeVariant = 'default' | 'teal' | 'amber' | 'green' | 'neutral' | 'outline'

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  size?: 'sm' | 'md'
}

const variantClasses: Record<BadgeVariant, string> = {
  default: 'bg-[var(--bg-overlay)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
  teal: 'bg-[var(--badge-teal-bg)] text-[var(--badge-teal-text)] border-[var(--badge-teal-border)]',
  amber: 'bg-[var(--badge-amber-bg)] text-[var(--badge-amber-text)] border-transparent',
  green: 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] border-transparent',
  neutral: 'bg-[var(--bg-surface)] text-[var(--text-tertiary)] border-[var(--border-subtle)]',
  outline: 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-default)]',
}

const sizeClasses = {
  sm: 'px-2 py-0.5 text-[11px]',
  md: 'px-2.5 py-1 text-xs',
}

export function Badge({ 
  variant = 'default', 
  size = 'sm',
  className, 
  children, 
  ...props 
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        'rounded-full border',
        'font-medium uppercase tracking-wide',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  )
}
