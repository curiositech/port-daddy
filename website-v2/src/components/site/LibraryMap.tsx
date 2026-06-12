import { Link } from 'react-router-dom'
import { ArrowRight, BadgeCheck, FileText } from 'lucide-react'
import { findWhitePaperByChapter, type WhitePaper } from '@/data/whitePapers'

/**
 * The Harbor Library map — reader-first information architecture.
 *
 * Two hand-built, brand-themed diagrams render the structure that the old page
 * buried in prose:
 *
 *   1. `ReadingOrderMap` — the reading-order DAG (above the fold). The explain
 *      spine II → I → III → IV is drawn as solid cobalt edges; the three
 *      proofs (V·VI·VII) discharge load-bearing seams, drawn as dashed accent
 *      edges into the chapters they prove. Every node is a real <Link> to that
 *      chapter, so the map *is* the navigation.
 *   2. `NestedLayerMap` — concentric boxes showing each layer reading truth
 *      from the one inside it: L0/L1 (II) ⊂ L2 (I) ⊂ L3-bridge (III) ⊂
 *      L3-market (IV), with the proofs annotated as the things that anchor the
 *      seams.
 *
 * Both are pure SVG/HTML styled with the site's CSS variables (cobalt =
 * --brand-primary, teal = --brand-accent, ink = --text-primary). No hardcoded
 * hex, so light and dark are both correct for free via the token cascade — no
 * MutationObserver, no re-render-on-theme dance. The brutalist language is
 * carried by 2px --border-strong frames, exactly like the rest of the site.
 *
 * The structure here is authored from the real `crossRefs` in whitePapers.ts;
 * the chapter titles/layers/maturity are read live from that data so the map
 * never drifts from the chapters it points at.
 */

/** A node on the reading-order DAG, placed on a 12-col × N-row logical grid. */
interface MapNode {
  chapter: string
  /** Short label for the node face (the data title can be long). */
  short: string
  /** 'spine' = an explaining chapter on the read-order ladder; 'proof' = a proving chapter. */
  kind: 'spine' | 'proof'
  /** Read-order index for the spine (1-based); proofs share the order of what they prove. */
  spineIndex?: number
  /** Grid placement, 0-based. col is the left edge in a 12-col track; rows are equal-height. */
  col: number
  row: number
}

/**
 * The map, authored from crossRefs. The spine reads left-to-right on the top
 * row; the three proofs sit on the row below, each under the seam it anchors.
 */
const MAP_NODES: MapNode[] = [
  { chapter: 'II', short: 'Single-Writer Kernel', kind: 'spine', spineIndex: 1, col: 0, row: 0 },
  { chapter: 'I', short: 'The Legible Swarm', kind: 'spine', spineIndex: 2, col: 3, row: 0 },
  { chapter: 'III', short: 'From Spawn to Person', kind: 'spine', spineIndex: 3, col: 6, row: 0 },
  { chapter: 'IV', short: 'The Harbor Economy', kind: 'spine', spineIndex: 4, col: 9, row: 0 },
  { chapter: 'V', short: 'The Anchor Protocol', kind: 'proof', col: 1, row: 1 },
  { chapter: 'VI', short: 'The Bonded Commons', kind: 'proof', col: 6, row: 1 },
  { chapter: 'VII', short: 'The Federated Harbor', kind: 'proof', col: 9, row: 1 },
]

/**
 * Edges. `spine` edges (solid cobalt) are the read order; `proof` edges
 * (dashed teal) point from a proving chapter to the chapter it discharges.
 * `label` is the verb that makes the graph read as one argument.
 */
interface MapEdge {
  from: string
  to: string
  kind: 'spine' | 'proof'
}

const MAP_EDGES: MapEdge[] = [
  { from: 'II', to: 'I', kind: 'spine' },
  { from: 'I', to: 'III', kind: 'spine' },
  { from: 'III', to: 'IV', kind: 'spine' },
  // V — the Anchor Protocol — proves the kernel (II) and the cross-harbor
  // capability-transfer ceremony (IV). III *assumes* V's non-forgeable identity
  // (a dependency, per whitePapers.ts crossRefs), which is not a proof discharge,
  // so it is intentionally NOT drawn as a proof edge here.
  { from: 'V', to: 'II', kind: 'proof' },
  { from: 'V', to: 'IV', kind: 'proof' },
  // VI proves the bond ledger's conservation law (IV).
  { from: 'VI', to: 'IV', kind: 'proof' },
  // VII proves IV's federation.
  { from: 'VII', to: 'IV', kind: 'proof' },
]

