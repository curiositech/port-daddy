import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Surface — the fundamental neumorphic container.
 * Every visible area on the page is a Surface.
 * Three depth levels: raised (default), flat, inset.
 */
const surfaceVariants = cva(
  'transition-all duration-[var(--duration-normal)]',
  {
    variants: {
      depth: {
        raised: '',   // Extruded from the page — cards, panels
        flat: '',     // Level with page — subtle presence
        inset: '',    // Pressed into the page — inputs, code blocks
        floating: '', // Above everything — modals, tooltips
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
      radius: '2xl',
      padding: 'md',
      interactive: false,
    },
  }
)

// Depth → inline style map (CSS custom properties for neumorphic shadows)
const depthStyles: Record<string, React.CSSProperties> = {
  raised: {
    background: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-raised)',
  },
  flat: {
    background: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-flat)',
  },
  inset: {
    background: 'var(--surface-sunken)',
    boxShadow: 'var(--shadow-inset)',
  },
  floating: {
    background: 'var(--surface-raised)',
    boxShadow: 'var(--shadow-raised)',
    zIndex: 50,
  },
}

const interactiveHoverStyles: Record<string, React.CSSProperties> = {
  raised: { boxShadow: 'var(--shadow-flat)' },
  flat: { boxShadow: 'var(--shadow-pressed)' },
  inset: {},
  floating: { boxShadow: 'var(--shadow-sm)' },
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

export { Surface, surfaceVariants }
export type { SurfaceProps }
