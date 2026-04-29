import { forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2',
    'cursor-pointer select-none whitespace-nowrap border-2 border-[var(--border-strong)]',
    'font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
    'transition-all duration-[120ms]',
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
    base: { background: 'var(--text-primary)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(0, 0)' },
    hover: { background: 'var(--brand-primary)', boxShadow: 'var(--neo-shadow-pop)', transform: 'translate(-1px, -1px)' },
  },
  secondary: {
    base: { background: 'var(--surface-raised)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(0, 0)' },
    hover: { background: 'var(--surface-strong)', boxShadow: 'var(--neo-shadow-pop)', transform: 'translate(-1px, -1px)' },
  },
  ghost: {
    base: { background: 'transparent', boxShadow: 'none', borderColor: 'transparent', transform: 'translate(0, 0)' },
    hover: { background: 'var(--surface-raised)', borderColor: 'var(--border-strong)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(-1px, -1px)' },
  },
  code: {
    base: { background: 'transparent', boxShadow: 'var(--neo-shadow-xs)', borderColor: 'var(--code-comment)', transform: 'translate(0, 0)' },
    hover: { background: 'var(--code-header-bg)', borderColor: 'var(--code-text)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(-1px, -1px)' },
  },
  danger: {
    base: { background: 'var(--status-error)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(0, 0)' },
    hover: { background: 'var(--status-error)', boxShadow: 'var(--neo-shadow-pop)', transform: 'translate(-1px, -1px)' },
  },
  outline: {
    base: { background: 'var(--brand-accent)', boxShadow: 'var(--neo-shadow-control)', transform: 'translate(0, 0)' },
    hover: { background: 'var(--brand-accent)', boxShadow: 'var(--neo-shadow-pop)', transform: 'translate(-1px, -1px)' },
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
        onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
          Object.assign(e.currentTarget.style, {
            ...styles.base,
            boxShadow: 'var(--neo-shadow-xs)',
            transform: 'translate(2px, 2px)',
          })
        }}
        onMouseUp={(e: React.MouseEvent<HTMLButtonElement>) => {
          Object.assign(e.currentTarget.style, { ...styles.base, ...styles.hover })
        }}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button }
export type { ButtonProps }