const GRID_COLS = 12
const GRID_ROWS = 2
/** Node box size in logical (viewBox) units; the SVG scales to fit its container. */
const NODE_W = 3 // in grid columns (so a spine row of 4 nodes spans the 12-col track)
const COL_UNIT = 100 // px per grid column in the viewBox coordinate space
const ROW_UNIT = 150 // px per grid row in the viewBox coordinate space
const NODE_PAD_X = 8 // horizontal gap inside a column cell, viewBox units
const NODE_H = 104 // node box height, viewBox units
const ROW_TOP_PAD = 14 // top padding inside a row cell

/**
 * When the page owns an in-page reader, it passes `onSelect` so a node opens
 * the chapter in the reader pane instead of jumping to an anchor. When absent
 * (e.g. a future static render), nodes fall back to hash navigation.
 */
export type ChapterSelect = ((chapter: string) => void) | undefined

/** Geometry helper: the rectangle (in viewBox units) a node occupies. */
function nodeRect(node: MapNode) {
  const x = node.col * COL_UNIT + NODE_PAD_X
  const y = node.row * ROW_UNIT + ROW_TOP_PAD
  const w = NODE_W * COL_UNIT - NODE_PAD_X * 2
  const h = NODE_H
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 }
}

function nodeByChapter(chapter: string): MapNode | undefined {
  return MAP_NODES.find((n) => n.chapter === chapter)
}

/**
 * The reading-order DAG. On `lg+` it renders as a true 2-row graph with an SVG
 * edge layer behind real <Link> node faces. Below `lg` the SVG collapses and
 * the chapters stack into a labelled vertical spine (structure stays visible
 * above the fold on mobile — never the essay).
 */
