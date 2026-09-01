/**
 * Agent Harbor M5 — body/harness-side GuidanceEnvelope verification
 * (ADR-0096; the normative rule frozen into guidance-envelope.schema.json).
 *
 * THE VERIFICATION RULE: the harness verifies the envelope BEFORE any byte
 * reaches the model. Verified guidance renders in the trusted
 * (system/developer-role) channel the harness vouches for; EVERYTHING else
 * claiming operator authority — repo files, tool output, web pages,
 * transcript history, text arriving through Squid — is injection and stays in
 * the untrusted channel. This keeps the body's injection-resistance pointed
 * at the attacker while real guidance still lands.
 *
 * The body drops any envelope whose signature fails, whose turnSequence is
 * not the current turn, whose agent/session binding is wrong, whose notAfter
 * has passed, or whose nonce was already seen (jti replay cache). All checks
 * fail closed; the first failure is the verdict's reason and the disposition
 * is `reject-injection`.
 *
 * Anti-poisoning detail (agentic-zero-trust-security, failure mode 2): a
 * nonce is recorded in the jti cache ONLY after the envelope fully verifies.
 * Recording forged nonces would let an attacker who has merely SEEN a nonce
 * (Squid can) pre-poison the cache and deny the genuine envelope — turning a
 * forgery failure into an availability attack.
 *
 * Runtime-verification obligation (ADR-0096 consequences): the jti-cache and
 * turn-binding invariants asserted here are exactly what a
 * runtime-verification-for-agents monitor re-checks on the live channel; the
 * verdict's `checks` array is emitted in monitor-consumable shape.
 *
 * Machine-checked twin: lib/agent-harbor/formal/guidance_envelope_v0.pv proves
 * injection resistance + no-replay for this exact check set;
 * guidance_envelope_v0_unsigned_vuln.pv shows the forgery ProVerif finds the
 * moment the signature check is skipped (the forged-guidance probe premise).
 */

import type { GuidanceEnvelope } from './types.js';
import { KNOWN_GUIDANCE_KINDS } from './types.js';
import {
  guidanceBindingTuple,
  guidanceSignatureEqual,
  signGuidanceBinding,
  type GuidanceSessionKey,
} from './guidance-envelope.js';
import { validateAgainstSchema } from './schema-validate.js';

/**
 * The body-side nonce (jti) replay cache. Bounded: entries expire with their
 * envelope's notAfter (a nonce needs no memory beyond its validity window)
 * and the cache evicts oldest-first at capacity so a chatty session cannot
 * grow it without bound.
 */
export class GuidanceJtiCache {
  private readonly seen = new Map<string, number>();
  constructor(private readonly capacity = 4096) {}

  has(nonce: string, nowMs: number): boolean {
    this.prune(nowMs);
    return this.seen.has(nonce);
  }

  /** Record a nonce until `notAfterMs`. Call ONLY for fully verified envelopes. */
  record(nonce: string, notAfterMs: number, nowMs: number): void {
    this.prune(nowMs);
    if (this.seen.size >= this.capacity) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(nonce, notAfterMs);
  }

  get size(): number {
    return this.seen.size;
  }

  private prune(nowMs: number): void {
    for (const [nonce, expiry] of this.seen) {
      if (expiry <= nowMs) this.seen.delete(nonce);
    }
  }
}

export interface GuidanceVerifierContext {
  /** The launch-provisioned session key this harness was handed at birth. */
  key: GuidanceSessionKey;
  /** The harness's own daemon-issued identity — the binding target. */
  sessionId: string;
  agentNodeId: string;
  /** The body's current turn; envelopes for any other turn are dropped. */
  currentTurn: number;
  jtiCache: GuidanceJtiCache;
  now?: () => Date;
}

