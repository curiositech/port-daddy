import * as React from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Users } from 'lucide-react'
import { useTheme } from '@/lib/theme-context'
import {
  parleyNodes,
  parleyEdges,
  parleyNodeWidth,
  parleyHue,
  type ParleyNodeDatum,
  type ParleyRole,
} from '@/data/parleyData'

/**
 * ParleyFlow — an interactive, information-dense React Flow visualization of a
 * real two-round agent parley over ADR-0119 (the Slack Bridge design).
 *
 * Design notes:
 *  • Six hand-placed cut-paper nodes in a top→bottom funnel: Opening →
 *    the two Peers (a paired band) → the two Concessions (a paired band) →
 *    Outcome. Proximity groups the acts; alignment keeps the concede-flow a
 *    clean vertical current toward the Outcome (the visual terminus).
 *  • Two sides are encoded pre-attentively: MY moves (opening / concessions /
 *    outcome) sit on raised cream paper with a left corner tab; the two PEER
 *    moves sit on a sunken paper tone with a right corner tab + a counterparty
 *    glyph. Role hue on the tab breaks similarity for per-node identity.
 *  • Common-fate hover: hovering a node lifts its connected edges + downstream
 *    node and dims the rest, so peer → concession → outcome traces on hover.
 *  • Every node carries a role eyebrow label + an icon — identity is never
 *    colour-alone (survives colour-blindness / print). Body text ≥14px.
 *
 * v12 correctness: nodeTypes is defined at module scope (never re-created per
 * render — the classic infinite-loop footgun); custom nodes declare explicit
 * top/target + bottom/source Handles.
 */

type ParleyNodeData = {
  datum: ParleyNodeDatum
  theme: 'light' | 'dark'
  dimmed: boolean
}

// ── custom cut-paper node ────────────────────────────────────────────────────
function ParleyCard({ data }: NodeProps<Node<ParleyNodeData>>) {
  const { datum, theme, dimmed } = data
  const hue = parleyHue(datum, theme)
  const Icon = datum.icon
  const isPeer = datum.id === 'peer1' || datum.id === 'peer2'
  // Icon knockout colour on the coloured corner tab: cream on the deeper light
  // hues, near-ink on the lighter dark hues (both clear the tab).
  const iconOnTab = theme === 'dark' ? '#101216' : '#fbf7ef'

  return (
    <div
      className="relative font-sans transition-opacity duration-200"
      style={{
        width: parleyNodeWidth,
        opacity: dimmed ? 0.32 : 1,
        // MY moves ride raised paper; PEER moves ride a sunken tone so the two
        // sides read as distinct visual families before a word is read.
        background: isPeer ? 'var(--surface-sunken)' : 'var(--surface-raised)',
        border: '2px solid var(--border-strong)',
        // The corner tab overhangs its side; leave room for it.
        paddingTop: 'var(--space-6)',
        paddingBottom: 'var(--space-4)',
        paddingLeft: isPeer ? 'var(--space-4)' : 'var(--space-5)',
        paddingRight: isPeer ? 'var(--space-5)' : 'var(--space-4)',
        // Thin role-hue cut-paper stripe on the card's own side.
        boxShadow: isPeer
          ? `inset -4px 0 0 ${hue}`
          : `inset 4px 0 0 ${hue}`,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'var(--border-strong)', width: 8, height: 8, border: 'none' }}
      />

      {/* corner tab — role hue slab with a knockout icon; side encodes us/them */}
      <div
        className="absolute -top-[2px] flex items-center gap-[var(--space-1)]"
        style={{
          [isPeer ? 'right' : 'left']: -2,
          background: hue,
          color: iconOnTab,
          padding: '5px 9px',
        }}
        aria-hidden="true"
      >
        <Icon size={15} strokeWidth={2.4} />
        {isPeer && <Users size={13} strokeWidth={2.4} />}
      </div>

      {/* eyebrow — the sanctioned 12px mono/uppercase/tracked exception */}
      <div
        className="font-mono font-bold uppercase"
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.1em',
          color: 'var(--text-secondary)',
          textAlign: isPeer ? 'right' : 'left',
        }}
      >
        {datum.roleLabel}
      </div>

      {/* title */}
      <h3
        className="font-display"
        style={{
          marginTop: 'var(--space-1)',
          fontSize: '1.0625rem',
          fontWeight: 800,
          lineHeight: 1.2,
          color: 'var(--text-primary)',
          textAlign: isPeer ? 'right' : 'left',
        }}
      >
        {datum.title}
      </h3>

      {/* position text — the actual argument, ≥14px */}
      <p
        style={{
          marginTop: 'var(--space-2)',
          fontSize: '0.875rem',
          lineHeight: 1.5,
          color: 'var(--text-secondary)',
          textAlign: isPeer ? 'right' : 'left',
          maxWidth: 'none',
        }}
      >
        {datum.position}
      </p>

      {/* verdict chip — hue carried by the dot, text stays AA on the card */}
      <div
        className="mt-[var(--space-3)] inline-flex items-center gap-[var(--space-2)] font-mono font-bold uppercase"
        style={{
          fontSize: '0.75rem',
          letterSpacing: '0.08em',
          color: 'var(--text-primary)',
          border: `1px solid ${hue}`,
          padding: '3px 9px',
          float: isPeer ? 'right' : 'none',
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 8, height: 8, background: hue, display: 'inline-block' }}
        />
        {datum.verdict}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'var(--border-strong)', width: 8, height: 8, border: 'none' }}
      />
    </div>
  )
}

