/**
 * Discourse lineage — the argument graph over a typed tube conversation.
 *
 * RCP-14 (argumentative lineage; see docs/research/north-star/00-THE-LEDGER-open-problems.md
 * § D). Once tube messages carry a typed conversation move (ADR-0047 Phase 0
 * `performative` + the RCP-3b `relationship`, both in `lib/tube.ts`), a thread
 * of `inReplyTo` edges typed by `relationship` IS an argument graph: who
 * answered whom, and whether each answer SUPPORTS / CONTRADICTS / EXTENDS /
 * NARROWS / SYNTHESIZES the claim it replies to.
 *
 * This module is pure — it consumes already-decoded `TubeMessage`s (e.g. from
 * `listen()`/`getMessages` in lib/tube.ts) and produces:
 *   - `buildLineage()` — the graph (nodes + typed parent/child edges + depth),
 *   - `summarizeThread()` — a digest (counts, participants, the contradiction
 *      edges that need resolving) — the "zoom-out",
 *   - `renderLineageTree()` — an indented tree — the "zoom-in".
 * Together they are digest-with-zoom for *reasoning provenance*: read the digest,
 * then drill into the exact edge where two agents disagree.
 *
 * It ports the shape of jury_rig' `SwarmTracer` (epistemic-ancestry spans) onto
 * port-daddy's existing tube substrate, with no new persistence — the messages
 * already live on the channel.
 */

import { DISCOURSE_RELATIONSHIPS, type DiscourseRelationship, type Performative, type TubeMessage } from './tube.js';

export interface LineageNode {
  id: number;
  sender: string | null;
  body: string;
  performative?: Performative;
  /** Argumentative stance toward the in-set parent (only meaningful when `parentId` is set). */
  relationship?: DiscourseRelationship;
  /** The answered message, when it is present in the provided set. */
  parentId?: number;
  /** An `inReplyTo` that points OUTSIDE the provided set (truncated window / cross-channel). */
  danglingParentId?: number;
  childIds: number[];
  /** 0 for roots; parent depth + 1 otherwise. */
  depth: number;
}

export interface LineageGraph {
  nodes: Map<number, LineageNode>;
  /** Node ids with no in-set parent (true roots + messages whose parent was outside the window). */
  roots: number[];
  /** Set when every message in the set shares one conversationId. */
  conversationId?: string;
}

/** One typed edge: `from` (child) relates to `to` (parent) by `relationship`. */
export interface LineageEdge {
  from: number;
  to: number;
  sender: string | null;
  relationship: DiscourseRelationship;
}

export interface ThreadDigest {
  total: number;
  participants: string[];
  roots: number[];
  maxDepth: number;
  /** Count of each argumentative relationship across the thread (all keys present, zero-filled). */
  byRelationship: Record<DiscourseRelationship, number>;
  /** Count of each FIPA performative actually seen. */
  byPerformative: Partial<Record<Performative, number>>;
  /** The contradiction edges — the disagreements an operator most wants to zoom into. */
  contradictions: LineageEdge[];
  /**
   * Contradiction edges whose target (the contradicted message) is not later
   * answered by a `synthesizes` move — i.e. disagreements that look unresolved.
   */
  unresolvedContradictions: LineageEdge[];
  /** True when the thread carries at least one typed move (act or relationship). */
  typed: boolean;
}

function zeroRelationshipCounts(): Record<DiscourseRelationship, number> {
  const out = {} as Record<DiscourseRelationship, number>;
  for (const r of DISCOURSE_RELATIONSHIPS) out[r] = 0;
  return out;
}

/** Truncate a body to a single short line for tree rendering. */
function snippet(body: string, max = 72): string {
  const firstLine = (body || '').split('\n')[0]!.trim();
  return firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
}

/**
 * Build the argument graph from a set of decoded tube messages. Order-independent
 * (messages are keyed by id); a later child can appear before its parent in the
 * input. An `inReplyTo` pointing outside the set is preserved as
 * `danglingParentId` and the node is treated as a root.
 */