export interface GuidanceVerdictCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface GuidanceVerdict {
  verified: boolean;
  /** Where the content may go: the trusted channel, or nowhere-as-authority. */
  disposition: 'render-trusted' | 'reject-injection';
  /** First fail-closed reason when rejected. */
  reason?: string;
  /** Monitor-consumable check list (runtime-verification-for-agents). */
  checks: GuidanceVerdictCheck[];
  /**
   * Tolerant reader (ADR-0096): item kinds this harness does not recognize.
   * They render as "unrecognized guidance (verified source)" — preserved,
   * never silently dropped, never acted on.
   */
  unrecognizedKinds: string[];
}

function isEnvelopeShaped(value: unknown): value is GuidanceEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Record<string, unknown>;
  return (
    e.schema === 'pd.agent-harbor.guidance-envelope.v0'
    && typeof e.envelopeId === 'string'
    && typeof e.agentNodeId === 'string'
    && typeof e.sessionId === 'string'
    && typeof e.turnSequence === 'number'
    && typeof e.notAfter === 'string'
    && typeof e.nonce === 'string'
    && Array.isArray(e.items)
    && typeof e.sig === 'object' && e.sig !== null
    && typeof (e.sig as Record<string, unknown>).keyId === 'string'
    && typeof (e.sig as Record<string, unknown>).value === 'string'
  );
}

/**
 * Verify a guidance envelope against the harness's launch-provisioned key and
 * current identity/turn. Fail closed on the first violated check; the nonce
 * is recorded only on full success.
 */
