/**
 * RUN-CONCLUDED RECONCILIATION — POST /v1/fleet/run-report
 * (grand-plan DAG node x7-mercy-hooks, slice 2; plan §X7).
 *
 * The squid stream is fire-and-forget by design (§N2): a dropped event
 * truncates the observable chain — the relay rejects everything after it
 * (SEQ_MISMATCH), INCLUDING the run-concluded event that could have carried a
 * claim. So the claim must travel OUT-OF-BAND from the chain being measured:
 * after a run concludes, the executor reports its per-run event total here,
 * signed under its N2 identity (the same operator-provisioned Ed25519 key and
 * hv:2 card that sign the events themselves — no bearer anything, ever).
 *
 * The relay compares `claimed` (what the executor says it sent on the run's
 * channel) against `received` (the events rows it actually holds) and records
 * the difference in `squid_run_reconciliation`. A nonzero gap becomes a
 * metric (`squid_reconciliation_gap` in the hook ledger, aggregated by the
 * `squid_reconciliation` MERCY hook) — honesty about loss WITHOUT breaking
 * fire-and-forget: nothing here retries, blocks, or changes a run.
 *
 * AUTH — the full N2 discipline, mirrored from handlePublish:
 *   - the hv:2 card must be issued by THIS relay during operator provisioning
 *     and carry `pub` capability on the exact local run channel;
 *   - the reporting daemon must be a registered, unrevoked
 *     `operator-provisioned` fleet-executor identity, and the
 *     report signature (Ed25519 over the canonical report hash) must verify
 *     against ITS key — a stolen card alone cannot forge a report;
 *   - the channel must be THIS relay's fleet-cloud channel whose suffix is the
 *     bounded reported runId (a report cannot cross relay/channel families).
 *
 * IDEMPOTENT: re-reporting a run replaces its row (INSERT OR REPLACE on
 * run_id) — a retried delivery is not a second data point.
 */

import { hashHex, pubKeyFromPrivKey, verifyEd25519, toHex, fromHex } from './crypto.js';
import { getIdentity, type IdentityRow } from './db.js';
import { verifyCard, extractCardSub, CardError } from './auth.js';
import { recordHookEvent } from './mercy-hooks.js';
import type { Env, RelayError } from './types.js';

/** A report older (or newer) than this is refused — stale replays are noise. */
export const RUN_REPORT_MAX_SKEW_SECONDS = 60 * 60;

/** Fleet executor delivery ids are bounded before the `run:` prefix is added. */
export const RUN_REPORT_ID_RE = /^run:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const EXECUTOR_DEPLOYMENT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/**
 * Reconciliation is an executor-only write surface. A generic registered
 * daemon must not be able to mint itself a card and overwrite an executor's
 * run totals, even if that daemon is otherwise allowed to publish.
 */
function isFleetExecutorIdentity(identity: IdentityRow): boolean {
  if (identity.proof_method !== 'operator-provisioned') return false;
  try {
    const metadata = JSON.parse(identity.proof_metadata) as {
      issuer?: unknown;
      deployment?: unknown;
    };
    return (
      typeof metadata.deployment === 'string' &&
      EXECUTOR_DEPLOYMENT_RE.test(metadata.deployment) &&
      metadata.issuer === `operator:fleet-executor@${metadata.deployment}`
    );
  } catch {
    return false;
  }
}

/** Wire shape of the executor's run report (see fleet-executor squid-events.ts). */
export interface RunReportRequest {
  card: string;
  report: {
    run_id: string;
    channel: string;
    /** Events the executor attempted on the channel (its final chain seq). */
    events_sent: number;
    iat: number;
  };
  /** Ed25519 hex sig over {@link runReportHash} by the executor's key. */
  sig: string;
}

/**
 * Canonical report hash — MUST stay byte-identical to the executor's
 * (apps/fleet-executor/src/squid-events.ts computeRunReportHash), or every
 * report is rejected with BAD_SIG. '|'-joined, same idiom as the event hash.
 */
export function runReportHash(fields: {
  sender: string;
  channel: string;
  runId: string;
  eventsSent: number;
  iat: number;
}): string {
  return hashHex(
    ['run-report', fields.sender, fields.channel, fields.runId, String(fields.eventsSent), String(fields.iat)].join('|'),
  );
}

function err(code: string, detail: string, status = 400): Response {
  const body: RelayError = { error: detail, code };
  return Response.json(body, { status });
}

