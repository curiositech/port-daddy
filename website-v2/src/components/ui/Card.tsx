import * as React from 'react'
import { cn } from '@/lib/utils'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'elevated' | 'outline'
  hover?: boolean
}

export function Card({
  variant = 'default',
  hover = false,
  className,
  children,
  ...props
}: CardProps) {
  const variants = {
    default: 'bg-[var(--bg-surface)] border-[var(--border-subtle)]',
    elevated: 'bg-[var(--bg-surface)] border-[var(--border-subtle)] shadow-[var(--shadow-md)]',
    outline: 'bg-transparent border-[var(--border-default)]',
  }

  return (
    <div
      className={cn(
        'rounded-xl border',
        'transition-all duration-200',
        variants[variant],
        hover && 'hover:border-[var(--border-default)] hover:shadow-[var(--shadow-md)]',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, children, ...props }: CardHeaderProps) {
  return (
    <div className={cn('px-6 pt-6 pb-4', className)} {...props}>
      {children}
    </div>
  )
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('px-6 py-4', className)} {...props}>
      {children}
    </div>
  )
}

interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardFooter({ className, children, ...props }: CardFooterProps) {
  return (
    <div className={cn('px-6 pt-4 pb-6', className)} {...props}>
      {children}
    </div>
  )
}
