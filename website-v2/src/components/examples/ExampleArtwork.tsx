import type { ExampleDoc } from '@/data/examples'

interface ExampleArtworkProps {
  example: Pick<ExampleDoc, 'eyebrow' | 'title' | 'visual'>
  priority?: boolean
  className?: string
  variant?: 'card' | 'hero'
}

export function ExampleArtwork({ example, priority = false, className = '', variant = 'card' }: ExampleArtworkProps) {
  const sizes = variant === 'hero' ? '(min-width: 1280px) 48rem, 100vw' : '(min-width: 1024px) 22rem, 100vw'

  return (
    <figure
      className={[
        'group overflow-hidden border-2 border-[var(--border-strong)] bg-[var(--surface-raised)]',
        'shadow-[8px_8px_0_color-mix(in_srgb,var(--border-strong)_16%,transparent)]',
        className,
      ].join(' ')}
    >
      <picture>
        {example.visual.webpSrc ? <source srcSet={example.visual.webpSrc} type="image/webp" /> : null}
        <img
          src={example.visual.src}
          alt={example.visual.alt}
          loading="eager"
          decoding="async"
          data-priority={priority ? 'true' : undefined}
          sizes={sizes}
          className="aspect-[16/9] w-full object-cover transition duration-500 ease-out group-hover:scale-[1.025]"
        />
      </picture>
    </figure>
  )
}
