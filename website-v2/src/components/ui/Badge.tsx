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
    'rounded-[var(--radius-sm)] font-semibold uppercase tracking-wider',
    // Badges are uppercase, tracked-out labels; --type-meta-size (13px) is the floor.
    'text-[length:var(--type-meta-size)]',
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
        sm: 'px-2 py-px',
        md: 'px-2.5 py-0.5',
        lg: 'px-3 py-1',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
)

// Tone variants use design tokens only: a flat surface fill, a tone-colored
// border, and tone-colored text. The previous color-mix() tints are replaced
// with the status/brand color on the border and the matching *-on-tint text.
const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: 'var(--surface-overlay)',
    border: '1px solid var(--border-subtle)',
    boxShadow: 'none',
    color: 'var(--text-primary)',
  },
  red: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--status-error)',
    boxShadow: 'none',
    color: 'var(--status-error-on-tint)',
  },
  teal: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--brand-secondary)',
    boxShadow: 'none',
    color: 'var(--brand-secondary)',
  },
  gold: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--brand-accent)',
    boxShadow: 'none',
    color: 'var(--brand-accent-on-tint)',
  },
  success: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--status-success)',
    boxShadow: 'none',
    color: 'var(--status-success-on-tint)',
  },
  warning: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--status-warning)',
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
