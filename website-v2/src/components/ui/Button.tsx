import * as React from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'ghost' | 'code' | 'outline'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: [
    'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)]',
    'border border-[var(--btn-primary-border)]',
    'shadow-[var(--btn-primary-shadow)]',
    'hover:bg-[var(--btn-primary-bg-hover)]',
    'transition-all duration-[var(--p-transition-base)]',
    'font-semibold',
  ].join(' '),
  ghost: [
    'bg-[var(--btn-ghost-bg)] text-[var(--btn-ghost-text)]',
    'border border-[var(--btn-ghost-border)]',
    'hover:bg-[var(--btn-ghost-bg-hover)]',
    'transition-all duration-[var(--p-transition-base)]',
    'font-medium',
  ].join(' '),
  outline: [
    'bg-transparent text-[var(--brand-primary)]',
    'border border-[var(--brand-primary)]',
    'hover:bg-[var(--interactive-hover)]',
    'transition-all duration-[var(--p-transition-base)]',
    'font-semibold',
  ].join(' '),
  code: [
    'bg-[var(--btn-code-bg)] text-[var(--btn-code-text)]',
    'font-mono text-sm',
    'hover:bg-[var(--btn-code-bg-hover)]',
    'transition-all duration-[var(--p-transition-base)]',
  ].join(' '),
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-[var(--p-radius-md)]',
  md: 'px-4 py-2 text-base rounded-[var(--p-radius-lg)]',
  lg: 'px-6 py-3 text-lg rounded-[var(--p-radius-xl)]',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2',
        'cursor-pointer select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