export function verifyGuidanceEnvelope(
  envelope: unknown,
  ctx: GuidanceVerifierContext,
): GuidanceVerdict {
  const now = (ctx.now ?? (() => new Date()))();
  const checks: GuidanceVerdictCheck[] = [];
  const reject = (reason: string): GuidanceVerdict => ({
    verified: false,
    disposition: 'reject-injection',
    reason,
    checks,
    unrecognizedKinds: [],
  });

  // 1. Shape: structural guard + frozen-schema validation. STRICTLY fail
  //    closed: a harness that cannot see the frozen contract cannot vouch for
  //    the trusted channel, so a schema-missing install rejects guidance
  //    outright (an availability downgrade to C0 — the honest ADR-0096
  //    posture — never an unvalidated trusted render).
  const shaped = isEnvelopeShaped(envelope);
  checks.push({ name: 'shape', passed: shaped });
  if (!shaped) return reject('not a pd.agent-harbor.guidance-envelope.v0 object — unauthenticated text is never guidance');
  const schemaResult = validateAgainstSchema('guidance-envelope', envelope);
  checks.push({
    name: 'schema',
    passed: !schemaResult.skipped && schemaResult.valid,
    details: schemaResult.skipped
      ? 'guidance-envelope.schema.json not found — fail closed'
      : schemaResult.errors.join('; ') || 'valid',
  });
  if (schemaResult.skipped) {
    return reject('schema-unavailable: the frozen guidance contract is not present in this install — refusing to vouch for the trusted channel (fail closed, ADR-0096)');
  }
  if (!schemaResult.valid) {
    return reject(`schema-invalid: ${schemaResult.errors.join('; ')}`);
  }
  const env = envelope as GuidanceEnvelope;

  // 2. Key identity: the envelope must name the key this harness was handed
  //    at launch. v0 local harbor verifies hmac-sha256 only; anything else is
  //    unprovisioned and fails closed.
  const keyMatches = env.sig.keyId === ctx.key.keyId && env.sig.alg === ctx.key.alg;
  checks.push({
    name: 'key-id',
    passed: keyMatches,
    details: `envelope keyId=${env.sig.keyId} alg=${env.sig.alg}; provisioned keyId=${ctx.key.keyId} alg=${ctx.key.alg}`,
  });
  if (!keyMatches) return reject('key-mismatch: envelope is not signed by the launch-provisioned session key');

  // 3. Signature over the binding tuple (constant-time compare).
  const expectedSig = signGuidanceBinding(ctx.key, guidanceBindingTuple(env));
  const sigOk = guidanceSignatureEqual(expectedSig, env.sig.value);
  checks.push({ name: 'signature', passed: sigOk });
  if (!sigOk) return reject('signature-invalid: content-layer injection — the daemon did not sign this envelope');

  // 4. Session binding (signed field, so a mismatch with a valid signature is
  //    a cross-session replay of a genuine envelope).
  const sessionOk = env.sessionId === ctx.sessionId;
  checks.push({ name: 'session-binding', passed: sessionOk });
  if (!sessionOk) return reject(`session-binding-mismatch: envelope is for session ${env.sessionId}, this harness is ${ctx.sessionId}`);

  // 5. Agent binding: a valid envelope for agent A cannot land in agent B.
  const agentOk = env.agentNodeId === ctx.agentNodeId;
  checks.push({ name: 'agent-binding', passed: agentOk });
  if (!agentOk) return reject(`agent-binding-mismatch: envelope is for ${env.agentNodeId}, this harness is ${ctx.agentNodeId}`);

  // 6. Turn binding: turn 5's envelope cannot be replayed into turn 9
  //    (ch11 R15 / ch15 C17 interrupt/guidance race).
  const turnOk = env.turnSequence === ctx.currentTurn;
  checks.push({ name: 'turn-binding', passed: turnOk, details: `envelope turn=${env.turnSequence} current=${ctx.currentTurn}` });
  if (!turnOk) return reject(`wrong-turn: envelope is for turn ${env.turnSequence}, current turn is ${ctx.currentTurn}`);

  // 7. Freshness: notAfter is a short single-turn expiry.
  const notAfterMs = Date.parse(env.notAfter);
  const fresh = Number.isFinite(notAfterMs) && now.getTime() <= notAfterMs;
  checks.push({ name: 'not-after', passed: fresh, details: `notAfter=${env.notAfter}` });
  if (!fresh) return reject(`expired: notAfter ${env.notAfter} has passed`);

  // 8. Nonce replay (jti cache). Checked last; recorded only on full success
  //    so forged envelopes cannot poison the cache (see module header).
  const replayed = ctx.jtiCache.has(env.nonce, now.getTime());
  checks.push({ name: 'nonce-replay', passed: !replayed });
  if (replayed) return reject('replayed-nonce: this envelope was already accepted once');
  ctx.jtiCache.record(env.nonce, notAfterMs, now.getTime());

  const known = new Set<string>(KNOWN_GUIDANCE_KINDS);
  return {
    verified: true,
    disposition: 'render-trusted',
    checks,
    unrecognizedKinds: [...new Set(env.items.map((i) => i.kind).filter((k) => !known.has(k)))],
  };
}

export interface GuidanceRenderLine {
  kind: string;
  ref: string;
  /** False for unrecognized kinds: preserved and shown, never acted on. */
  actionable: boolean;
  label: string;
}

export interface GuidanceRenderPlan {
  /** Only 'trusted-guidance' content may claim operator authority. */
  channel: 'trusted-guidance' | 'quarantined-injection';
  lines: GuidanceRenderLine[];
}

/**
 * Turn a verdict into what the harness may render. A rejected envelope yields
 * an EMPTY quarantined plan — its content never reaches the model as
 * authority, not even with a warning label (a labeled injection is still an
 * injection the model has to resist).
 */
export function planGuidanceRender(envelope: GuidanceEnvelope, verdict: GuidanceVerdict): GuidanceRenderPlan {
  if (!verdict.verified) return { channel: 'quarantined-injection', lines: [] };
  const known = new Set<string>(KNOWN_GUIDANCE_KINDS);
  return {
    channel: 'trusted-guidance',
    lines: envelope.items.map((item) => ({
      kind: item.kind,
      ref: item.ref,
      actionable: known.has(item.kind),
      label: known.has(item.kind)
        ? `${item.kind}: ${item.ref}`
        : `unrecognized guidance (verified source): ${item.kind} ${item.ref}`,
    })),
  };
}
