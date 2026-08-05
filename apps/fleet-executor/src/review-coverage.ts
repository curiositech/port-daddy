/**
 * Fleet incremental review coverage — durable, append-only, exact-SHA ledger.
 *
 * The fleet reviews a PR incrementally: every push gets a fresh verdict, but
 * nothing records WHICH exact commit range was actually covered, by whom,
 * against which receipt, or whether coverage was continuous from a trusted
 * origin. A gap (a commit that slipped between two reviewed ranges), a fork
 * (two chains both claiming the same subject), or a lost update (two
 * concurrent appends racing on the same head) would all be invisible.
 *
 * This module is the storage-agnostic decision core for that ledger. Each
 * accepted piece of evidence links a `subject` (an opaque caller-defined
 * chain key, e.g. `owner/repo#123`) to one reviewed hop: `base -> head`,
 * carrying the full ordered list of `commits` strictly after `base` up to
 * and including `head` — proof that nothing in between was skipped. A chain
 * with no gaps, no forks, and no missing commits is durable proof that every
 * commit on the subject received continuous review coverage.
 *
 * A hop's evidence always names a `verdict`: `'SHIP'`, `'SHIP-AFTER-FIX'`, or
 * `'DO-NOT-SHIP'`. All three are recorded — the ledger is the audit trail of
 * every review outcome, not just the successful ones — but only a `'SHIP'`
 * verdict advances the subject's chain tip. A `SHIP-AFTER-FIX` or
 * `DO-NOT-SHIP` entry is durable evidence that a range was reviewed and
 * rejected; it never moves coverage forward.
 *
 * The first hop for a subject (`store.getHead` returns `null`) must name the
 * subject's pre-registered trusted base as `base` exactly — coverage can
 * never bootstrap itself from whatever predecessor a caller happens to
 * assert first. A subject with no trusted base configured has no valid root
 * at all.
 *
 * Every append is a single atomic compare-and-swap over the subject head:
 * {@link CoverageStore.appendEvidence} checks for an existing record at this
 * exact `(subject, head)` AND (for a SHIP verdict) checks the live head
 * still equals the `expectedPriorHead` this call computed, in one
 * synchronous critical section with no `await` between the check and the
 * write. This is what separates two distinct failure modes that look
 * similar but are not:
 *   - `PREDECESSOR_MISMATCH` / `PREDECESSOR_GAP` — the evidence itself was
 *     built against a `base` that is stale or unknown, discovered on READ,
 *     before any write is attempted.
 *   - `STALE_CONCURRENT_APPEND` — the evidence was built against a `base`
 *     that WAS the live head at read time, but a competing append won the
 *     race and advanced the head first; discovered at WRITE time by the CAS.
 * Both are rejections; a caller that loses the race gets an honest signal
 * and must retry with a fresh read, never a silent overwrite.
 *
 * What else gets rejected, and why:
 *   - non-tri-state verdict    — `verdict` must be exactly one of SHIP,
 *                                SHIP-AFTER-FIX, DO-NOT-SHIP.
 *   - incomplete evidence      — `subject`/`reviewerId`/`runId`/
 *                                `evidenceLocator` must be non-blank: this
 *                                ledger's whole point is attributable
 *                                evidence, not anonymous claims.
 *   - malformed SHA             — `base`, `head`, and every entry of
 *                                `commits` must be exact 40-character
 *                                lowercase hex (a real git SHA), never a
 *                                short SHA, ref name, or free text.
 *   - self-loop                 — `head === base` can never be a real git
 *                                parent relationship.
 *   - missing intermediate
 *     commits                   — `commits` must be non-empty, contain no
 *                                duplicates, never include `base` itself,
 *                                and end with exactly `head`: an empty or
 *                                truncated list is a caller claiming a hop
 *                                happened without naming which commits it
 *                                actually covered.
 *   - unverifiable range        — if the caller supplies a `rangeDigest`, it
 *                                must equal {@link computeRangeDigest}(base,
 *                                head, commits) exactly; a mismatch means
 *                                the range and its claimed fingerprint
 *                                disagree and neither can be trusted.
 *   - root trust violation      — see above.
 *   - predecessor gap / mismatch — see above.
 *   - conflicting replay        — this exact `(subject, head)` is already
 *                                recorded with a different base, commits,
 *                                verdict, or evidence identity: the same
 *                                commit cannot have two different reviewed
 *                                histories.
 *   - stale concurrent append   — see above.
 *
 * What gets allowed:
 *   - exact idempotent replay   — this exact evidence record was already
 *                                recorded verbatim for `(subject, head)`: a
 *                                retry of the same submission is a no-op
 *                                success, not an error, regardless of
 *                                verdict.
 *
 * Persistence errors fail closed: any {@link CoverageStore} call that throws
 * is surfaced as `PERSISTENCE_ERROR` and the record is treated as rejected —
 * a storage hiccup must never be silently read as "covered".
 *
 * This module does not talk to D1, GitHub, or the queue; it defines the
 * contract a concrete store must satisfy ({@link CoverageStore}) and the
 * pure decision function ({@link recordReviewCoverage}) that enforces it.
 * Wiring a real store, a route, a relay schema, or merge_group/AI execution
 * is deliberately out of scope here.
 */

