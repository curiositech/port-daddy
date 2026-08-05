/**
 * Fleet incremental review coverage — durable, append-only, exact-SHA ledger.
 *
 * The fleet reviews a PR incrementally: every push gets a fresh SHIP verdict,
 * but nothing today records WHICH exact commit SHAs were actually covered, or
 * whether coverage was continuous. A gap (a SHA that was never reviewed
 * slipping between two that were) or a fork (two different review chains
 * both claiming to cover the same PR) would be invisible.
 *
 * This module is the storage-agnostic decision core for that ledger. Each
 * accepted record links a `sha` to the exact `predecessorSha` it was
 * reviewed against, forming a hash chain per `subject` (an opaque
 * caller-defined key — e.g. `owner/repo#123`): `base -> sha1 -> sha2 -> ...`.
 * A chain with no gaps and no forks is durable proof that every commit on
 * the subject received SHIP coverage, in order, with nothing skipped.
 *
 * What gets rejected, and why:
 *   - non-SHIP `kind`         — this ledger only ever records SHIP coverage;
 *                                any other kind is a caller bug, not data.
 *   - malformed SHA            — `sha`/`predecessorSha` must be exact
 *                                40-character lowercase hex (a real git SHA),
 *                                never a short SHA, ref name, or free text.
 *   - self-loop                — `sha === predecessorSha` can never be a real
 *                                git parent relationship.
 *   - predecessor gap          — `predecessorSha` names a commit this subject
 *                                has no coverage record for at all: the chain
 *                                cannot be extended from a SHA that was never
 *                                itself covered.
 *   - predecessor mismatch     — `predecessorSha` names a commit that WAS
 *                                covered earlier in this subject's history,
 *                                but is no longer the chain tip: extending
 *                                from it now would fork the ledger.
 *   - conflicting replay       — this exact `sha` is already recorded for the
 *                                subject with a DIFFERENT `predecessorSha`
 *                                (or kind): the same commit cannot have two
 *                                different reviewed histories.
 *
 * What gets allowed:
 *   - exact idempotent replay  — this exact `(subject, sha, predecessorSha)`
 *                                was already recorded: a retry of the same
 *                                submission is a no-op success, not an error.
 *
 * Persistence errors fail closed: any {@link CoverageStore} call that throws
 * is surfaced as `PERSISTENCE_ERROR` and the record is treated as rejected —
 * a storage hiccup must never be silently read as "covered".
 *
 * This module does not talk to D1, GitHub, or the queue; it defines the
 * contract a concrete store must satisfy ({@link CoverageStore}) and the pure
 * decision function ({@link recordShipCoverage}) that enforces it. Wiring a
 * real store, a route, or `merge_group`/AI execution is deliberately out of
 * scope here.
 */

/** Exact 40-character lowercase-hex git SHA — no short SHAs, no refs. */
const SHA_RE = /^[0-9a-f]{40}$/;

/** The only coverage kind this ledger accepts. */
export const SHIP_KIND = 'SHIP';

/** One durable, immutable row of the ledger. */
export interface CoverageRecord {
  /** Opaque caller-defined chain key, e.g. `owner/repo#123`. */
  subject: string;
  /** The exact commit SHA this record covers. */
  sha: string;
  /** The exact SHA `sha` was reviewed against (its chain parent). */
  predecessorSha: string;
  /** Always `'SHIP'` for an accepted record; see {@link SHIP_KIND}. */
  kind: string;
  /** Unix seconds this coverage was recorded. */
  recordedAt: number;
}

/** Input to {@link recordShipCoverage} — same shape as a stored record. */
export type CoverageInput = CoverageRecord;

export type CoverageRejectionCode =
  | 'INVALID_KIND'
  | 'MALFORMED_SHA'
  | 'SELF_LOOP'
  | 'PREDECESSOR_GAP'
  | 'PREDECESSOR_MISMATCH'
  | 'CONFLICTING_REPLAY'
  | 'PERSISTENCE_ERROR';

export type CoverageOutcome =
  | { accepted: true; replay: boolean }
  | { accepted: false; code: CoverageRejectionCode; message: string };

/**
 * Storage port a concrete backend (D1, in-memory, ...) implements. Every
 * method may throw; {@link recordShipCoverage} treats a throw as fail-closed
 * (`PERSISTENCE_ERROR`), never as "no record found".
 */