export function buildLineage(messages: TubeMessage[]): LineageGraph {
  const nodes = new Map<number, LineageNode>();

  // First pass: create nodes (de-dupe by id; last write wins on collision).
  for (const m of messages) {
    nodes.set(m.id, {
      id: m.id,
      sender: m.sender,
      body: m.body,
      ...(m.performative ? { performative: m.performative } : {}),
      ...(m.relationship ? { relationship: m.relationship } : {}),
      childIds: [],
      depth: 0,
    });
  }

  // Second pass: wire parent/child edges using inReplyTo.
  for (const m of messages) {
    if (typeof m.inReplyTo !== 'number') continue;
    const node = nodes.get(m.id);
    if (!node) continue;
    if (nodes.has(m.inReplyTo)) {
      node.parentId = m.inReplyTo;
      nodes.get(m.inReplyTo)!.childIds.push(m.id);
    } else {
      node.danglingParentId = m.inReplyTo;
    }
  }

  // Keep child lists in id order for deterministic rendering.
  for (const node of nodes.values()) node.childIds.sort((a, b) => a - b);

  const roots = [...nodes.values()].filter((n) => n.parentId === undefined).map((n) => n.id).sort((a, b) => a - b);

  // Depth via BFS from roots (handles forests; cycles are impossible since
  // inReplyTo only ever points at a strictly-earlier id in practice, but we
  // guard with a visited set regardless).
  const visited = new Set<number>();
  const queue: Array<{ id: number; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = nodes.get(id)!;
    node.depth = depth;
    for (const childId of node.childIds) {
      if (!visited.has(childId)) queue.push({ id: childId, depth: depth + 1 });
    }
  }

  const convIds = new Set(messages.map((m) => m.conversationId).filter((c): c is string => typeof c === 'string' && !!c));
  const graph: LineageGraph = { nodes, roots };
  if (convIds.size === 1) graph.conversationId = [...convIds][0];
  return graph;
}

/**
 * Collect every typed edge (child → parent) in the graph.
 */
export function lineageEdges(graph: LineageGraph): LineageEdge[] {
  const edges: LineageEdge[] = [];
  for (const node of graph.nodes.values()) {
    if (node.parentId !== undefined && node.relationship) {
      edges.push({ from: node.id, to: node.parentId, sender: node.sender, relationship: node.relationship });
    }
  }
  return edges.sort((a, b) => a.from - b.from);
}

/**
 * Zoom-out: a digest of the thread. The `contradictions` (and the subset that
 * look unresolved) are the high-signal entries an operator drills into.
 */
export function summarizeThread(graph: LineageGraph): ThreadDigest {
  const byRelationship = zeroRelationshipCounts();
  const byPerformative: Partial<Record<Performative, number>> = {};
  const participants = new Set<string>();
  let maxDepth = 0;
  let typed = false;

  for (const node of graph.nodes.values()) {
    if (node.sender) participants.add(node.sender);
    if (node.depth > maxDepth) maxDepth = node.depth;
    if (node.relationship) { byRelationship[node.relationship] += 1; typed = true; }
    if (node.performative) { byPerformative[node.performative] = (byPerformative[node.performative] ?? 0) + 1; typed = true; }
  }

  const edges = lineageEdges(graph);
  const contradictions = edges.filter((e) => e.relationship === 'contradicts');

  // A contradiction looks "resolved" when the contradicted message (its target)
  // later receives a `synthesizes` move (someone reconciled the disagreement).
  const synthesizedTargets = new Set(edges.filter((e) => e.relationship === 'synthesizes').map((e) => e.to));
  const unresolvedContradictions = contradictions.filter((e) => !synthesizedTargets.has(e.to));

  return {
    total: graph.nodes.size,
    participants: [...participants].sort(),
    roots: graph.roots,
    maxDepth,
    byRelationship,
    byPerformative,
    contradictions,
    unresolvedContradictions,
    typed,
  };
}

/**
 * Zoom-in: an indented tree. Each line shows id, sender, the typed move
 * (act + stance toward its parent), and a one-line body snippet.
 */
export function renderLineageTree(graph: LineageGraph): string {
  const lines: string[] = [];

  const walk = (id: number, indent: number): void => {
    const node = graph.nodes.get(id);
    if (!node) return;
    const pad = '  '.repeat(indent);
    const moveBits = [
      node.performative ? `act=${node.performative}` : '',
      node.relationship ? node.relationship : '',
    ].filter(Boolean);
    const move = moveBits.length > 0 ? ` [${moveBits.join(' ')}]` : '';
    const dangling = node.danglingParentId !== undefined ? ` ↩(${node.danglingParentId}, outside window)` : '';
    lines.push(`${pad}#${node.id} ${node.sender || 'unknown'}${move}${dangling}: ${snippet(node.body)}`);
    for (const childId of node.childIds) walk(childId, indent + 1);
  };

  for (const rootId of graph.roots) walk(rootId, 0);
  return lines.join('\n');
}
