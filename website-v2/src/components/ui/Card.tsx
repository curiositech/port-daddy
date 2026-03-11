import * as React from 'react'
import { cn } from '@/lib/utils'

type CardVariant = 'default' | 'glass' | 'elevated'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

const variantClasses: Record<CardVariant, string> = {
  default: [
    'bg-[var(--card-bg)]',
    'border border-[var(--card-border)]',
    'shadow-[var(--card-shadow)]',
    'rounded-[var(--card-radius)]',
  ].join(' '),
  glass: [
    'bg-[var(--glass-card-bg)]',
    'border border-[var(--glass-card-border)]',
    'rounded-[var(--card-radius)]',
    'backdrop-blur-[var(--glass-card-blur)]',
  ].join(' '),
  elevated: [
    'bg-[var(--bg-elevated)]',
    'border border-[var(--border-subtle)]',
    'shadow-[var(--p-shadow-xl)]',
    'rounded-[var(--card-radius)]',
  ].join(' '),
}

export function Card({ variant = 'default', className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(variantClasses[variant], 'overflow-hidden', className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-6 py-4 border-b border-[var(--border-subtle)]', className)} {...props}>
      {children}
    </div>
  )
}

export function CardContent({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-6 py-4 border-t border-[var(--border-subtle)]', className)}
      {...props}
    >
      {children}
    </div>
  )
}
