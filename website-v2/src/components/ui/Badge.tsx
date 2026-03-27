import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Badge — neumorphic inset pill for status, categories, and labels.
 * Uses semantic tokens from the harbor heritage design system.
 */
const badgeVariants = cva(
  [
    'inline-flex w-fit shrink-0 items-center justify-center gap-1',
    'rounded-full text-xs font-semibold uppercase tracking-wider',
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

const variantStyles: Record<string, React.CSSProperties> = {
  default: {
    background: 'var(--surface-sunken)',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--text-secondary)',
  },
  red: {
    background: 'color-mix(in srgb, var(--brand-primary) 15%, var(--surface-base))',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--brand-primary)',
  },
  teal: {
    background: 'color-mix(in srgb, var(--brand-secondary) 15%, var(--surface-base))',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--brand-secondary)',
  },
  gold: {
    background: 'color-mix(in srgb, var(--brand-accent) 20%, var(--surface-base))',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--brand-accent)',
  },
  success: {
    background: 'color-mix(in srgb, var(--status-success) 15%, var(--surface-base))',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--status-success)',
  },
  warning: {
    background: 'color-mix(in srgb, var(--status-warning) 15%, var(--surface-base))',
    boxShadow: 'var(--shadow-pressed)',
    color: 'var(--status-warning)',
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

export { Badge, badgeVariants }
export type { BadgeProps }
