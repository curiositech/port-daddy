import * as React from 'react'

import { cn } from '@/lib/utils'

type CardVariant = 'default' | 'glass' | 'elevated' | 'inset'

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
}

function Card({ variant = 'default', className, style, ...props }: CardProps) {
  const variantStyles: Record<CardVariant, React.CSSProperties> = {
    default: {
      background: 'var(--bg-surface)',
      boxShadow: 'var(--shadow-neu-raised)',
    },
    glass: {
      background: 'var(--bg-glass)',
      boxShadow: 'var(--shadow-neu-sm)',
      backdropFilter: 'blur(12px)',
    },
    elevated: {
      background: 'var(--bg-surface)',
      boxShadow: 'var(--shadow-neu-raised)',
    },
    inset: {
      background: 'var(--bg-overlay)',
      boxShadow: 'var(--shadow-neu-inset)',
    },
  }

  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-2xl py-6 text-[var(--text-primary)] transition-all duration-200',
        className
      )}
      style={{ ...variantStyles[variant], ...style }}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 [.border-b]:pb-6',
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6', className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
}
export type { CardProps }
