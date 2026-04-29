import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Surface — legacy compatibility wrapper for older page sections.
 * Keep the public API stable while remapping depth semantics onto the
 * hard-edged public shell so older pages stop rendering as soft chrome.
 */
const surfaceVariants = cva(
  'will-change-transform transition-[transform,box-shadow,background-color] duration-[var(--duration-normal)]',
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

const hardFrame = '0 0 0 2px var(--border-strong)'

// Depth → inline style map for the legacy Surface API.
const depthStyles: Record<string, CSSProperties> = {
  raised: {
    background: 'var(--surface-raised)',
    boxShadow: `${hardFrame}, var(--shadow-raised)`,
    transform: 'translate(0, 0)',
  },
  flat: {
    background: 'var(--surface-raised)',
    boxShadow: `${hardFrame}, var(--shadow-flat)`,
    transform: 'translate(0, 0)',
  },
  inset: {
    background: 'color-mix(in srgb, var(--surface-strong) 72%, var(--surface-raised))',
    boxShadow: `${hardFrame}, var(--shadow-pressed)`,
    transform: 'translate(0, 0)',
  },
  floating: {
    background: 'var(--surface-raised)',
    boxShadow: `${hardFrame}, 8px 8px 0 var(--border-strong)`,
    zIndex: 50,
    position: 'relative',
    transform: 'translate(0, 0)',
  },
}

const interactiveHoverStyles: Record<string, CSSProperties> = {
  raised: {
    boxShadow: `${hardFrame}, var(--shadow-flat)`,
    transform: 'translate(5px, 5px)',
  },
  flat: {
    boxShadow: `${hardFrame}, var(--shadow-sm)`,
    transform: 'translate(-3px, -3px)',
  },
  inset: {
    background: 'var(--surface-raised)',
    boxShadow: `${hardFrame}, var(--shadow-flat)`,
    transform: 'translate(-2px, -2px)',
  },
  floating: {
    boxShadow: `${hardFrame}, var(--shadow-raised)`,
    transform: 'translate(3px, 3px)',
  },
}

interface SurfaceProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof surfaceVariants> {}

const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ depth = 'raised', radius, padding, interactive, className, style, onMouseEnter, onMouseLeave, ...props }, ref) => {
    const d = depth ?? 'raised'
    const baseStyles = { ...depthStyles[d], ...style }
    return (
      <div
        ref={ref}
        className={cn(surfaceVariants({ depth, radius, padding, interactive }), className)}
        style={baseStyles}
        onMouseEnter={(e) => {
          if (interactive) Object.assign(e.currentTarget.style, { ...baseStyles, ...interactiveHoverStyles[d] })
          onMouseEnter?.(e)
        }}
        onMouseLeave={(e) => {
          if (interactive) Object.assign(e.currentTarget.style, baseStyles)
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