export interface CoverageStore {
  /**
   * The subject's current chain tip SHA, or `null` if this subject has no
   * coverage recorded yet.
   */
  getHead(subject: string): Promise<string | null>;
  /**
   * The previously recorded predecessor + kind for `(subject, sha)`, or
   * `null` if no such record exists.
   */
  getRecord(
    subject: string,
    sha: string,
  ): Promise<{ predecessorSha: string; kind: string } | null>;
  /**
   * Persist one new record and advance the subject's head to `record.sha`.
   * Called only after every validation above has passed — implementations
   * do not need to re-derive gap/mismatch/replay logic.
   */
  append(record: CoverageRecord): Promise<void>;
}

function reject(code: CoverageRejectionCode, message: string): CoverageOutcome {
  return { accepted: false, code, message };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Validate and (if accepted) durably append one SHIP review-coverage record.
 *
 * Order of checks: kind, SHA shape, self-loop are pure and checked first
 * (no store access needed). Idempotent-replay / conflict is checked next
 * against any existing record for this exact `sha`. Only then is the chain
 * head consulted to enforce continuity for a genuinely new `sha`.
 */
export async function recordShipCoverage(
  store: CoverageStore,
  input: CoverageInput,
): Promise<CoverageOutcome> {
  if (input.kind !== SHIP_KIND) {
    return reject('INVALID_KIND', `only '${SHIP_KIND}' coverage may be recorded, got '${input.kind}'`);
  }
  if (!SHA_RE.test(input.sha) || !SHA_RE.test(input.predecessorSha)) {
    return reject(
      'MALFORMED_SHA',
      'sha and predecessorSha must each be an exact 40-character lowercase-hex git SHA',
    );
  }
  if (input.sha === input.predecessorSha) {
    return reject('SELF_LOOP', `sha ${input.sha} cannot be its own predecessor`);
  }

  let existing: { predecessorSha: string; kind: string } | null;
  try {
    existing = await store.getRecord(input.subject, input.sha);
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }

  if (existing) {
    if (existing.predecessorSha === input.predecessorSha && existing.kind === input.kind) {
      return { accepted: true, replay: true };
    }
    return reject(
      'CONFLICTING_REPLAY',
      `sha ${input.sha} is already recorded for this subject with a different predecessor/kind`,
    );
  }

  let head: string | null;
  try {
    head = await store.getHead(input.subject);
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }

  if (head !== null && head !== input.predecessorSha) {
    let predecessorKnown: boolean;
    try {
      predecessorKnown = (await store.getRecord(input.subject, input.predecessorSha)) !== null;
    } catch (e) {
      return reject('PERSISTENCE_ERROR', errorMessage(e));
    }
    if (predecessorKnown) {
      return reject(
        'PREDECESSOR_MISMATCH',
        `predecessor ${input.predecessorSha} was covered earlier, but ${head} is now this subject's chain tip`,
      );
    }
    return reject(
      'PREDECESSOR_GAP',
      `predecessor ${input.predecessorSha} has no recorded coverage for this subject`,
    );
  }
  // head === null: no coverage recorded yet for this subject, so this record
  // establishes the root of the chain unconditionally — there is nothing to
  // check continuity against.

  try {
    await store.append({
      subject: input.subject,
      sha: input.sha,
      predecessorSha: input.predecessorSha,
      kind: input.kind,
      recordedAt: input.recordedAt,
    });
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }

  return { accepted: true, replay: false };
}

/**
 * In-memory {@link CoverageStore} — reference implementation for tests and a
 * template for a real (e.g. D1) backend. Not exported for production use.
 */
export function createInMemoryCoverageStore(): CoverageStore {
  const heads = new Map<string, string>();
  const records = new Map<string, { predecessorSha: string; kind: string }>();
  const key = (subject: string, sha: string) => `${subject} ${sha}`;

  return {
    async getHead(subject) {
      return heads.get(subject) ?? null;
    },
    async getRecord(subject, sha) {
      return records.get(key(subject, sha)) ?? null;
    },
    async append(record) {
      records.set(key(record.subject, record.sha), {
        predecessorSha: record.predecessorSha,
        kind: record.kind,
      });
      heads.set(record.subject, record.sha);
    },
  };
}
