import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'cursor-pointer select-none whitespace-nowrap border-2 border-[var(--border-strong)]',
    'font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
    'transition-all duration-[180ms]',
    'disabled:pointer-events-none disabled:opacity-50',
    'focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'text-[var(--text-inverse)]',
        secondary: 'text-[var(--text-primary)]',
        ghost: 'text-[var(--text-primary)]',
        code: 'text-[var(--code-text)]',
        danger: 'text-[var(--text-inverse)]',
        outline: 'text-[var(--brand-accent-foreground)]',
      },
      size: {
        sm: 'px-3 py-2',
        md: 'px-4 py-2.5',
        lg: 'px-5 py-3',
        icon: 'h-10 w-10 p-0',
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
    base: { background: 'var(--text-primary)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)', transform: 'translate(3px, 3px)' },
  },
  secondary: {
    base: { background: 'var(--surface-raised)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)', transform: 'translate(3px, 3px)' },
  },
  ghost: {
    base: { background: 'transparent', boxShadow: 'none', borderColor: 'transparent' },
    hover: { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', boxShadow: 'var(--shadow-sm)' },
  },
  code: {
    base: { background: 'transparent', boxShadow: 'none', borderColor: 'var(--code-comment)' },
    hover: { background: 'var(--code-header-bg)', borderColor: 'var(--code-text)', boxShadow: 'none' },
  },
  danger: {
    base: { background: 'var(--status-error)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)', transform: 'translate(3px, 3px)' },
  },
  outline: {
    base: { background: 'var(--brand-accent)', boxShadow: 'var(--shadow-sm)' },
    hover: { boxShadow: 'var(--shadow-flat)', transform: 'translate(3px, 3px)' },
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