export function ReadingOrderMap({ onSelect }: { onSelect?: ChapterSelect }) {
  const viewW = GRID_COLS * COL_UNIT
  const viewH = GRID_ROWS * ROW_UNIT

  return (
    <div className="grid gap-[var(--space-4)]">
      {/* Legend — what the two edge styles mean. */}
      <div className="flex flex-wrap items-center gap-x-[var(--space-5)] gap-y-[var(--space-2)]">
        <LegendSwatch kind="spine" label="Read in order — the explain spine" />
        <LegendSwatch kind="proof" label="Proves a load-bearing seam" />
      </div>

      {/* ── Desktop: the real graph ── */}
      <div className="relative hidden lg:block">
        {/* Edge layer. aria-hidden — the links below carry the semantics. */}
        <svg
          viewBox={`0 0 ${viewW} ${viewH}`}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          {MAP_EDGES.map((edge) => {
            const from = nodeByChapter(edge.from)
            const to = nodeByChapter(edge.to)
            if (!from || !to) return null
            const a = nodeRect(from)
            const b = nodeRect(to)
            return <MapEdgePath key={`${edge.from}-${edge.to}`} edge={edge} a={a} b={b} />
          })}
        </svg>

        {/* Node layer — CSS grid mirroring the logical placement. */}
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${GRID_ROWS}, ${ROW_UNIT}px)`,
          }}
        >
          {MAP_NODES.map((node) => (
            <div
              key={node.chapter}
              style={{
                gridColumn: `${node.col + 1} / span ${NODE_W}`,
                gridRow: `${node.row + 1}`,
                paddingTop: `${ROW_TOP_PAD}px`,
              }}
            >
              <MapNodeLink node={node} onSelect={onSelect} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Mobile / tablet: stacked spine + proofs ── */}
      <ol className="grid gap-[var(--space-3)] lg:hidden">
        {MAP_NODES.filter((n) => n.kind === 'spine')
          .sort((a, b) => (a.spineIndex ?? 0) - (b.spineIndex ?? 0))
          .map((node, i, arr) => (
            <li key={node.chapter} className="grid gap-[var(--space-3)]">
              <MapNodeLink node={node} stacked onSelect={onSelect} />
              {i < arr.length - 1 ? (
                <div aria-hidden="true" className="flex items-center gap-[var(--space-2)] pl-[var(--space-4)]">
                  <span className="h-[var(--space-4)] w-[2px] bg-[var(--brand-primary)]" />
                  <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
                    then
                  </span>
                </div>
              ) : null}
            </li>
          ))}
        <li className="mt-[var(--space-2)] grid gap-[var(--space-3)] border-t-2 border-[var(--border-default)] pt-[var(--space-4)]">
          <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            The three proofs discharge the seams
          </span>
          <div className="grid gap-[var(--space-3)]">
            {MAP_NODES.filter((n) => n.kind === 'proof').map((node) => (
              <MapNodeLink key={node.chapter} node={node} stacked onSelect={onSelect} />
            ))}
          </div>
        </li>
      </ol>
    </div>
  )
}

function LegendSwatch({ kind, label }: { kind: 'spine' | 'proof'; label: string }) {
  return (
    <span className="inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-secondary)]">
      <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true" className="shrink-0">
        <line
          x1="1"
          y1="5"
          x2="33"
          y2="5"
          stroke={kind === 'spine' ? 'var(--brand-primary)' : 'var(--brand-accent)'}
          strokeWidth="3"
          strokeDasharray={kind === 'proof' ? '5 4' : undefined}
          strokeLinecap="square"
        />
      </svg>
      {label}
    </span>
  )
}

/**
 * A single edge in the desktop SVG layer. Spine edges run between adjacent
 * node faces on the top row; proof edges rise from a proof node up to the seam
 * it anchors. We route as an orthogonal/curved path so dashed proof edges read
 * clearly against the solid spine.
 */
function MapEdgePath({
  edge,
  a,
  b,
}: {
  edge: MapEdge
  a: ReturnType<typeof nodeRect>
  b: ReturnType<typeof nodeRect>
}) {
  const isSpine = edge.kind === 'spine'
  const color = isSpine ? 'var(--brand-primary)' : 'var(--brand-accent)'

  let d: string
  if (isSpine) {
    // Horizontal connector between adjacent top-row nodes, right edge → left edge.
    const x1 = a.x + a.w
    const x2 = b.x
    const y = a.cy
    d = `M ${x1} ${y} L ${x2} ${y}`
  } else {
    // Proof edge: start at the top of the proof node, curve up to the bottom of
    // the proven chapter. Same-column edges run mostly vertical; cross-column
    // edges use a smooth cubic so they don't collide with the spine.
    const x1 = a.cx
    const y1 = a.y
    const x2 = b.cx
    const y2 = b.y + b.h
    const midY = (y1 + y2) / 2
    d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
  }

  // Terminus marker. The edge layer maps its viewBox 1:1 onto a responsive
  // grid (non-uniform pixel scale), so a rotated triangle arrowhead would
  // skew. Instead each proof edge lands in a small filled dot at the seam it
  // anchors — axis-symmetric, so it stays a clean mark under any scale. Spine
  // edges need no head: the "Read N of 4" labels and the legend carry the
  // direction, and the line meets the next node's left border.
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={isSpine ? 3 : 2.5}
        strokeDasharray={isSpine ? undefined : '6 5'}
        strokeLinecap="square"
        vectorEffect="non-scaling-stroke"
      />
      {!isSpine ? <circle cx={b.cx} cy={b.y + b.h} r={4.5} fill={color} /> : null}
    </g>
  )
}

/**
 * The clickable face of a chapter node. Spine nodes are cobalt-tinted (the
 * thing you read); proof nodes are teal-outlined (the thing that anchors). A
 * stacked variant is used on mobile.
 */
function MapNodeLink({
  node,
  stacked = false,
  onSelect,
}: {
  node: MapNode
  stacked?: boolean
  onSelect?: ChapterSelect
}) {
  const paper = findWhitePaperByChapter(node.chapter)
  if (!paper) return null
  const isSpine = node.kind === 'spine'

  const className = [
    'group relative grid h-full content-center gap-[var(--space-1)] border-2 px-[var(--space-3)] py-[var(--space-3)] text-left transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]',
    isSpine
      ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_10%,var(--surface-base))] hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)]'
      : 'border-[var(--brand-accent)] bg-[color-mix(in_srgb,var(--brand-accent)_8%,var(--surface-base))] hover:bg-[var(--brand-accent)] hover:text-[var(--brand-accent-foreground)]',
    stacked ? 'min-h-[5.5rem]' : '',
  ].join(' ')
  const ariaLabel = `Chapter ${node.chapter}: ${paper.title} — ${
    node.kind === 'spine' ? 'an explaining chapter' : 'a proving chapter'
  }. Open it in the reader.`
  const inner = <MapNodeFace node={node} paper={paper} isSpine={isSpine} />

  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(node.chapter)} aria-label={ariaLabel} className={className}>
        {inner}
      </button>
    )
  }

  return (
    <Link to={`#chapter-${node.chapter}`} aria-label={ariaLabel} className={className}>
      {inner}
    </Link>
  )
}

