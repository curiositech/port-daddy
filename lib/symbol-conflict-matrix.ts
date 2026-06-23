/**
 * The claim-type conflict matrix (semantic-conflict-prediction discipline).
 *
 * Two agents declare claims on the SAME symbol; whether that's a conflict depends on
 * what each intends to do. `read`/`modify` are the common pair, but creation
 * (`add-sibling`/`add-child`), `delete`, and `rename` have their own semantics —
 * notably **`rename`, the most dangerous claim type**: it's an implicit read-claim on
 * every reference site, so a rename clashes with anything else on the symbol.
 *
 * This is pure data + a lookup so the rule is auditable in one place and reused by
 * `symbol-index.predictConflicts` (the engine) and `symbol-claims` (the typed-claim store).
 */

export type ClaimType = 'read' | 'modify' | 'add-sibling' | 'add-child' | 'delete' | 'rename';
export type ConflictSeverity = 'blocking' | 'warning' | 'safe';

/**
 * Severity when claim A and claim B land on the same symbol. Read row = A's type,
 * column = B's type. Symmetric by construction.
 *
 *               modify   read     add-sib  add-child delete   rename
 *  modify       blocking warning  safe     warning   blocking blocking
 *  read         warning  safe     safe     safe      blocking blocking
 *  add-sibling  safe     safe     safe     safe      warning  warning
 *  add-child    warning  safe     safe     warning   blocking blocking
 *  delete       blocking blocking warning  blocking  blocking blocking
 *  rename       blocking blocking warning  blocking  blocking blocking
 */
const MATRIX: Record<ClaimType, Record<ClaimType, ConflictSeverity>> = {
  modify: { modify: 'blocking', read: 'warning', 'add-sibling': 'safe', 'add-child': 'warning', delete: 'blocking', rename: 'blocking' },
  read: { modify: 'warning', read: 'safe', 'add-sibling': 'safe', 'add-child': 'safe', delete: 'blocking', rename: 'blocking' },
  'add-sibling': { modify: 'safe', read: 'safe', 'add-sibling': 'safe', 'add-child': 'safe', delete: 'warning', rename: 'warning' },
  'add-child': { modify: 'warning', read: 'safe', 'add-sibling': 'safe', 'add-child': 'warning', delete: 'blocking', rename: 'blocking' },
  delete: { modify: 'blocking', read: 'blocking', 'add-sibling': 'warning', 'add-child': 'blocking', delete: 'blocking', rename: 'blocking' },
  rename: { modify: 'blocking', read: 'blocking', 'add-sibling': 'warning', 'add-child': 'blocking', delete: 'blocking', rename: 'blocking' },
};

/** Severity of two same-symbol claims. Unknown types fall back to `warning` (fail-safe). */
export function matrixConflict(a: ClaimType, b: ClaimType): ConflictSeverity {
  return MATRIX[a]?.[b] ?? 'warning';
}

/**
 * A claim that alters or removes a symbol's contract — so anything depending on that
 * symbol (callers, readers) may break. `add-sibling`/`add-child` do NOT change the
 * existing symbol's contract (adding a new method doesn't break callers of old ones),
 * and `read` only observes. These three are what the dependency/signature/transitive
 * graph checks fire on.
 */
const CONTRACT_CHANGING: ReadonlySet<ClaimType> = new Set<ClaimType>(['modify', 'delete', 'rename']);

export function isContractChanging(type: ClaimType): boolean {
  return CONTRACT_CHANGING.has(type);
}

export const ALL_CLAIM_TYPES: readonly ClaimType[] = ['read', 'modify', 'add-sibling', 'add-child', 'delete', 'rename'];

/** Narrow an arbitrary string to a ClaimType, defaulting unknown/blank to `modify`. */
export function coerceClaimType(t: unknown): ClaimType {
  return (ALL_CLAIM_TYPES as readonly string[]).includes(t as string) ? (t as ClaimType) : 'modify';
}
