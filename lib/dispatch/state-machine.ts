/**
 * Dispatch state machine — the allowed-transitions table, in one place.
 *
 * Public state projection of the complete operation relation in admission.ts.
 * Recovery, reversible preparation, conflict recovery, and worker settlement
 * shortcuts are included. This graph has cycles and overapproximates concrete
 * eligibility; it does not authorize an operation. Actual queue and Harbormaster
 * writes use the mandatory atomic admission controller.
 *
 * Main review path (the complete operation graph also contains recovery edges):
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
import { DISPATCH_ADMISSION_MODEL } from './admission.js';

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
 * This is the union of registered operations, including recovery/back-edges.
 * Operation-specific preconditions are enforced at the mutation boundary.
 */
export function canTransition(from: DispatchState, to: DispatchState): boolean {
  if (from === to) return false; // not a transition
  return DISPATCH_ADMISSION_MODEL[from]?.includes(to) ?? false;
}

/** Throws with a clear message if the transition is illegal. */
export function assertTransition(from: DispatchState, to: DispatchState): void {
  if (!canTransition(from, to)) {
    throw new Error(
      `illegal dispatch transition: ${from} -> ${to} (allowed from ${from}: ` +
        `${nextStates(from).join(', ') || 'none'})`,
    );
  }
}

/** Returns all states reachable from `from` in one step. */
export function nextStates(from: DispatchState): DispatchState[] {
  return [...(DISPATCH_ADMISSION_MODEL[from] ?? [])];
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
