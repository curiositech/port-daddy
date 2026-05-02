/**
 * lib/coordination-gates.ts — sec-eng-lead-only gate operations.
 *
 * Three gates per round, plus key derivation at Gate A (in coordination-crypto).
 *
 *   Gate A (open):    derive fleet keys, salt → audit chain.
 *   Gate B (seal):    decrypt the red attack ciphertext stream, re-encrypt
 *                     under the defense fleet key as a single sealed bundle,
 *                     emit to defense + sign + post audit event.
 *   Gate C (publish): decrypt both streams, assemble a publishable dialogue
 *                     artifact, re-encrypt under the audit-public key,
 *                     sign + post audit event.
 *
 * INVARIANT: only the lead's process holds both fleet keys. The lead must
 * call `assertLeadAuthority` before any gate; if the call site does not
 * hold the lead root, the gate refuses.
 */

import { hkdfSync, sign as edSign, createHash } from 'node:crypto';
import {
  encryptEnvelope, decryptEnvelope,
  loadLeadRoot, deriveAndStashFleetKey,
  keyIdFor,
  type EnvelopePayload, type RoundContext,
} from './coordination-crypto.js';
import { keychain, KEYCHAIN_SERVICE } from './keychain.js';

const KEYCHAIN_ACCOUNT_LEAD_SIG = 'secops-lead-sig';
// Match the convention in coordination-crypto.ts (fleet-key-<fleet>-<round>)
// so loadFleetKey('audit-public', round) finds it.
const KEYCHAIN_ACCOUNT_AUDIT_PUB_PREFIX = 'fleet-key-audit-public';

export interface LeadAuthority {
  /** Ed25519 lead root, 64 bytes. Used to derive fleet keys at Gate A. */
  root: Buffer;
  /** Ed25519 lead signing key, used to sign sealed bundles + audit events. */
  signingKey: Buffer;
}

/**
 * Returns the lead authority object iff this process can read both the
 * lead root and the lead signing key from the keychain. Throws on
 * partial state — having one without the other is a configuration bug
 * that must surface, not a silent fallback.
 */
export function assertLeadAuthority(): LeadAuthority {
  const root = loadLeadRoot();
  const sigHex = keychain.loadSecret(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT_LEAD_SIG);
  if (!root && !sigHex) {
    throw new Error('[gates] not authorized as sec-eng-lead (no root, no signing key in keychain)');
  }
  if (!root) {
    throw new Error('[gates] partial lead state: signing key present but root missing');
  }
  if (!sigHex) {
    throw new Error('[gates] partial lead state: root present but signing key missing');
  }
  const signingKey = Buffer.from(sigHex, 'hex');
  if (signingKey.length === 0) {
    throw new Error('[gates] lead signing key empty');
  }
  return { root, signingKey };
}

// ─── Audit chain emit (signed events) ──────────────────────────────────────

export interface AuditEvent {
  gate: 'A' | 'B' | 'C';
  round: string;
  ts: string;
  payload_hash: string;
  signed_by: 'secops:lead';
  sig: string;
}

export function makeAuditEvent(
  authority: LeadAuthority,
  gate: 'A' | 'B' | 'C',
  round: string,
  payloadHash: string,
): AuditEvent {
  const ts = new Date().toISOString();
  const body = `${gate}|${round}|${ts}|${payloadHash}`;
  const sig = edSign(null, Buffer.from(body, 'utf8'), {
    key: authority.signingKey, format: 'der', type: 'pkcs8',
  } as never);
  return {
    gate, round, ts,
    payload_hash: payloadHash,
    signed_by: 'secops:lead',
    sig: sig.toString('base64'),
  };
}

// ─── Gate A — open round, derive fleet keys ────────────────────────────────

export interface GateAResult {
  audit: AuditEvent;
  /** Each fleet's stashed key id. */
  redKeyId: string;
  defKeyId: string;
}

export function openRound(round: RoundContext): GateAResult {
  const authority = assertLeadAuthority();
  deriveAndStashFleetKey(authority.root, 'redteam-review', round);
  deriveAndStashFleetKey(authority.root, 'whitehat-defense', round);
  const audPub = Buffer.from(hkdfSync(
    'sha256',
    authority.root,
    Buffer.from(round.salt, 'base64'),
    Buffer.from(`audit/${round.round}`, 'utf8'),
    32,
  ));
  const ok = keychain.saveSecret(
    KEYCHAIN_SERVICE,
    `${KEYCHAIN_ACCOUNT_AUDIT_PUB_PREFIX}-${round.round}`,
    audPub.toString('hex'),
  );
  if (!ok) throw new Error('[gates] could not stash audit-public key');

  const payloadHash = `salt:${round.salt}|round:${round.round}`;
  const audit = makeAuditEvent(authority, 'A', round.round, payloadHash);
  return {
    audit,
    redKeyId: keyIdFor('redteam-review', round),
    defKeyId: keyIdFor('whitehat-defense', round),
  };
}

// ─── Gate B — seal red attack manifest, deliver to defense ─────────────────

export interface SealedManifest {
  /** Defense-fleet-encrypted bundle of all red Phase-1 envelopes. */
  envelope: EnvelopePayload;
  /** Hash of the cleartext bundle (for audit chain). */
  manifest_hash: string;
}

export interface GateBResult {
  audit: AuditEvent;
  manifest: SealedManifest;
}

/**
 * The Gate B operation. Inputs: the round, the array of red ciphertext
 * envelopes captured from the redteam-review project, and a verify-key map
 * for the red personas (so the lead can confirm authorship of every
 * envelope before resealing). Output: a single defense-encrypted bundle
 * containing the cleartext red-side payloads, plus the audit event.
 *
 * The cleartext NEVER touches disk — it lives only in this function's
 * stack frame between decrypt and re-encrypt.
 */
