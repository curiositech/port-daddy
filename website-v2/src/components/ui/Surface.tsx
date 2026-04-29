import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Surface - the legacy tokenized surface container.
 * New public-site sections should prefer the primitives in components/site.
 * Depth now controls flat surface contrast, never recessed or raised relief.
 */
const surfaceVariants = cva(
  'transition-all duration-[var(--duration-normal)]',
  {
    variants: {
      depth: {
        raised: '',
        flat: '',
        inset: '',
        floating: '',
      },
      radius: {
        none: 'rounded-none',
        sm: 'rounded-[var(--radius-sm)]',
        md: 'rounded-[var(--radius-md)]',
        lg: 'rounded-[var(--radius-lg)]',
        xl: 'rounded-[var(--radius-xl)]',
        '2xl': 'rounded-[var(--radius-2xl)]',
        '3xl': 'rounded-[var(--radius-3xl)]',
        '4xl': 'rounded-[var(--radius-4xl)]',
        full: 'rounded-full',
      },
      padding: {
        none: 'p-0',
        sm: 'p-[var(--space-3)]',
        md: 'p-[var(--space-5)]',
        lg: 'p-[var(--space-8)]',
        xl: 'p-[var(--surface-padding-xl)]',
      },
      interactive: {
        true: 'cursor-pointer',
        false: '',
      },
    },
    defaultVariants: {
      depth: 'raised',
      radius: 'lg',
      padding: 'md',
      interactive: false,
    },
  }
)

// Depth -> flat framed surfaces using design-system tokens.
const depthStyles: Record<string, React.CSSProperties> = {
  raised: {
    background: 'var(--surface-raised)',
    border: '2px solid var(--border-strong)',
    boxShadow: 'var(--neo-shadow-card)',
    transform: 'translate(0, 0)',
  },
  flat: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-default)',
    boxShadow: 'none',
  },
  inset: {
    background: 'var(--surface-sunken)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--neo-shadow-xs)',
  },
  floating: {
    background: 'var(--surface-raised)',
    border: '2px solid var(--border-strong)',
    boxShadow: 'var(--neo-shadow-pop)',
    transform: 'translate(0, 0)',
    zIndex: 50,
  },
}

const interactiveHoverStyles: Record<string, React.CSSProperties> = {
  raised: { background: 'var(--surface-strong)', boxShadow: 'var(--neo-shadow-pop)', transform: 'translate(-2px, -2px)' },
  flat: { background: 'var(--surface-strong)', boxShadow: 'none' },
  inset: { background: 'var(--surface-raised)', boxShadow: 'none' },
  floating: { background: 'var(--surface-strong)', boxShadow: 'var(--neo-shadow-hero)', transform: 'translate(-2px, -2px)' },
}

interface SurfaceProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ depth = 'raised', radius, padding, interactive, className, style, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const d = depth ?? 'raised'
    return (
      <div
        ref={ref}
        className={cn(surfaceVariants({ depth, radius, padding, interactive }), className)}
        style={{ ...depthStyles[d], ...style }}
        onMouseEnter={(e) => {
          if (interactive) Object.assign(e.currentTarget.style, interactiveHoverStyles[d])
          onMouseEnter?.(e)
        }}
        onMouseLeave={(e) => {
          if (interactive) Object.assign(e.currentTarget.style, depthStyles[d])
          onMouseLeave?.(e)
        }}
        {...props}
      />
    )
  }
)
Surface.displayName = 'Surface'

export { Surface }
export type { SurfaceProps }