/** The visual face of a map node — shared by the button and link variants. */
function MapNodeFace({
  node,
  paper,
  isSpine,
}: {
  node: MapNode
  paper: WhitePaper
  isSpine: boolean
}) {
  return (
    <>
      <span className="flex items-center gap-[var(--space-2)]">
        <span
          className={[
            'inline-grid h-[1.75rem] min-w-[1.75rem] place-items-center border-2 px-[var(--space-1)] font-mono text-[length:var(--text-base)] font-black leading-none',
            isSpine
              ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)] group-hover:border-[var(--brand-primary-foreground)]'
              : 'border-[var(--brand-accent)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)] group-hover:border-[var(--brand-accent-foreground)]',
          ].join(' ')}
        >
          {node.chapter}
        </span>
        <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)] group-hover:text-current">
          {isSpine ? `Read ${node.spineIndex} of 4` : 'Proof'}
        </span>
      </span>
      <span className="font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] group-hover:text-current">
        {node.short}
      </span>
      <span className="font-sans text-[length:var(--text-sm)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)] group-hover:text-current">
        {paper.layer}
      </span>
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * NESTED-LAYER MAP — concentric boxes, each layer reads truth from the one
 * inside it. L0/L1 (II) ⊂ L2 (I) ⊂ L3-bridge (III) ⊂ L3-market (IV).
 * ──────────────────────────────────────────────────────────────────────── */

interface LayerRing {
  chapter: string
  layerLabel: string
  what: string
}

const LAYER_RINGS: LayerRing[] = [
  { chapter: 'IV', layerLabel: 'L3 · the market', what: 'rents trust between operators' },
  { chapter: 'III', layerLabel: 'L3 · the bridge', what: 'turns a spawn into a person' },
  { chapter: 'I', layerLabel: 'L2 · legibility', what: 'the swarm as one picture' },
  { chapter: 'II', layerLabel: 'L0 / L1 · the kernel', what: 'decides what is true' },
]

export function NestedLayerMap({ onSelect }: { onSelect?: ChapterSelect }) {
  return (
    <div className="grid gap-[var(--space-4)]">
      {/* Concentric rings — outermost first; each contains the next. */}
      <div className="border-2 border-[var(--border-strong)] bg-[var(--surface-base)] p-[var(--space-3)] sm:p-[var(--space-4)]">
        <NestedRing rings={LAYER_RINGS} depth={0} onSelect={onSelect} />
      </div>

      {/* The proofs anchor the seams between the rings. */}
      <div className="flex flex-wrap items-center gap-[var(--space-2)] border-2 border-[var(--brand-accent)] bg-[color-mix(in_srgb,var(--brand-accent)_8%,var(--surface-base))] p-[var(--space-3)]">
        <BadgeCheck aria-hidden="true" size={16} className="shrink-0 text-[var(--brand-accent)]" />
        <span className="font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          <strong className="font-black text-[var(--text-primary)]">Proofs V · VI · VII anchor the seams</strong>{' '}
          — the Anchor Protocol (V) proves the kernel and the identity it hands up; the Bonded Commons (VI) and
          the Federated Harbor (VII) prove the market&rsquo;s conservation and federation.
        </span>
      </div>
    </div>
  )
}

/**
 * Recursive nested box. Each ring is a labelled frame; its child renders
 * inside it, so the DOM literally nests L0 inside L2 inside L3-bridge inside
 * L3-market. The innermost ring (the kernel) is cobalt-filled as the floor
 * everything stands on.
 */
