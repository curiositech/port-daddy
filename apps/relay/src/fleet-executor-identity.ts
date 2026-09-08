/**
 * Fleet-executor identity — operator provisioning + chain-head anomaly
 * detection (grand-plan DAG node n2-executor-identity; plan §N2).
 *
 * WHAT THIS GIVES THE EXECUTOR. Until this module, the cloud fleet executor
 * "held no harbor card and no Ed25519 identity" — its squid telemetry had no
 * name and no chain, and the only conceivable transport was a bearer-token
 * ingest that (per plan ground truth #3) must never be built. Provisioning
 * turns the executor into a NAMED, capability-scoped publisher:
 *
 *   POST /v1/fleet/executor-identity   (operator token; RELAY_OPERATOR_TOKEN)
 *     { pub_key, deployment, ttl_seconds? }
 *   →  { fingerprint, relay_fingerprint, card, jti, exp, cap, issuer }
 *
 * The call (1) upserts an `identities` row with
 * proof_method='operator-provisioned' and proof_metadata {issuer, jti, iat,
 * deployment} — the same issuer-scoped shape OIDC rows use, so
 * POST /v1/revoke-by-issuer (issuer `operator:fleet-executor@<deployment>`)
 * is the rotation lever — and (2) mints an hv:2 harbor card signed by the
 * RELAY key (header.kid = relay fingerprint) whose only capability is
 * `{op:'pub', channel:'<relayFp>:fleet-cloud:*', rate_per_min:120}`.
 *
 * BLAST RADIUS of a leaked executor key: forged fleet TELEMETRY on one
 * channel family (verdicts live in GitHub check runs, not here), bounded by
 * the card's rate limit and revocable via /v1/revoke-by-issuer. Detection is
 * chain-head anomaly — a second writer on a concluded run's channel — which
 * {@link detectChainHeadAnomalies} makes mechanical.
 */

import { sha256 } from '@noble/hashes/sha256';
import {
  pubKeyFromPrivKey,
  toHex,
  fromHex,
  hashHex,
  randomHex,
  signEd25519,
} from './crypto.js';
import { upsertIdentity, appendAudit } from './db.js';
import { operatorOnly } from './handlers.js';
import type { Env, CapabilityEntry, ChainHead, RelayError } from './types.js';

/** Publish rate granted to the executor card (plan N2: 120/min). */
export const EXECUTOR_RATE_PER_MIN = 120;

/** Card lifetime bounds: default 30 days, clamped to [1 hour, 90 days]. */
export const EXECUTOR_CARD_DEFAULT_TTL_SECONDS = 30 * 24 * 3600;
export const EXECUTOR_CARD_MAX_TTL_SECONDS = 90 * 24 * 3600;
export const EXECUTOR_CARD_MIN_TTL_SECONDS = 3600;

/** Request body for POST /v1/fleet/executor-identity. */
export interface ProvisionFleetExecutorRequest {
  /** The executor's Ed25519 PUBLIC key, 64 hex chars. */
  pub_key: string;
  /** Deployment label, e.g. 'staging' or 'prod' (slug, max 64 chars). */
  deployment: string;
  /** Optional card lifetime override (clamped). */
  ttl_seconds?: number;
}

function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

// Base64url a JSON value (ASCII-only inputs here), matching the encoding
// handleExchange uses when minting relay-issued cards.
function b64urlJson(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=/g, '');
}

/**
 * POST /v1/fleet/executor-identity — operator-gated provisioning.
 *
 * Registers (or re-registers) a fleet-executor Ed25519 identity and mints its
 * relay-signed hv:2 harbor card. Idempotent per pub_key: re-provisioning the
 * same key refreshes the identity row and issues a fresh card/jti. Rotation =
 * revoke the old issuer grant (POST /v1/revoke-by-issuer with issuer
 * `operator:fleet-executor@<deployment>` and the recorded iat window), then
 * provision a NEW keypair — the old card's jti is dead the moment the
 * revocation lands, and no new card can exist without this endpoint.
 *
 * @returns 200 {fingerprint, relay_fingerprint, card, jti, exp, cap, issuer};
 *          401 without a valid operator token; 400 on malformed input.
 */