// MUST be module-scope (or useMemo) — a per-render object triggers RF's
// infinite re-measure loop.
const nodeTypes = { parley: ParleyCard }

// ── downstream reachability for common-fate hover ────────────────────────────
const downstream: Record<ParleyRole, ParleyRole[]> = (() => {
  const adj: Record<string, ParleyRole[]> = {}
  for (const e of parleyEdges) (adj[e.source] ??= []).push(e.target)
  const reach = (start: ParleyRole): Set<ParleyRole> => {
    const seen = new Set<ParleyRole>()
    const stack = [...(adj[start] ?? [])]
    while (stack.length) {
      const n = stack.pop()!
      if (seen.has(n)) continue
      seen.add(n)
      stack.push(...(adj[n] ?? []))
    }
    return seen
  }
  const out = {} as Record<ParleyRole, ParleyRole[]>
  for (const n of parleyNodes) out[n.id] = [...reach(n.id)]
  return out
})()

export function ParleyFlow() {
  const { theme } = useTheme()
  const mode: 'light' | 'dark' = theme === 'dark' ? 'dark' : 'light'
  const [hovered, setHovered] = React.useState<ParleyRole | null>(null)

  // Active set for common-fate hover = hovered node + everything downstream.
  const activeNodes = React.useMemo<Set<ParleyRole> | null>(() => {
    if (!hovered) return null
    return new Set<ParleyRole>([hovered, ...downstream[hovered]])
  }, [hovered])

  const nodes = React.useMemo<Node<ParleyNodeData>[]>(
    () =>
      parleyNodes.map((d) => ({
        id: d.id,
        type: 'parley',
        position: { x: d.x, y: d.y },
        data: { datum: d, theme: mode, dimmed: activeNodes ? !activeNodes.has(d.id) : false },
        draggable: false,
        connectable: false,
        selectable: true,
        ariaLabel: `${d.roleLabel}: ${d.title}. ${d.position} Verdict: ${d.verdict}.`,
      })),
    [mode, activeNodes],
  )

  const edges = React.useMemo<Edge[]>(
    () =>
      parleyEdges.map((e) => {
        const sourceDatum = parleyNodes.find((n) => n.id === e.source)!
        const hue = parleyHue(sourceDatum, mode)
        const active = !hovered || (activeNodes?.has(e.source) && activeNodes?.has(e.target))
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: e.label,
          type: 'default',
          animated: Boolean(active),
          style: {
            stroke: hue,
            strokeWidth: active ? 2.5 : 1.25,
            opacity: active ? 1 : 0.25,
          },
          labelStyle: {
            fill: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          },
          labelBgStyle: { fill: 'var(--surface-raised)', opacity: active ? 1 : 0.6 },
          labelBgPadding: [6, 3] as [number, number],
          labelShowBg: true,
          markerEnd: { type: MarkerType.ArrowClosed, color: hue, width: 16, height: 16 },
        }
      }),
    [mode, hovered, activeNodes],
  )

  return (
    <ReactFlowProvider>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.4}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        // Don't hijack the page's wheel scroll — pan by dragging, zoom via
        // Controls or pinch. Keeps the marketing page scrollable.
        zoomOnScroll={false}
        panOnScroll={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, n) => setHovered(n.id as ParleyRole)}
        onNodeMouseLeave={() => setHovered(null)}
        aria-label="ADR-0119 parley: an interactive graph of a two-round agent negotiation"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={26}
          size={1}
          color="var(--border-default)"
        />
        <Controls
          showInteractive={false}
          className="!border-2 !border-[var(--border-strong)] !bg-[var(--surface-raised)]"
        />
      </ReactFlow>
    </ReactFlowProvider>
  )
}

export default ParleyFlow
