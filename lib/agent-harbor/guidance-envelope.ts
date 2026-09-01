/**
 * Agent Harbor M5 — daemon-side GuidanceEnvelope assembly and signing
 * (ADR-0096, binder ch03/ch19; built against the frozen
 * schemas/agent-harbor/v0/guidance-envelope.schema.json contract).
 *
 * The daemon gets "in front of" an agent's turns by assembling a signed
 * guidance envelope at turn start — inbox messages, conflict warnings, skill
 * grafts, memory packets, repo updates — and delivering it over the gated
 * daemon CONTROL channel (a `steer` ControlCommand), never as injected user
 * text. The body's harness verifies the signature before any byte reaches the
 * model (lib/agent-harbor/guidance-verifier.ts); everything unverified stays
 * in the untrusted channel. That reframe (ADR-0096) is what lets a
 * well-aligned body treat unauthenticated "operator" text as the injection it
 * is while still receiving real guidance.
 *
 * Key establishment (ADR-0096 mechanism 1): at body registration — the C2
 * adapter nonce challenge — the daemon provisions a per-session signing key
 * over the loopback socket, never on the wire. Local harbor v0 uses a
 * per-session HMAC secret; the key is bound to (sessionId, agentNodeId) and
 * expires with the session lease. Successor runs get a fresh key at their own
 * registration (ADR-0096 open question 2 resolution).
 *
 * Signature (mechanism 2): every envelope is signed over the binding tuple
 *   canonical(sessionId, agentNodeId, turnSequence, envelopeContentHash,
 *             notAfter, nonce)
 * so a valid envelope for agent A's turn 5 cannot be replayed into agent B or
 * into A's turn 9, and no payload field can be tampered post-signature.
 *
 * Proof: the injection-resistance and no-replay properties of this exact
 * protocol are machine-checked in lib/agent-harbor/formal/guidance_envelope_v0.pv
 * (ProVerif; results checked in). The suggestibility honesty gate
 * (suggestibility-authority.ts) refuses C3 unless that model verifies.
 *
 * Skill lenses: agentic-zero-trust-security (signed envelopes, jti replay
 * caches, no ambient authority), fleet-event-spawn-trust (transport auth is
 * not content trust — this channel is the symmetric twin of the ADR-0093
 * event->spawn gate), proverif-tamarin-protocol-modeling (the proof
 * obligation), agentic-app-architecture (guidance is a capability-scoped
 * daemon surface, not prompt text).
 */

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AdapterKind,
  AgentNodeView,
  ComplianceProbeResult,
  ControlCommand,
  GuidanceAuthority,
  GuidanceEnvelope,
  GuidanceItem,
  GuidanceSigAlg,
} from './types.js';
import { validateAgainstSchema } from './schema-validate.js';
import { applyControlGate, makeControlCommand } from './control-gate.js';

/**
 * A launch-provisioned session signing key (ADR-0096 mechanism 1). The secret
 * NEVER appears inside an envelope; it lives on the two loopback endpoints
 * only. v0 local-harbor path is symmetric HMAC — cheap, never on the wire.
 */
export interface GuidanceSessionKey {
  keyId: string;
  alg: GuidanceSigAlg;
  sessionId: string;
  agentNodeId: string;
  establishedAt: string;
  /** hmac-sha256 secret (local harbor v0). */
  secret: Buffer;
}

/**
 * Establish the per-session guidance-signing key. In the live daemon this is
 * called at body registration (the C2 adapter nonce challenge) and the
 * material crosses only the loopback socket. Key material is bound to
 * (sessionId, agentNodeId); a successor run must call this again — old
 * envelopes never carry across the run boundary.
 */
export function establishGuidanceKey(
  sessionId: string,
  agentNodeId: string,
  opts: { now?: () => string } = {},
): GuidanceSessionKey {
  if (!sessionId || !agentNodeId) {
    throw new Error('guidance key requires a daemon-issued sessionId and agentNodeId — identities are minted, never self-picked');
  }
  return {
    keyId: `gk_${sessionId}`,
    alg: 'hmac-sha256',
    sessionId,
    agentNodeId,
    establishedAt: (opts.now ?? (() => new Date().toISOString()))(),
    secret: randomBytes(32),
  };
}

/** Deterministic canonical JSON: sorted object keys, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** An envelope before (or ignoring) its signature — the signed content. */
export type GuidanceEnvelopeContent = Pick<
  GuidanceEnvelope,
  'schema' | 'envelopeId' | 'agentNodeId' | 'sessionId' | 'turnSequence'
  | 'issuedAt' | 'notAfter' | 'nonce' | 'items' | 'authority'
> & { sig?: GuidanceEnvelope['sig']; [key: string]: unknown };

/**
 * envelopeContentHash: sha256 over the canonical JSON of the envelope minus
 * `sig`. Covers the FULL payload (items, authority, ids, times) so no field
 * can be tampered post-signature (ADR-0096 mechanism 2).
 */
export function envelopeContentHash(envelope: GuidanceEnvelopeContent): string {
  const { sig: _sig, ...content } = envelope;
  return createHash('sha256').update(canonicalJson(content), 'utf8').digest('hex');
}

