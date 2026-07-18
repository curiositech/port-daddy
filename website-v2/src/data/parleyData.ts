import type { LucideIcon } from 'lucide-react'
import { Flag, Hash, GitBranch, Handshake, GitMerge, FileCheck2 } from 'lucide-react'

/**
 * A real two-round agent parley over ADR-0119 (the Slack Bridge design), told as
 * a six-beat narrative graph. This is the single source of truth for both the
 * interactive React Flow visualization (ParleyFlow) and the prose narrative on
 * the Parley page, so the story reads identically whether you explore the graph
 * or scroll past it.
 *
 * Role hues are a categorical assignment (one hue per role, fixed order). Each
 * theme's six-hue set was checked with the dataviz palette validator and passes
 * CVD separation, contrast-vs-surface, the lightness band, and the chroma floor
 * on its surface (#f2eee6 light / #101216 dark). Identity is never colour-alone:
 * every node also carries its role eyebrow label + an icon, so it survives
 * colour-blindness and print.
 */

export type ParleyRole =
  | 'opening'
  | 'peer1'
  | 'peer2'
  | 'concession1'
  | 'concession2'
  | 'outcome'

export interface ParleyHue {
  /** Validated categorical hue on the cream light surface (#f2eee6). */
  light: string
  /** Validated categorical hue on the near-black dark surface (#101216). */
  dark: string
}

export interface ParleyNodeDatum {
  id: ParleyRole
  /** Eyebrow / role label (mono, uppercase, tracked — the sanctioned 12px exception). */
  roleLabel: string
  /** Short human title for the beat. */
  title: string
  /** The dense position text — the actual argument made in this beat. */
  position: string
  /** Verdict chip, e.g. "concede · clean". */
  verdict: string
  icon: LucideIcon
  hue: ParleyHue
  /** Hand-placed graph coordinates (top→bottom funnel). */
  x: number
  y: number
}

export interface ParleyEdgeDatum {
  id: string
  source: ParleyRole
  target: ParleyRole
  label: string
}

const NODE_W = 320

// Diamond / funnel composition, read top-to-bottom:
//   opening (top center) → the two peers (a row) → the two concessions
//   (below each peer) → outcome (bottom center).
export const parleyNodes: ParleyNodeDatum[] = [
  {
    id: 'opening',
    roleLabel: 'My opening',
    title: 'Federate, don’t re-tenant',
    position:
      'Slack federates into existing accounts (ADR-0101) + harbors (ADR-0094) + relay (ADR-0049); no new tenancy. Tier L — a local Socket Mode sidecar, loopback, off-relay — ships now, unblocked. Tier M (managed multi-tenant) shares email-over-relay (ADR-0099)’s exact Phase-3 critical path: cap/aud caveat grammar + enforced symmetric E2E + ProVerif. Completion is a lineage-threaded DAG, 5 waves, with persistent-agent lineages via ADR-0118 continuation.',
    verdict: 'position · opened',
    icon: Flag,
    hue: { light: '#2f6fd6', dark: '#4f92e8' },
    x: 360,
    y: 0,
  },
  {
    id: 'peer1',
    roleLabel: 'Peer 1 · PR #2594',
    title: 'Collision registry',
    position:
      'docs/adr/ had TWELVE ADR-number collisions. This PR renumbers the squatters into 0102–0115 and installs a fail-closed collision guard so the whole class can’t recur. Numbering is its authority, not mine.',
    verdict: 'authority · numbering',
    icon: Hash,
    hue: { light: '#0e8f7f', dark: '#2ba99d' },
    x: 20,
    y: 300,
  },
  {
    id: 'peer2',
    roleLabel: 'Peer 2 · PR #3132',
    title: 'ADR-0118 addendum',
    position:
      'Adds a THIRD continuation mode — import / foreignImport — plus multi-hop relay routing (claude → codex → agy → claude), richer than a single sanitized capsule. It owns the continuation contract.',
    verdict: 'authority · continuation',
    icon: GitBranch,
    hue: { light: '#2f9e57', dark: '#37a163' },
    x: 700,
    y: 300,
  },
  {
    id: 'concession1',
    roleLabel: 'Concession 1',
    title: 'Number goes provisional',
    position:
      'ADR-0119’s number is now PROVISIONAL — deferred to the collision guard; the header is annotated to take its canonical number after #2594 lands. I don’t own numbering; they do.',
    verdict: 'concede · clean',
    icon: Handshake,
    hue: { light: '#b56a1e', dark: '#b57a45' },
    x: 20,
    y: 640,
  },
  {
    id: 'concession2',
    roleLabel: 'Concession 2',
    title: 'Adopt the 3-mode vocab',
    position:
      'Adopted the three-mode continuation vocabulary: native / handoff / IMPORT (foreignImport). DAG cross-harness lineage edges upgrade handoff → import wherever the successor harness supports foreignImport; capsule handoff stays the fail-closed fallback.',
    verdict: 'adopt · clean',
    icon: GitMerge,
    hue: { light: '#a349b5', dark: '#b566c8' },
    x: 700,
    y: 640,
  },
  {
    id: 'outcome',
    roleLabel: 'Outcome',
    title: 'Artifacts reconciled',
    position:
      'docs/adr/0119 header + docs/design/slack-bridge-dag.md legend updated. No contested points — clean concessions on authority boundaries. Two Wave-0 reconciliation gates were added to the DAG: number-reconcile and continuation-vocab-reconcile.',
    verdict: 'resolved · 0 contested',
    icon: FileCheck2,
    hue: { light: '#7f8500', dark: '#8f9420' },
    x: 360,
    y: 980,
  },
]

export const parleyEdges: ParleyEdgeDatum[] = [
  { id: 'e-open-peer1', source: 'opening', target: 'peer1', label: 'brings position' },
  { id: 'e-open-peer2', source: 'opening', target: 'peer2', label: 'brings position' },
  { id: 'e-peer1-con1', source: 'peer1', target: 'concession1', label: 'cede numbering' },
  { id: 'e-peer2-con2', source: 'peer2', target: 'concession2', label: 'adopt vocab' },
  { id: 'e-con1-out', source: 'concession1', target: 'outcome', label: 'reconcile' },
  { id: 'e-con2-out', source: 'concession2', target: 'outcome', label: 'reconcile' },
]

export const parleyNodeWidth = NODE_W

/** Look up a node datum by role id. */
export function parleyNode(role: ParleyRole): ParleyNodeDatum {
  const found = parleyNodes.find((n) => n.id === role)
  if (!found) throw new Error(`unknown parley role: ${role}`)
  return found
}

/** Resolve the validated hue for a role in the active theme. */
export function parleyHue(node: ParleyNodeDatum, theme: 'light' | 'dark'): string {
  return theme === 'dark' ? node.hue.dark : node.hue.light
}
