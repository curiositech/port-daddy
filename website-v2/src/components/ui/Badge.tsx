import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge — legacy compatibility wrapper for status, category, and label chips.
 * Old pages still call Badge directly, so keep the API stable but map it onto
 * the hard-edged public shell instead of the earlier soft pill treatment.
 */
const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center justify-center gap-1',
    'rounded-none font-sans text-xs font-semibold uppercase leading-none tracking-[var(--tracking-meta)]',
    'whitespace-nowrap transition-[background-color,color,box-shadow] duration-200',
    '[&>svg]:pointer-events-none [&>svg]:size-3',
  ].join(' '),
  {
    variants: {
      variant: {
        default: '',
        red: '',
        teal: '',
        gold: '',
        success: '',
        warning: '',
        outline: '',
      },
      size: {
        sm: 'px-2 py-px text-[10px]',
        md: 'px-2.5 py-0.5',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

const hardFrame = '0 0 0 2px var(--border-strong)'

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: 'color-mix(in srgb, var(--surface-raised) 72%, var(--surface-strong))',
    boxShadow: hardFrame,
    color: 'var(--text-secondary)',
  },
  red: {
    background: 'color-mix(in srgb, var(--status-error) 84%, var(--surface-raised))',
    boxShadow: hardFrame,
    color: 'var(--text-inverse)',
  },
  teal: {
    background: 'var(--brand-primary)',
    boxShadow: hardFrame,
    color: 'var(--brand-primary-foreground)',
  },
  gold: {
    background: 'var(--brand-accent)',
    boxShadow: hardFrame,
    color: 'var(--brand-accent-foreground-muted)',
  },
  success: {
    background: 'color-mix(in srgb, var(--status-success) 84%, var(--surface-raised))',
    boxShadow: hardFrame,
    color: 'var(--text-inverse)',
  },
  warning: {
    background: 'color-mix(in srgb, var(--status-warning) 72%, var(--surface-raised))',
    boxShadow: hardFrame,
    color: 'var(--text-primary)',
  },
  outline: {
    background: 'transparent',
    boxShadow: hardFrame,
    color: 'var(--text-secondary)',
  },
}

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant = 'default', size = 'md', style, ...props }: BadgeProps) {
  const v = variant ?? 'default'
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      style={{ ...variantStyles[v], ...style }}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
export type { BadgeProps }
