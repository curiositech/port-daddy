import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge — compact tokenized label for status, categories, and filters.
 * Uses semantic tokens from the public-site design system.
 */
const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center justify-center gap-1',
    'rounded-[var(--radius-sm)] text-xs font-semibold uppercase tracking-wider',
    'whitespace-nowrap transition-all duration-200',
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
        sm: 'px-2 py-px text-[12px]',
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

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: 'var(--surface-overlay)',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'none',
    color: 'var(--text-primary)',
  },
  red: {
    background: 'color-mix(in srgb, var(--status-error) 15%, var(--surface-base))',
    border: '1px solid color-mix(in srgb, var(--status-error) 28%, var(--border-subtle))',
    boxShadow: 'none',
    color: 'var(--status-error-on-tint)',
  },
  teal: {
    background: 'color-mix(in srgb, var(--brand-secondary) 15%, var(--surface-base))',
    border: '1px solid color-mix(in srgb, var(--brand-secondary) 28%, var(--border-subtle))',
    boxShadow: 'none',
    color: 'var(--brand-secondary)',
  },
  gold: {
    background: 'color-mix(in srgb, var(--brand-accent) 20%, var(--surface-base))',
    border: '1px solid color-mix(in srgb, var(--brand-accent) 30%, var(--border-subtle))',
    boxShadow: 'none',
    color: 'var(--brand-accent-on-tint)',
  },
  success: {
    background: 'color-mix(in srgb, var(--status-success) 15%, var(--surface-base))',
    border: '1px solid color-mix(in srgb, var(--status-success) 28%, var(--border-subtle))',
    boxShadow: 'none',
    color: 'var(--status-success-on-tint)',
  },
  warning: {
    background: 'color-mix(in srgb, var(--status-warning) 15%, var(--surface-base))',
    border: '1px solid color-mix(in srgb, var(--status-warning) 28%, var(--border-subtle))',
    boxShadow: 'none',
    color: 'var(--status-warning-on-tint)',
  },
  outline: {
    background: 'transparent',
    border: '1px solid var(--border-default)',
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

export { Badge }
export type { BadgeProps }