/** POST /v1/fleet/run-report — reconcile one concluded run's event totals. */
export async function handleRunReport(request: Request, env: Env): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return err('BAD_JSON', 'Request body must be JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('MISSING_FIELDS', 'card, sig and report { run_id, channel, events_sent, iat } required');
  }
  const body = parsed as Partial<RunReportRequest>;
  const report = body.report;
  if (
    typeof body.card !== 'string' || body.card === '' ||
    typeof body.sig !== 'string' || !/^[0-9a-f]{128}$/i.test(body.sig) ||
    typeof report !== 'object' || report === null ||
    typeof report.run_id !== 'string' || report.run_id === '' ||
    typeof report.channel !== 'string' ||
    typeof report.events_sent !== 'number' || !Number.isSafeInteger(report.events_sent) || report.events_sent < 0 ||
    typeof report.iat !== 'number' || !Number.isSafeInteger(report.iat)
  ) {
    return err('MISSING_FIELDS', 'card, sig and report { run_id, channel, events_sent, iat } required');
  }

  if (!RUN_REPORT_ID_RE.test(report.run_id)) {
    return err('BAD_RUN_ID', 'run_id must be a bounded fleet executor delivery id prefixed with run:', 400);
  }

  const { sha256 } = await import('@noble/hashes/sha256');
  const relayPubKey = pubKeyFromPrivKey(env.RELAY_ED25519_PRIVATE_KEY_HEX);
  const relayFp = toHex(sha256(fromHex(relayPubKey)));

  // Channel discipline is exact: this relay, fleet-cloud, this bounded run.
  // Accepting an arbitrary 64-hex prefix would let a valid local card mutate
  // reconciliation state for another relay's namespace.
  const expectedChannel = `${relayFp}:fleet-cloud:${report.run_id}`;
  if (report.channel !== expectedChannel) {
    return err('BAD_CHANNEL', 'channel must be this relay\'s fleet-cloud channel for the reported run', 400);
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - report.iat) > RUN_REPORT_MAX_SKEW_SECONDS) {
    return err('REPORT_STALE', `report iat is more than ${RUN_REPORT_MAX_SKEW_SECONDS}s from now`, 400);
  }

  // Decode the card, resolve the reporter's identity (N2: registered + unrevoked).
  let sub: string;
  let cardIssuer: string;
  let cardKid: string | undefined;
  try {
    ({ sub, iss: cardIssuer } = extractCardSub(body.card));
    const headerPart = body.card.split('.')[0];
    if (headerPart) {
      const { base64UrlDecode } = await import('./crypto.js');
      const hdr = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerPart))) as { kid?: string };
      cardKid = hdr.kid;
    }
  } catch {
    return err('MALFORMED_CARD', 'Cannot decode card');
  }

  const identity = await getIdentity(env.DB, sub);
  if (!identity) return err('UNKNOWN_IDENTITY', 'Daemon not registered', 401);
  if (identity.revoked) return err('REVOKED', 'Daemon identity revoked', 401);
  if (!isFleetExecutorIdentity(identity)) {
    return err('EXECUTOR_IDENTITY_REQUIRED', 'Run reports require an operator-provisioned fleet executor identity', 403);
  }

  // Unlike ordinary publish, reconciliation accepts ONLY the card minted by
  // this relay during operator provisioning. A daemon-self-issued card is not
  // authority to replace the control plane's run totals.
  if (cardKid !== relayFp || cardIssuer !== relayFp) {
    return err('EXECUTOR_CARD_REQUIRED', 'Run reports require this relay\'s executor card', 401);
  }

  let verifiedCard;
  try {
    verifiedCard = await verifyCard(body.card, env.DB, relayPubKey, 'pub', report.channel);
  } catch (e) {
    if (e instanceof CardError) return err(e.code, e.message, 401);
    throw e;
  }
  if (verifiedCard.iss !== relayFp || verifiedCard.aud !== relayFp) {
    return err('EXECUTOR_CARD_REQUIRED', 'Run reports require this relay\'s executor card', 401);
  }

  // The report signature binds sender + channel + run + total + iat to the
  // reporter's OWN key — the card authorizes, the signature attests.
  const expectedHash = runReportHash({
    sender: sub,
    channel: report.channel,
    runId: report.run_id,
    eventsSent: report.events_sent,
    iat: report.iat,
  });
  const sigValid = await verifyEd25519(identity.pub_key, expectedHash, body.sig);
  if (!sigValid) return err('BAD_SIG', 'Run report signature invalid', 401);

  // The comparison: what the relay actually holds for this sender+channel.
  const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE channel = ? AND sender = ?')
    .bind(report.channel, sub)
    .first<{ n: number }>();
  const received = countRow?.n ?? 0;
  const gap = report.events_sent - received;

  await env.DB.prepare(
    `INSERT OR REPLACE INTO squid_run_reconciliation
       (run_id, channel, sender, claimed, received, gap, reported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(report.run_id, report.channel, sub, report.events_sent, received, gap, now)
    .run();

  // A nonzero gap is THE metric this route exists for. Best-effort ledger
  // append (recordHookEvent never throws); the sweep aggregates it.
  if (gap !== 0) {
    await recordHookEvent(
      env.DB,
      'squid_reconciliation_gap',
      'warn',
      `run ${report.run_id}: claimed ${report.events_sent}, received ${received} (gap ${gap})`,
      now,
    );
  }

  return Response.json({ code: 'OK', error: null, run_id: report.run_id, claimed: report.events_sent, received, gap });
}
