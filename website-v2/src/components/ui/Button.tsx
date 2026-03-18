import * as React from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'code'
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
    'hover:shadow-[0_6px_24px_rgba(20,184,166,0.4)]',
    'transition-all duration-200',
    'font-semibold',
  ].join(' '),
  secondary: [
    'bg-[var(--bg-surface)] text-[var(--text-primary)]',
    'border border-[var(--border-default)]',
    'shadow-[var(--shadow-sm)]',
    'hover:bg-[var(--bg-surface-hover)]',
    'hover:border-[var(--border-strong)]',
    'transition-all duration-200',
    'font-medium',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--text-secondary)]',
    'border border-transparent',
    'hover:bg-[var(--interactive-hover)]',
    'hover:text-[var(--text-primary)]',
    'transition-all duration-200',
    'font-medium',
  ].join(' '),
  outline: [
    'bg-transparent text-[var(--brand-primary)]',
    'border border-[var(--brand-primary)]',
    'hover:bg-[var(--interactive-active)]',
    'transition-all duration-200',
    'font-semibold',
  ].join(' '),
  code: [
    'bg-[var(--bg-code)] text-[var(--text-primary)]',
    'font-mono text-sm',
    'border border-[var(--border-subtle)]',
    'hover:bg-[var(--bg-surface-hover)]',
    'hover:border-[var(--border-default)]',
    'transition-all duration-200',
  ].join(' '),
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm rounded-md gap-1.5',
  md: 'px-4 py-2 text-base rounded-lg gap-2',
  lg: 'px-6 py-3 text-lg rounded-xl gap-2.5',
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
        'inline-flex items-center justify-center',
        'cursor-pointer select-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
        'disabled:opacity-50 disabled:pointer-events-none',
        'active:scale-[0.98]',
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