export async function handleProvisionFleetExecutor(
  request: Request,
  env: Env
): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  let body: ProvisionFleetExecutorRequest;
  try {
    body = await request.json() as ProvisionFleetExecutorRequest;
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  const pubKey = (body.pub_key ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(pubKey)) {
    return err('BAD_PUB_KEY', 'pub_key must be 64 hex chars (Ed25519 public key)');
  }
  const deployment = body.deployment ?? '';
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(deployment)) {
    return err('BAD_DEPLOYMENT', 'deployment must be a slug (max 64 chars)');
  }

  const requested = typeof body.ttl_seconds === 'number' && Number.isFinite(body.ttl_seconds)
    ? Math.floor(body.ttl_seconds)
    : EXECUTOR_CARD_DEFAULT_TTL_SECONDS;
  const ttl = Math.min(
    Math.max(requested, EXECUTOR_CARD_MIN_TTL_SECONDS),
    EXECUTOR_CARD_MAX_TTL_SECONDS,
  );

  const fingerprint = toHex(sha256(fromHex(pubKey)));
  const relayPubKey = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const relayFp = toHex(sha256(fromHex(relayPubKey)));

  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttl;
  const jti = randomHex(16);
  const issuer = `operator:fleet-executor@${deployment}`;

  const cap: CapabilityEntry[] = [{
    op: 'pub',
    channel: `${relayFp}:fleet-cloud:*`,
    rate_per_min: EXECUTOR_RATE_PER_MIN,
    max_payload_bytes: 65536,
  }];

  // Identity row FIRST (the registry is the source of truth handlePublish
  // reads); the recorded {issuer, jti, iat} triple is what revoke-by-issuer
  // scans, so the card jti below MUST be this jti.
  await upsertIdentity(env.DB, {
    daemon_fingerprint: fingerprint,
    pub_key: pubKey,
    proof_method: 'operator-provisioned',
    proof_metadata: JSON.stringify({ issuer, jti, iat: now, deployment }),
    expires_at: exp,
  });

  const cardHeader = { alg: 'EdDSA', kid: relayFp };
  const cardPayload = {
    hv: 2,
    sub: fingerprint,
    iss: relayFp,
    aud: relayFp,
    exp,
    iat: now,
    jti,
    cap,
  };

  const headerB64 = b64urlJson(cardHeader);
  const payloadB64 = b64urlJson(cardPayload);
  const msgHex = hashHex(`${headerB64}.${payloadB64}`);
  const sigHex = await signEd25519(env.RELAY_ED25519_PRIVATE_KEY_HEX, msgHex);
  const sigBytes = fromHex(sigHex);
  let sigBin = '';
  for (const b of sigBytes) sigBin += String.fromCharCode(b);
  const sigB64url = btoa(sigBin).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=/g, '');
  const card = `${headerB64}.${payloadB64}.${sigB64url}`;

  await appendAudit(env.DB, {
    daemon_fingerprint: fingerprint,
    action: 'provision_fleet_executor',
    target: deployment,
    detail: `jti=${jti} exp=${exp}`,
  });

  return Response.json({
    fingerprint,
    relay_fingerprint: relayFp,
    card,
    jti,
    exp,
    cap,
    issuer,
  });
}

/** What {@link detectChainHeadAnomalies} found on a run channel. */
export interface ChainHeadAnomalyReport {
  /** Heads written by anyone OTHER than the expected sender. Any entry is an anomaly. */
  foreignWriters: ChainHead[];
  /** True when the expected sender's own chain advanced past the concluded tip. */
  advancedPastConclusion: boolean;
  /** Overall verdict: true when either anomaly class is present. */
  anomalous: boolean;
}

/**
 * Chain-head anomaly detection for single-writer channels (plan N2 failure
 * story: "detection via chain-head anomaly — a second writer on a concluded
 * run's channel").
 *
 * Chains are per (sender, channel), so a leaked-or-rotated second key can
 * open a PARALLEL chain on the same run channel without violating any chain
 * rule — the relay accepts it. What makes it an anomaly is POLICY: a per-run
 * fleet-cloud channel has exactly one legitimate writer, and after
 * run-concluded that writer's chain must not move. Pure function — feed it
 * listChainHeadsForChannel(db, channel) output.
 *
 * @param heads All chain heads on the channel (one per sender).
 * @param expectedSender The provisioned executor fingerprint for this run.
 * @param concludedTipSeq The expected sender's tip_seq at run-concluded, when
 *        known; omit while the run is still live.
 */
export function detectChainHeadAnomalies(
  heads: ChainHead[],
  expectedSender: string,
  concludedTipSeq?: number,
): ChainHeadAnomalyReport {
  const foreignWriters = heads.filter((h) => h.sender !== expectedSender);
  const own = heads.find((h) => h.sender === expectedSender);
  const advancedPastConclusion =
    typeof concludedTipSeq === 'number' && own !== undefined && own.tip_seq > concludedTipSeq;
  return {
    foreignWriters,
    advancedPastConclusion,
    anomalous: foreignWriters.length > 0 || advancedPastConclusion,
  };
}
