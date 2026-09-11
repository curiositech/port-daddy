/**
 * A chapter number as a filled square of its part's ink, paper-coloured type.
 *
 * This is the Swiss edition's own device and the reason the rest of the
 * page needs almost no rules: a solid block reads as a mark at any size, so
 * a column of them is navigable at a glance, and the colour carries the
 * part without a legend. Square, flat, no border — the colour edge IS the
 * edge.
 */
export interface PartNumeralProps {
  n: number
  /** The part slug (e.g. "machine", "operator") — see textbook.json. */
  slug: string
  size?: 'md' | 'lg'
}

export function PartNumeral({ n, slug, size = 'md' }: PartNumeralProps) {
  return (
    <span
      className={
        size === 'lg'
          ? 'grid h-14 w-14 shrink-0 place-items-center font-mono text-[26px] font-bold leading-none tabular-nums tracking-[-0.04em]'
          : 'grid h-8 w-8 shrink-0 place-items-center font-mono text-[15px] font-bold leading-none tabular-nums tracking-[-0.03em]'
      }
      style={{ background: `var(--part-${slug})`, color: `var(--part-${slug}-on)` }}
      aria-hidden="true"
    >
      {String(n).padStart(2, '0')}
    </span>
  )
}
