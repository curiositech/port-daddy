import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none cursor-pointer select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground border border-primary/80 shadow-sm hover:bg-primary/90 font-semibold',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium',
        ghost:
          'bg-transparent text-muted-foreground border border-transparent hover:bg-accent hover:text-accent-foreground font-medium',
        outline:
          'bg-transparent text-primary border border-primary hover:bg-accent hover:text-accent-foreground font-semibold',
        code:
          'bg-muted text-foreground font-mono text-sm hover:bg-muted/80',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold',
        link:
          'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 py-1.5 text-sm rounded-md',
        md: 'h-9 px-4 py-2 text-base rounded-lg',
        lg: 'h-10 px-6 py-3 text-lg rounded-xl',
        icon: 'size-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
)

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

function Button({
  className,
  variant = 'primary',
  size = 'md',
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
