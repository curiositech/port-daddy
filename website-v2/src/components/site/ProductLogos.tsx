import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

export type ProductLogoKey = 'codex' | 'claude' | 'ollama' | 'cursor' | 'windsurf'

const productLogoMeta = {
  codex: { label: 'Codex', company: 'OpenAI' },
  claude: { label: 'Claude', company: 'Anthropic' },
  ollama: { label: 'Ollama', company: 'Ollama' },
  cursor: { label: 'Cursor', company: 'Anysphere' },
  windsurf: { label: 'Windsurf', company: 'Cognition' },
} as const satisfies Record<ProductLogoKey, { label: string; company: string }>

const productLogoSizeClass = {
  compact: {
    lockup: 'min-h-7 gap-1.5 px-2 py-1 text-[0.72rem]',
    mark: 'h-4 w-4',
  },
  default: {
    lockup: 'min-h-9 gap-2 px-2.5 py-1.5 text-[0.78rem]',
    mark: 'h-5 w-5',
  },
} as const

type ProductLogoSize = keyof typeof productLogoSizeClass

interface ProductLogoLockupProps {
  product: ProductLogoKey
  className?: string
  labelClassName?: string
  size?: ProductLogoSize
  label?: string
}

export function ProductLogoLockup({
  product,
  className,
  labelClassName,
  size = 'default',
  label = productLogoMeta[product].label,
}: ProductLogoLockupProps) {
  const meta = productLogoMeta[product]
  const sizeClass = productLogoSizeClass[size]

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center border border-[var(--border-default)] bg-[var(--surface-raised)] font-sans font-black uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]',
        sizeClass.lockup,
        className,
      )}
      data-product-logo={product}
      aria-label={`${meta.company} ${meta.label}`}
      title={`${meta.company} ${meta.label}`}
    >
      <ProductLogoMark product={product} className={sizeClass.mark} />
      <span className={labelClassName}>{label}</span>
    </span>
  )
}

export function ProductLogoMark({
  product,
  className,
}: {
  product: ProductLogoKey
  className?: string
}) {
  const markClassName = 'h-full w-full'

  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', className)} aria-hidden="true">
      {product === 'codex' && <CodexMark className={markClassName} />}
      {product === 'claude' && <ClaudeMark className={markClassName} />}
      {product === 'ollama' && <OllamaMark className={markClassName} />}
      {product === 'cursor' && <CursorMark className={markClassName} />}
      {product === 'windsurf' && <WindsurfMark className={markClassName} />}
    </span>
  )
}

function CodexMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3.4 18.9 7.3v7.4L12 20.6l-6.9-5.9V7.3L12 3.4Z" stroke="var(--brand-accent)" strokeWidth="2" />
      <path d="M7.1 8.9 12 6.1l4.9 2.8v5.6L12 17.9l-4.9-3.4V8.9Z" stroke="var(--brand-primary)" strokeWidth="1.7" />
      <path d="M12 6.1v11.8M7.1 8.9l9.8 5.6M16.9 8.9l-9.8 5.6" stroke="var(--text-primary)" strokeWidth="1.2" strokeLinecap="round" opacity="0.78" />
    </svg>
  )
}

function ClaudeMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 2.6 14.3 9.7 21.5 12 14.3 14.3 12 21.4 9.7 14.3 2.5 12 9.7 9.7 12 2.6Z" fill="var(--status-warning)" />
      <path d="M12 7.7 13.1 10.9 16.4 12 13.1 13.1 12 16.3 10.9 13.1 7.6 12 10.9 10.9 12 7.7Z" fill="var(--surface-base)" />
    </svg>
  )
}

function OllamaMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M7.2 21V10.4L9.1 4.1l2.4 4.3h1l2.4-4.3 1.9 6.3V21" stroke="var(--text-primary)" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M7.2 11.4h9.6M8.7 16.2h6.6" stroke="var(--text-primary)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 13.5h.1M14 13.5h.1" stroke="var(--brand-accent)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function CursorMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M4.5 3.7 20.1 12 13.9 14.2 11.5 20.3 4.5 3.7Z" fill="var(--text-primary)" />
      <path d="M9.4 9.1 16.2 12.2 12.1 13.4 10.6 17.1 9.4 9.1Z" fill="var(--surface-base)" />
      <path d="M13.2 14.1 17.6 18.5" stroke="var(--brand-primary)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function WindsurfMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3.3 15.6c3.2-3.9 6.8-5.3 10.8-4.2 2 .6 3.9.5 5.6-.3" stroke="var(--brand-primary)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M5.2 19.2c3.6-2.2 7-2.8 10.3-1.6 1.8.6 3.5.6 5.2-.1" stroke="var(--brand-accent)" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M9.1 4.2 15.8 8H6.9l2.2-3.8Z" fill="var(--text-primary)" />
    </svg>
  )
}