export function sealAttackManifest(
  round: RoundContext,
  redEnvelopes: EnvelopePayload[],
  redVerifyKeys: Record<string, Buffer>,
): GateBResult {
  const authority = assertLeadAuthority();

  const decrypted: Array<{ from: string; payload: unknown }> = [];
  for (const env of redEnvelopes) {
    const out = decryptEnvelope<unknown>(env, {
      fleet: 'redteam-review',
      round,
      project: 'redteam-review',
      knownVerifyKeys: redVerifyKeys,
    });
    if (out === null) {
      throw new Error(
        `[gates B] could not decrypt or verify a red envelope from ${env.signed_by}; ` +
        `refusing to seal an unverified manifest`,
      );
    }
    decrypted.push({ from: env.signed_by, payload: out });
  }

  const bundle = {
    round: round.round,
    sealed_at: new Date().toISOString(),
    items: decrypted,
  };
  const bundleJson = JSON.stringify(bundle);
  const manifest_hash = createHash('sha256').update(bundleJson).digest('hex');

  const envelope = encryptEnvelope(bundle, {
    fleet: 'whitehat-defense',
    round,
    project: 'whitehat-defense',
    signedBy: 'secops:lead',
    signingKey: authority.signingKey,
  });

  const audit = makeAuditEvent(authority, 'B', round.round, `manifest:${manifest_hash}`);
  return { audit, manifest: { envelope, manifest_hash } };
}

// ─── Gate C — publish dialogue artifact ────────────────────────────────────

export interface DialogueArtifact {
  round_from: string;
  round_to: string;
  sealed_at: string;
  /** Pairs of (smell, fix). Each fix references the smell id it counters. */
  exchanges: Array<{
    smell: { from: string; payload: unknown };
    fix: { from: string; payload: unknown };
  }>;
  /** Smells with no fix this round — carried over with explicit reasons. */
  carried: Array<{ from: string; payload: unknown; reason: string }>;
}

export interface GateCResult {
  audit: AuditEvent;
  /** Plaintext dialogue artifact, suitable for direct publication to git/website. */
  dialogue: DialogueArtifact;
  /** Audit-public-keyed envelope of the same artifact for archival. */
  archived: EnvelopePayload;
}

export function publishDialogue(
  round: RoundContext,
  manifest: SealedManifest,
  manifestVerifyKeys: Record<string, Buffer>,
  defenseEnvelopes: EnvelopePayload[],
  defenseVerifyKeys: Record<string, Buffer>,
  carriedOverReasons: Record<string, string> = {},
): GateCResult {
  const authority = assertLeadAuthority();

  const sealedBundle = decryptEnvelope<{
    round: string;
    sealed_at: string;
    items: Array<{ from: string; payload: { id?: string; [k: string]: unknown } }>;
  }>(manifest.envelope, {
    fleet: 'whitehat-defense',
    round,
    project: 'whitehat-defense',
    knownVerifyKeys: manifestVerifyKeys,
  });
  if (sealedBundle === null) {
    throw new Error('[gates C] could not decrypt sealed manifest from Gate B');
  }

  const decryptedDefenses: Array<{ from: string; payload: { counters?: string; [k: string]: unknown } }> = [];
  for (const env of defenseEnvelopes) {
    const out = decryptEnvelope<{ counters?: string; [k: string]: unknown }>(env, {
      fleet: 'whitehat-defense',
      round,
      project: 'whitehat-defense',
      knownVerifyKeys: defenseVerifyKeys,
    });
    if (out === null) {
      throw new Error(`[gates C] could not decrypt defense envelope from ${env.signed_by}`);
    }
    decryptedDefenses.push({ from: env.signed_by, payload: out });
  }

  const exchanges: DialogueArtifact['exchanges'] = [];
  const carried: DialogueArtifact['carried'] = [];

  for (const item of sealedBundle.items) {
    const smellId = (item.payload as { id?: string }).id;
    if (!smellId) {
      carried.push({ from: item.from, payload: item.payload, reason: 'no smell id; cannot pair' });
      continue;
    }
    const match = decryptedDefenses.find((d) => d.payload.counters === smellId);
    if (!match) {
      const reason = carriedOverReasons[smellId] ?? 'no defense response this round';
      carried.push({ from: item.from, payload: item.payload, reason });
      continue;
    }
    exchanges.push({
      smell: { from: item.from, payload: item.payload },
      fix:   { from: match.from, payload: match.payload },
    });
  }

  const dialogue: DialogueArtifact = {
    round_from: round.round,
    round_to: bumpRoundString(round.round),
    sealed_at: new Date().toISOString(),
    exchanges,
    carried,
  };

  const archived = encryptEnvelope(dialogue, {
    fleet: 'audit-public',
    round,
    project: 'whitehat-defense',
    signedBy: 'secops:lead',
    signingKey: authority.signingKey,
  });

  const dialogueJson = JSON.stringify(dialogue);
  const dialogueHash = createHash('sha256').update(dialogueJson).digest('hex');
  const audit = makeAuditEvent(authority, 'C', round.round, `dialogue:${dialogueHash}`);

  return { audit, dialogue, archived };
}

/** "v2.1" → "v2.2". Lead may override by writing the next label in Gate A. */
function bumpRoundString(s: string): string {
  const m = /^v(\d+)\.(\d+)$/.exec(s);
  if (!m) return `${s}.next`;
  return `v${m[1]}.${parseInt(m[2], 10) + 1}`;
}
