/**
 * lib/coordination-route-guard.ts — Route-level enforcement of the
 * envelope-encryption contract for adversarial-fleet projects.
 *
 * The contract:
 *   - For "ordinary" projects, /notes, /msg/:channel, and /tuples accept
 *     plaintext bodies (backwards compatible). No change for existing users.
 *   - For projects whose identity_project is `redteam-review` or
 *     `whitehat-defense`, the daemon refuses plaintext writes. The
 *     request body MUST carry an `envelope` field shaped like
 *     EnvelopePayload (validated by daemonAcceptsEnvelopeFor).
 *
 * Why route-level rather than DB-level:
 *   - The DB schema (notes, tuples, msg) is shared across all projects.
 *     Adding key_id columns would migrate every row of every project.
 *   - The route layer can refuse before the write touches storage,
 *     which is the perimeter we want for non-adversarial code paths.
 *
 * The crypto layer in `coordination-crypto.ts` is the real defense; this
 * is the daemon's perimeter check that complements it.
 */

import { daemonAcceptsEnvelopeFor, type EnvelopePayload } from './coordination-crypto.js';

const ADVERSARIAL_PROJECTS = new Set(['redteam-review', 'whitehat-defense']);

export type ProjectName = string | null | undefined;

export interface GuardOk {
  ok: true;
  /** When true, the route should persist the envelope as the row body
   *  (typically as JSON) instead of the original plaintext content. */
  envelopeRequired: boolean;
  /** The envelope, if present and valid. */
  envelope: EnvelopePayload | null;
}

export interface GuardDeny {
  ok: false;
  code: number; // HTTP status
  reason: string;
}

export type GuardDecision = GuardOk | GuardDeny;

/**
 * Check whether a write request is allowed for the given project.
 * The body should contain `envelope` (per `EnvelopePayload`) if the
 * project is adversarial. Plaintext content is allowed for all other
 * projects (backwards compatibility).
 */
export function checkAdversarialProjectWrite(
  project: ProjectName,
  body: unknown,
): GuardDecision {
  if (!project || !ADVERSARIAL_PROJECTS.has(project)) {
    return { ok: true, envelopeRequired: false, envelope: null };
  }

  // Adversarial project — require an envelope.
  if (typeof body !== 'object' || body === null) {
    return { ok: false, code: 403, reason: 'plaintext-write-refused-for-adversarial-project' };
  }
  const env = (body as { envelope?: unknown }).envelope;
  if (!env || typeof env !== 'object') {
    return { ok: false, code: 403, reason: 'envelope-required' };
  }
  if (!daemonAcceptsEnvelopeFor(env as EnvelopePayload, project)) {
    return { ok: false, code: 403, reason: 'envelope-rejected-by-daemon' };
  }
  return { ok: true, envelopeRequired: true, envelope: env as EnvelopePayload };
}

/**
 * Read-side guard: a peek at the row's persisted body. If the body
 * contains an envelope (key_id present) and the requester is not in
 * the project's namespace, refuse. The full ACL is in
 * `coordination-acl.ts`; this is a fast pre-filter.
 *
 * `requesterPersona` is the persona id the daemon believes is making
 * the read (e.g., "redteam:crypto", "defense:proofs", "secops:lead").
 * Daemons that don't track persona identity yet can pass null here
 * and the guard becomes a no-op (back-compat).
 */
export function checkAdversarialProjectRead(
  project: ProjectName,
  requesterPersona: string | null,
  bodyKeyId: string | null,
): GuardDecision {
  if (!project || !ADVERSARIAL_PROJECTS.has(project)) {
    return { ok: true, envelopeRequired: false, envelope: null };
  }
  // Lacking persona identity, we can't enforce — let it through; the
  // ciphertext is still opaque to anyone without the key. This is the
  // weakest link and is documented in comms-protocol.md.
  if (!requesterPersona) {
    return { ok: true, envelopeRequired: true, envelope: null };
  }
  // If the row has no envelope (legacy plaintext), there's nothing to gate.
  if (!bodyKeyId) {
    return { ok: true, envelopeRequired: false, envelope: null };
  }
  // sec-eng-lead has gate-mediated read access; the route should call
  // coordination-acl.check with a gateOp for that case.
  if (requesterPersona === 'secops:lead') {
    return { ok: true, envelopeRequired: true, envelope: null };
  }
  if (project === 'redteam-review' && !requesterPersona.startsWith('redteam:')) {
    return { ok: false, code: 403, reason: 'cross-fleet-read-redteam' };
  }
  if (project === 'whitehat-defense' && !requesterPersona.startsWith('defense:')) {
    return { ok: false, code: 403, reason: 'cross-fleet-read-defense' };
  }
  return { ok: true, envelopeRequired: true, envelope: null };
}

/** Inspect a tuple key namespace; returns the inferred project, if any. */
export function projectForTupleKey(key: string): ProjectName {
  if (typeof key !== 'string') return null;
  if (key.startsWith('smell:vuln:') || key.startsWith('smell:proof-gap:')) return 'redteam-review';
  if (key.startsWith('fix:') || key.startsWith('proof:landed:') || key.startsWith('proof:in-progress:')) return 'whitehat-defense';
  return null;
}

/** Inspect a messaging channel namespace; returns the inferred project. */
export function projectForChannel(channel: string): ProjectName {
  if (typeof channel !== 'string') return null;
  if (channel.startsWith('redteam:')) return 'redteam-review';
  if (channel.startsWith('defense:')) return 'whitehat-defense';
  return null;
}
