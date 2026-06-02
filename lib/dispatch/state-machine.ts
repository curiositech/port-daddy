/**
 * Dispatch state machine — the allowed-transitions table, in one place.
 *
 * The 8 live states + 2 terminals form a DAG with one merge step (accepted +
 * rejected both terminate). Cancellation is a privileged jump from any
 * non-terminal state to `salvage`.
 *
 * Code outside lib/dispatch/queue.ts should call `assertTransition()` before
 * mutating a dispatch row directly. The queue module's per-transition SQL
 * UPDATE statements already enforce the precondition via the WHERE clause;
 * this module exists so other surfaces (HTTP routes, MCP tools, future
 * harbormaster) have a single source of truth for "is this legal."
 *
 * Diagram:
 *
 *   proposed
 *      │
 *      ▼
 *   claimed ──────► in_progress ──────► produced ──────► review_pending
 *                                                              │
 *                                          ┌───────────────────┴────────────────┐
 *                                          ▼                                    ▼
 *                                       accepted                            rejected
 *                                          │                                    │
 *                                          ▼                                    ▼
 *                                       settled                             salvage
 *
 *                                       failed   (reachable from any non-terminal)
 *                                       salvage  (reachable via `cancel` from any
 *                                                 non-terminal — operator escape)
 */

import type { DispatchState } from './queue.js';

/**
 * Allowed forward transitions for the linear path. Does NOT include the
 * privileged jumps (failed / salvage), which are tested separately.
 */
const FORWARD_TRANSITIONS: Record<DispatchState, DispatchState[]> = {
  proposed: ['claimed'],
  claimed: ['in_progress'],
  in_progress: ['produced'],
  produced: ['review_pending'],
  review_pending: ['accepted', 'rejected'],
  accepted: ['settled'],
  rejected: ['salvage'],
  // Terminal states have no forward transitions.
  settled: [],
  failed: [],
  salvage: [],
};

/** Non-terminal states. */
const NON_TERMINAL: DispatchState[] = [
  'proposed',
  'claimed',
  'in_progress',
  'produced',
  'review_pending',
  'accepted',
  'rejected',
];

/** Terminal states. */
export const TERMINAL_STATES: ReadonlyArray<DispatchState> = [
  'settled',
  'failed',
  'salvage',
];

export function isTerminal(state: DispatchState): boolean {
  return TERMINAL_STATES.includes(state);
}

export function isNonTerminal(state: DispatchState): boolean {
  return NON_TERMINAL.includes(state);
}

/**
 * Returns true iff `to` is reachable from `from` in one step.
 *
 *   - Forward transitions per the table above.
 *   - `failed` is reachable from any non-terminal state (hard-crash path).
 *   - `salvage` is reachable from any non-terminal state via operator
 *     cancel; also the natural target of `rejected`.
 */
export function canTransition(from: DispatchState, to: DispatchState): boolean {
  if (from === to) return false; // not a transition
  if (FORWARD_TRANSITIONS[from]?.includes(to)) return true;
  if (to === 'failed' && isNonTerminal(from)) return true;
  if (to === 'salvage' && isNonTerminal(from)) return true;
  return false;
}

/** Throws with a clear message if the transition is illegal. */
export function assertTransition(from: DispatchState, to: DispatchState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `illegal dispatch transition: ${from} -> ${to} (allowed from ${from}: ` +
        `${[...(FORWARD_TRANSITIONS[from] ?? []), ...(isNonTerminal(from) ? ['failed', 'salvage'] : [])].join(', ') || 'none'})`,
    );
  }
}

/** Returns all states reachable from `from` in one step. */
export function nextStates(from: DispatchState): DispatchState[] {
  const out = [...(FORWARD_TRANSITIONS[from] ?? [])];
  if (isNonTerminal(from)) {
    if (!out.includes('failed')) out.push('failed');
    if (!out.includes('salvage')) out.push('salvage');
  }
  return out;
}

/**
 * Human-readable single-line description of the dispatch state for `pd
 * morning` and similar surfaces. Order matches the morning table column.
 */
export function describeState(state: DispatchState): string {
  switch (state) {
    case 'proposed': return 'queued';
    case 'claimed': return 'claimed';
    case 'in_progress': return 'running';
    case 'produced': return 'PR open';
    case 'review_pending': return 'awaiting review';
    case 'accepted': return 'accepted';
    case 'rejected': return 'rejected';
    case 'settled': return 'settled';
    case 'failed': return 'failed';
    case 'salvage': return 'salvaged';
  }
}

/** Single-character glyph for compact tables (no emoji per house rules). */
export function stateGlyph(state: DispatchState): string {
  switch (state) {
    case 'proposed': return '.';
    case 'claimed': return ':';
    case 'in_progress': return '>';
    case 'produced': return '*';
    case 'review_pending': return '?';
    case 'accepted': return '+';
    case 'rejected': return '!';
    case 'settled': return '#';
    case 'failed': return 'x';
    case 'salvage': return '-';
  }
}