/** Domain-separated canonical binding tuple — the exact bytes that get signed. */
export function guidanceBindingTuple(envelope: GuidanceEnvelopeContent): string {
  return `pd.agent-harbor.guidance-envelope.v0\n${canonicalJson([
    envelope.sessionId,
    envelope.agentNodeId,
    envelope.turnSequence,
    envelopeContentHash(envelope),
    envelope.notAfter,
    envelope.nonce,
  ])}`;
}

/** HMAC-SHA256 over the binding tuple, base64. */
export function signGuidanceBinding(key: GuidanceSessionKey, bindingTuple: string): string {
  return createHmac('sha256', key.secret).update(bindingTuple, 'utf8').digest('base64');
}

/** Constant-time signature comparison (both sides recomputed as base64). */
export function guidanceSignatureEqual(expectedB64: string, actualB64: string): boolean {
  const expected = Buffer.from(expectedB64, 'base64');
  const actual = Buffer.from(actualB64, 'base64');
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface AssembleGuidanceOptions {
  turnSequence: number;
  items: GuidanceItem[];
  /**
   * Operator-authority attenuation (ADR-0096 mechanism 3). Defaults to the
   * solo-local posture: loopback IS operator authority, recorded as
   * daemon-policy. Team/remote harbors MUST pass mode=macaroon with the
   * attenuated authorityRef.
   */
  authority?: GuidanceAuthority;
  /** Envelope validity window; short — single-turn (default 120s). */
  validityMs?: number;
  now?: () => Date;
}

/**
 * Assemble and sign a GuidanceEnvelope for one turn. Fail-closed: validates
 * against the frozen v0 schema before returning, and refuses a macaroon-mode
 * authority without an authorityRef (an unattributable teammate steer is the
 * exact hole mechanism 3 exists to close).
 */
export function assembleGuidanceEnvelope(
  key: GuidanceSessionKey,
  opts: AssembleGuidanceOptions,
): GuidanceEnvelope {
  const now = (opts.now ?? (() => new Date()))();
  const authority: GuidanceAuthority = opts.authority ?? {
    mode: 'loopback',
    authorityRef: null,
    operatorAction: 'daemon-policy',
  };
  if (authority.mode === 'macaroon' && !authority.authorityRef) {
    throw new Error('macaroon-mode guidance requires the attenuated authorityRef (ADR-0096 mechanism 3) — team/remote guidance must chain to an operator action');
  }
  if (!Number.isInteger(opts.turnSequence) || opts.turnSequence < 0) {
    throw new Error(`turnSequence must be a non-negative integer, got ${opts.turnSequence}`);
  }
  const unsigned: GuidanceEnvelopeContent = {
    schema: 'pd.agent-harbor.guidance-envelope.v0',
    envelopeId: `genv_${randomUUID()}`,
    agentNodeId: key.agentNodeId,
    sessionId: key.sessionId,
    turnSequence: opts.turnSequence,
    issuedAt: now.toISOString(),
    notAfter: new Date(now.getTime() + (opts.validityMs ?? 120_000)).toISOString(),
    nonce: randomBytes(18).toString('base64'),
    items: opts.items,
    authority,
  };
  const envelope: GuidanceEnvelope = {
    ...unsigned,
    sig: {
      alg: key.alg,
      keyId: key.keyId,
      value: signGuidanceBinding(key, guidanceBindingTuple(unsigned)),
    },
  };
  // STRICTLY fail-closed, unlike the general assertAgainstSchema path (which
  // honestly skips when schemas/ is absent, a deliberate fail-safe for the C2
  // emit paths): the guidance channel is an AUTHORITY channel, so a trimmed
  // install missing the frozen contract must not emit signed guidance at all
  // (ADR-0096 "schema-validated before emit").
  const schemaResult = validateAgainstSchema('guidance-envelope', envelope);
  if (schemaResult.skipped) {
    throw new Error('guidance-envelope.schema.json not found — refusing to emit unvalidated guidance (fail closed, ADR-0096); restore schemas/agent-harbor/v0/ or set PORT_DADDY_SCHEMA_DIR');
  }
  if (!schemaResult.valid) {
    throw new Error(`agent-harbor v0 contract violation (guidance-envelope): ${schemaResult.errors.join('; ')}`);
  }
  return envelope;
}

/**
 * Deliver a guidance envelope over the daemon CONTROL channel — a gated
 * `steer` ControlCommand carrying the envelope as payload — never injected as
 * user text. The compliance gate applies: steer requires witnessed C3, so
 * observed bodies and unwitnessed claims get the honest denial shape instead
 * of silent injection (control-gate.ts; ch18 C2 acceptance gate).
 */
export function deliverGuidanceOverControlChannel(
  envelope: GuidanceEnvelope,
  node: AgentNodeView,
  witness?: ComplianceProbeResult | null,
  adapterKind?: AdapterKind,
): ControlCommand {
  if (envelope.agentNodeId !== node.agentNodeId) {
    throw new Error(`guidance envelope is bound to ${envelope.agentNodeId}, not ${node.agentNodeId} — cross-agent delivery is the replay ADR-0096 forbids`);
  }
  const command = makeControlCommand(
    node.agentNodeId,
    'steer',
    `daemon:guidance:${envelope.authority.mode}`,
    {
      sessionId: envelope.sessionId,
      payload: { channel: 'guidance-envelope', guidanceEnvelope: envelope },
    },
  );
  return applyControlGate(command, node, witness, adapterKind);
}
