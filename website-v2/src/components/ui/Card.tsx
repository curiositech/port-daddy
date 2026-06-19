import * as React from 'react'
import { cn } from '@/lib/utils'
import { Surface, type SurfaceProps } from './Surface'

type CardVariant = 'default' | 'glass' | 'elevated' | 'inset'

const variantToDepth: Record<CardVariant, SurfaceProps['depth']> = {
  default: 'raised',
  elevated: 'raised',
  glass: 'flat',
  inset: 'inset',
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant
  interactive?: boolean
}

function Card({ variant = 'default', interactive = false, className, style, ...props }: CardProps) {
  const depth = variantToDepth[variant]
  const glassStyle: React.CSSProperties | undefined = variant === 'glass'
    ? { background: 'var(--surface-glass)', backdropFilter: 'blur(12px)' }
    : undefined

  return (
    <Surface
      depth={depth}
      radius="2xl"
      padding="none"
      interactive={interactive}
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 py-6 text-[var(--text-primary)]',
        className
      )}
      style={{ ...glassStyle, ...style }}
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
      className={cn('text-sm text-[var(--text-muted)]', className)}
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