/** Exact 40-character lowercase-hex git SHA — no short SHAs, no refs. */
const SHA_RE = /^[0-9a-f]{40}$/;

/** The three coverage verdicts this ledger accepts as evidence. */
export const VERDICTS = ['SHIP', 'SHIP-AFTER-FIX', 'DO-NOT-SHIP'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Convenience constants, so callers never hand-type the literal strings. */
export const SHIP: Verdict = 'SHIP';
export const SHIP_AFTER_FIX: Verdict = 'SHIP-AFTER-FIX';
export const DO_NOT_SHIP: Verdict = 'DO-NOT-SHIP';

/** Caller-submitted evidence for one reviewed hop of a subject's chain. */
export interface CoverageInput {
  /** Opaque caller-defined chain key, e.g. `owner/repo#123`. */
  subject: string;
  /** Verified predecessor commit — exclusive lower bound of this hop. */
  base: string;
  /** Verified head commit — this hop's claimed new chain tip. */
  head: string;
  /**
   * Full, ordered list of commit SHAs strictly after `base` up to and
   * including `head`. Must be non-empty, duplicate-free, exclude `base`,
   * and end with `head`.
   */
  commits: string[];
  /**
   * Optional unambiguous digest of the range. When present it must match
   * {@link computeRangeDigest}(base, head, commits) or the record is
   * rejected as UNVERIFIABLE_RANGE. When omitted, `commits` alone (the
   * full explicit range) is the source of truth.
   */
  rangeDigest?: string | null;
  verdict: Verdict;
  /** Identity of the reviewer (human or fleet ship) that produced this verdict. */
  reviewerId: string;
  /** Identity of the run/receipt that produced this evidence. */
  runId: string;
  /** Locator for the underlying evidence (receipt URL, transcript path, ...). */
  evidenceLocator: string;
  /** Unix seconds this evidence was recorded. */
  recordedAt: number;
}

/**
 * A durable, immutable evidence record as stored by the ledger — identical
 * to {@link CoverageInput} except `rangeDigest` is always the canonical,
 * server-computed digest (never the caller-supplied one, though the two
 * must have matched at accept time).
 */
export interface CoverageEvidence extends Omit<CoverageInput, 'rangeDigest'> {
  rangeDigest: string;
}

export type CoverageRejectionCode =
  | 'INVALID_VERDICT'
  | 'INCOMPLETE_EVIDENCE'
  | 'MALFORMED_SHA'
  | 'SELF_LOOP'
  | 'MISSING_INTERMEDIATE_COMMITS'
  | 'UNVERIFIABLE_RANGE'
  | 'ROOT_TRUST_VIOLATION'
  | 'PREDECESSOR_GAP'
  | 'PREDECESSOR_MISMATCH'
  | 'CONFLICTING_REPLAY'
  | 'STALE_CONCURRENT_APPEND'
  | 'PERSISTENCE_ERROR';

export type CoverageOutcome =
  | { accepted: true; replay: boolean; advanced: boolean }
  | { accepted: false; code: CoverageRejectionCode; message: string };

/** Result of one atomic append attempt against a {@link CoverageStore}. */
export type AppendResult =
  | { ok: true; replay: boolean }
  | { ok: false; reason: 'CONFLICT' }
  | { ok: false; reason: 'STALE_HEAD'; actualHead: string | null };

/**
 * Storage port a concrete backend (D1, in-memory, ...) implements. Every
 * method may throw; {@link recordReviewCoverage} treats a throw as
 * fail-closed (`PERSISTENCE_ERROR`), never as "no record found".
 */
export interface CoverageStore {
  /**
   * The subject's pre-registered trusted root base, or `null` if none is
   * configured (in which case the subject has no valid root yet).
   */
  getTrustedBase(subject: string): Promise<string | null>;
  /**
   * The subject's current SHIP chain tip, or `null` if no SHIP evidence has
   * ever been accepted for this subject.
   */
  getHead(subject: string): Promise<string | null>;
  /** Whether `sha` was ever an accepted SHIP head for `subject` (even if it is no longer the tip). */
  isKnownShipHead(subject: string, sha: string): Promise<boolean>;
  /** The stored evidence for `(subject, head)`, or `null` if none exists. */
  getEvidence(subject: string, head: string): Promise<CoverageEvidence | null>;
  /**
   * Atomically: (1) check for an existing record at `(evidence.subject,
   * evidence.head)` — identical means idempotent replay, different means
   * CONFLICT; (2) for a SHIP verdict with no existing record, compare-and-swap
   * the subject head from `expectedPriorHead` to `evidence.head` — a
   * mismatch means STALE_HEAD; (3) on success, persist the evidence and (for
   * SHIP) advance the head. Steps 1–3 MUST happen with no `await` between
   * the read and the write, so no other call can observe or act on
   * intermediate state.
   */
  appendEvidence(evidence: CoverageEvidence, expectedPriorHead: string | null): Promise<AppendResult>;
}

function reject(code: CoverageRejectionCode, message: string): CoverageOutcome {
  return { accepted: false, code, message };
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isBlank(s: string): boolean {
  return typeof s !== 'string' || s.trim().length === 0;
}

/** Exact-match comparison used to distinguish idempotent replay from conflict. */
function evidenceEqual(a: CoverageEvidence, b: CoverageEvidence): boolean {
  return (
    a.subject === b.subject &&
    a.base === b.base &&
    a.head === b.head &&
    a.verdict === b.verdict &&
    a.reviewerId === b.reviewerId &&
    a.runId === b.runId &&
    a.evidenceLocator === b.evidenceLocator &&
    a.rangeDigest === b.rangeDigest &&
    a.recordedAt === b.recordedAt &&
    a.commits.length === b.commits.length &&
    a.commits.every((c, i) => c === b.commits[i])
  );
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Canonical, unambiguous digest of one hop's range. Pure and deterministic:
 * the same `(base, head, commits)` always yields the same digest, and any
 * change to any of the three yields a different one. Uses Web Crypto
 * (`crypto.subtle`), not `node:crypto` — this module runs on Cloudflare
 * Workers, where only Web Crypto is available.
 */
export async function computeRangeDigest(base: string, head: string, commits: string[]): Promise<string> {
  const data = new TextEncoder().encode(`${base}\n${head}\n${commits.join('\n')}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

/**
 * Validate and (if accepted) durably append one review-coverage evidence
 * record.
 *
 * Order of checks: verdict, evidence completeness, SHA shape, self-loop,
 * and commit-range completeness are pure and checked first (no store
 * access needed). Range digest verification is pure but hashes, so it runs
 * after the cheaper structural checks. Only once the evidence is
 * structurally sound is the store consulted — first for an exact-replay
 * check against `(subject, head)` (an idempotent replay must succeed, and a
 * conflicting one must be rejected, regardless of whether `head` is still
 * this subject's chain tip), then to establish root trust or chain
 * continuity against the live head, then to perform the atomic append
 * itself. Checking replay before continuity is what lets a caller safely
 * retry an already-recorded, now-superseded hop without it being
 * misdiagnosed as a predecessor gap or mismatch.
 */
export async function recordReviewCoverage(store: CoverageStore, input: CoverageInput): Promise<CoverageOutcome> {
  if (!VERDICTS.includes(input.verdict)) {
    return reject('INVALID_VERDICT', `verdict must be one of ${VERDICTS.join(', ')}, got '${input.verdict}'`);
  }
  if (isBlank(input.subject) || isBlank(input.reviewerId) || isBlank(input.runId) || isBlank(input.evidenceLocator)) {
    return reject(
      'INCOMPLETE_EVIDENCE',
      'subject, reviewerId, runId, and evidenceLocator must all be non-blank',
    );
  }
  if (!SHA_RE.test(input.base) || !SHA_RE.test(input.head)) {
    return reject('MALFORMED_SHA', 'base and head must each be an exact 40-character lowercase-hex git SHA');
  }
  if (!input.commits.every((c) => SHA_RE.test(c))) {
    return reject('MALFORMED_SHA', 'every entry in commits must be an exact 40-character lowercase-hex git SHA');
  }
  if (input.head === input.base) {
    return reject('SELF_LOOP', `head ${input.head} cannot be its own base`);
  }
  if (input.commits.length === 0) {
    return reject('MISSING_INTERMEDIATE_COMMITS', 'commits must list every commit from base to head; got an empty list');
  }
  if (input.commits[input.commits.length - 1] !== input.head) {
    return reject(
      'MISSING_INTERMEDIATE_COMMITS',
      `commits must end with head (${input.head}); the range is not fully covered`,
    );
  }
  if (input.commits.includes(input.base)) {
    return reject('MISSING_INTERMEDIATE_COMMITS', `commits must not include base (${input.base}); base is exclusive`);
  }
  if (new Set(input.commits).size !== input.commits.length) {
    return reject('MISSING_INTERMEDIATE_COMMITS', 'commits must not contain duplicate entries');
  }

  const canonicalDigest = await computeRangeDigest(input.base, input.head, input.commits);
  if (input.rangeDigest != null && input.rangeDigest !== canonicalDigest) {
    return reject(
      'UNVERIFIABLE_RANGE',
      'rangeDigest does not match the digest computed from base, head, and commits',
    );
  }

  const evidence: CoverageEvidence = {
    subject: input.subject,
    base: input.base,
    head: input.head,
    commits: input.commits,
    rangeDigest: canonicalDigest,
    verdict: input.verdict,
    reviewerId: input.reviewerId,
    runId: input.runId,
    evidenceLocator: input.evidenceLocator,
    recordedAt: input.recordedAt,
  };

  let existingEvidence: CoverageEvidence | null;
  try {
    existingEvidence = await store.getEvidence(input.subject, input.head);
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }
  if (existingEvidence) {
    if (evidenceEqual(existingEvidence, evidence)) {
      return { accepted: true, replay: true, advanced: existingEvidence.verdict === SHIP };
    }
    return reject(
      'CONFLICTING_REPLAY',
      `head ${input.head} is already recorded for this subject with different evidence`,
    );
  }

  let trustedBase: string | null;
  let head: string | null;
  try {
    trustedBase = await store.getTrustedBase(input.subject);
    head = await store.getHead(input.subject);
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }

  let expectedPriorHead: string | null;
  if (head === null) {
    if (trustedBase === null) {
      return reject('ROOT_TRUST_VIOLATION', `no trusted base is configured for subject '${input.subject}'`);
    }
    if (input.base !== trustedBase) {
      return reject(
        'ROOT_TRUST_VIOLATION',
        `the first record for a subject must name its configured trusted base (${trustedBase}) as base, got ${input.base}`,
      );
    }
    expectedPriorHead = null;
  } else if (input.base === head) {
    expectedPriorHead = head;
  } else {
    let knownStale: boolean;
    try {
      knownStale = await store.isKnownShipHead(input.subject, input.base);
    } catch (e) {
      return reject('PERSISTENCE_ERROR', errorMessage(e));
    }
    if (knownStale) {
      return reject(
        'PREDECESSOR_MISMATCH',
        `base ${input.base} was covered earlier, but ${head} is now this subject's chain tip`,
      );
    }
    return reject('PREDECESSOR_GAP', `base ${input.base} has no recorded SHIP coverage for this subject`);
  }

  let result: AppendResult;
  try {
    result = await store.appendEvidence(evidence, expectedPriorHead);
  } catch (e) {
    return reject('PERSISTENCE_ERROR', errorMessage(e));
  }

  if (!result.ok) {
    if (result.reason === 'CONFLICT') {
      return reject(
        'CONFLICTING_REPLAY',
        `head ${input.head} is already recorded for this subject with different evidence`,
      );
    }
    return reject(
      'STALE_CONCURRENT_APPEND',
      `subject head advanced to ${result.actualHead ?? '(unknown)'} before this append landed; retry with fresh evidence`,
    );
  }

  return { accepted: true, replay: result.replay, advanced: input.verdict === SHIP };
}

/**
 * In-memory {@link CoverageStore} — reference implementation for tests and a
 * template for a real (e.g. D1) backend. Trusted bases are configured
 * out-of-band via `setTrustedBase` (never inferred from the first record).
 * Not exported for production use.
 */
export function createInMemoryCoverageStore(): CoverageStore & {
  setTrustedBase(subject: string, base: string): void;
} {
  const trustedBases = new Map<string, string>();
  const heads = new Map<string, string>();
  const knownShipHeads = new Map<string, Set<string>>();
  const evidenceByKey = new Map<string, CoverageEvidence>();
  const key = (subject: string, head: string) => `${subject} ${head}`;

  return {
    setTrustedBase(subject, base) {
      trustedBases.set(subject, base);
    },
    async getTrustedBase(subject) {
      return trustedBases.get(subject) ?? null;
    },
    async getHead(subject) {
      return heads.get(subject) ?? null;
    },
    async isKnownShipHead(subject, sha) {
      return knownShipHeads.get(subject)?.has(sha) ?? false;
    },
    async getEvidence(subject, head) {
      return evidenceByKey.get(key(subject, head)) ?? null;
    },
    async appendEvidence(evidence, expectedPriorHead) {
      // Everything below is synchronous — no `await` between the existence
      // check and the write — so this is one atomic critical section even
      // though the surrounding method is `async`.
      const k = key(evidence.subject, evidence.head);
      const existing = evidenceByKey.get(k);
      if (existing) {
        return evidenceEqual(existing, evidence) ? { ok: true, replay: true } : { ok: false, reason: 'CONFLICT' };
      }
      if (evidence.verdict === SHIP) {
        const actualHead = heads.get(evidence.subject) ?? null;
        if (actualHead !== expectedPriorHead) {
          return { ok: false, reason: 'STALE_HEAD', actualHead };
        }
      }
      evidenceByKey.set(k, evidence);
      if (evidence.verdict === SHIP) {
        heads.set(evidence.subject, evidence.head);
        let set = knownShipHeads.get(evidence.subject);
        if (!set) {
          set = new Set();
          knownShipHeads.set(evidence.subject, set);
        }
        set.add(evidence.head);
      }
      return { ok: true, replay: false };
    },
  };
}
