import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'font-semibold cursor-pointer select-none whitespace-nowrap',
    'transition-all duration-[200ms]',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'text-[var(--text-inverse)]',
        secondary: 'text-[var(--text-primary)]',
        ghost: 'text-[var(--text-muted)] hover:text-[var(--text-primary)]',
        danger: 'text-[var(--text-inverse)]',
        outline: 'text-[var(--text-primary)]',
      },
      size: {
        sm: 'text-xs px-3 py-1 rounded-lg',
        md: 'text-sm px-5 py-2 rounded-xl',
        lg: 'text-sm px-6 py-2.5 rounded-xl',
        icon: 'w-10 h-10 rounded-xl',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

const variantStyles: Record<string, {
  base: React.CSSProperties
  hover: React.CSSProperties
}> = {
  primary: {
    base: { background: 'var(--brand-primary)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)' },
  },
  secondary: {
    base: { background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)' },
  },
  ghost: {
    base: { background: 'transparent' },
    hover: { background: 'var(--interactive-hover)' },
  },
  danger: {
    base: { background: 'var(--status-error)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)' },
  },
  outline: {
    base: { background: 'transparent', border: '1px solid var(--border-default)' },
    hover: { background: 'var(--interactive-hover)' },
  },
}

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size, asChild = false, className, style, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : 'button'
    const v = variant ?? 'primary'
    const styles = variantStyles[v]
    return (
      <Comp
        ref={ref as React.Ref<HTMLButtonElement>}
        className={cn(buttonVariants({ variant, size }), className)}
        style={{ ...styles.base, ...style }}
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
          Object.assign(e.currentTarget.style, { ...styles.base, ...styles.hover })
        }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
          Object.assign(e.currentTarget.style, styles.base)
        }}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
export type { ButtonProps }
