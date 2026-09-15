import * as React from 'react'

/**
 * A flat block of a part's ink, carrying paper-coloured content.
 *
 * The Book sets a part opener as a slab of the part's ink carrying an
 * oversized numeral and the title in paper; this is that device at web
 * scale, generalized to any block-level content. `slug` names the part —
 * the same slug every part carries in textbook.json — and the block colour
 * and its paper-coloured foreground are derived from it mechanically:
 * `var(--part-${slug})` / `var(--part-${slug}-on)`. There is no lookup
 * table here to drift from the data; a part that changes colour changes
 * these two role tokens once, in tokens.roles.css, and every Slab follows.
 *
 * No border, no radius, no shadow: the colour edge IS the edge. A Slab
 * always paints its own ground, so it always marks itself `on-block` — the
 * global rule (index.css) that makes a heading placed inside inherit the
 * block's foreground instead of printing the page's default ink on top of
 * a saturated block.
 */
export type SlabOwnProps<E extends React.ElementType> = {
  /** The part slug (e.g. "machine", "operator") — see textbook.json. */
  slug: string
  /** The element (or component) to render as. Defaults to a plain div. */
  as?: E
  children?: React.ReactNode
}

export type SlabProps<E extends React.ElementType = 'div'> = SlabOwnProps<E> &
  Omit<React.ComponentPropsWithoutRef<E>, keyof SlabOwnProps<E> | 'color'>

export function Slab<E extends React.ElementType = 'div'>({
  slug,
  as,
  className,
  style,
  children,
  ...rest
}: SlabProps<E>) {
  const Component = (as ?? 'div') as React.ElementType
  return (
    <Component
      className={className ? `on-block ${className}` : 'on-block'}
      style={{ background: `var(--part-${slug})`, color: `var(--part-${slug}-on)`, ...style }}
      {...rest}
    >
      {children}
    </Component>
  )
}