function NestedRing({
  rings,
  depth,
  onSelect,
}: {
  rings: LayerRing[]
  depth: number
  onSelect?: ChapterSelect
}) {
  const ring = rings[depth]
  if (!ring) return null
  const paper = findWhitePaperByChapter(ring.chapter)
  const isInnermost = depth === rings.length - 1

  const headerClass =
    'group flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-[var(--space-1)] text-left focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]'
  const face = (
    <>
      <span
        className={[
          'inline-grid h-[1.6rem] min-w-[1.6rem] place-items-center border-2 px-[var(--space-1)] font-mono text-[length:var(--type-meta-size)] font-black leading-none',
          isInnermost
            ? 'border-[var(--brand-primary-foreground)] text-[var(--brand-primary-foreground)]'
            : 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
        ].join(' ')}
      >
        {ring.chapter}
      </span>
      <span
        className={[
          'font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)]',
          isInnermost ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--brand-primary)]',
        ].join(' ')}
      >
        {ring.layerLabel}
      </span>
      <span
        className={[
          'font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] underline-offset-4 group-hover:underline',
          isInnermost ? 'text-[var(--brand-primary-foreground)]' : 'text-[var(--text-primary)]',
        ].join(' ')}
      >
        {paper?.title ?? ring.chapter}
      </span>
      <span
        className={[
          'font-sans text-[length:var(--type-panel-body-compact-size)] leading-[var(--leading-body-compact)]',
          isInnermost ? 'text-[color:var(--brand-primary-foreground-muted)]' : 'text-[var(--text-secondary)]',
        ].join(' ')}
      >
        — {ring.what}
      </span>
    </>
  )

  return (
    <div
      className={[
        'grid gap-[var(--space-2)] border-2 p-[var(--space-3)] sm:p-[var(--space-4)]',
        isInnermost
          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]'
          : 'border-[var(--border-strong)] bg-[var(--surface-raised)]',
      ].join(' ')}
    >
      {onSelect ? (
        <button type="button" onClick={() => onSelect(ring.chapter)} className={headerClass}>
          {face}
        </button>
      ) : (
        <Link to={`#chapter-${ring.chapter}`} className={headerClass}>
          {face}
        </Link>
      )}

      {!isInnermost ? (
        <div className="grid gap-[var(--space-1)]">
          <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            reads truth from ↓
          </span>
          <NestedRing rings={rings} depth={depth + 1} onSelect={onSelect} />
        </div>
      ) : null}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
 * SHARED: a compact one-line-per-chapter index, hanging off the map.
 * ──────────────────────────────────────────────────────────────────────── */

export function ChapterIndexRow({
  paper,
  onOpen,
  active,
}: {
  paper: WhitePaper
  onOpen: (chapter: string) => void
  active: boolean
}) {
  const isProof = paper.group === 'prove'
  return (
    <div
      className={[
        'grid grid-cols-[auto_1fr_auto] items-center gap-[var(--space-3)] border-2 px-[var(--space-3)] py-[var(--space-3)] transition-colors',
        active
          ? 'border-[var(--brand-primary)] bg-[color-mix(in_srgb,var(--brand-primary)_8%,var(--surface-base))]'
          : 'border-[var(--border-default)] bg-[var(--surface-base)]',
      ].join(' ')}
    >
      <span
        className={[
          'inline-grid h-[2rem] min-w-[2rem] place-items-center border-2 px-[var(--space-1)] font-mono text-[length:var(--text-base)] font-black leading-none',
          isProof
            ? 'border-[var(--brand-accent)] bg-[var(--brand-accent)] text-[var(--brand-accent-foreground)]'
            : 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-foreground)]',
        ].join(' ')}
      >
        {paper.chapter}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-[var(--space-3)] gap-y-[var(--space-1)]">
          <button
            type="button"
            onClick={() => onOpen(paper.chapter)}
            className="text-left font-display text-[length:var(--text-lg)] font-black leading-[var(--leading-nav)] text-[var(--text-primary)] underline-offset-4 hover:text-[var(--brand-primary)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
          >
            {paper.title}
          </button>
          <span className="font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-muted)]">
            {paper.layer}
          </span>
        </div>
        <span className="mt-[var(--space-1)] inline-flex items-center gap-[var(--space-2)] font-sans text-[length:var(--text-sm)] leading-[var(--leading-body-compact)] text-[var(--text-secondary)]">
          <BadgeCheck aria-hidden="true" size={14} className="shrink-0 text-[var(--brand-primary)]" />
          {paper.maturity}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-[var(--space-2)]">
        <button
          type="button"
          onClick={() => onOpen(paper.chapter)}
          className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--text-primary)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-inverse)] transition-colors hover:bg-[var(--brand-primary)] hover:text-[var(--brand-primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
        >
          Read
          <ArrowRight aria-hidden="true" size={13} />
        </button>
        <a
          href={paper.pdfPath}
          className="inline-flex items-center gap-[var(--space-2)] border-2 border-[var(--border-strong)] bg-[var(--surface-raised)] px-[var(--space-3)] py-[var(--space-2)] font-sans text-[length:var(--type-meta-size)] font-semibold uppercase tracking-[var(--tracking-meta)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-strong)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--interactive-focus)]"
        >
          <FileText aria-hidden="true" size={13} />
          PDF
        </a>
      </div>
    </div>
  )
}
