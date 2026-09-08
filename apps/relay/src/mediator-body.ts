/**
 * MEDIATOR BODY — the executor-driven half of the pd-mediator
 * (grand-plan DAG node mediator-body; plan §X4 second half; first slice was
 * the neutral observer in src/mediator.ts — this module builds on it and
 * deliberately reuses its structural guarantees rather than replacing them).
 *
 * Four coupled slices land here (relay side):
 *
 *  1. CONFLICT-PREDICTION INTAKE — POST /v1/mediator/convene. The executor
 *     (under its N2 harbor card) reports a predicted symbol collision between
 *     two open PRs as a SIGNED, CHAINED relay event; the relay verifies it
 *     through the one publish implementation (handlePublish — identity,
 *     revocation, capability, hash chain, signature), then materializes a
 *     mediator-convened parley between the two PR AUTHORS, enforcing the
 *     ≥0.7 confidence floor server-side and ONE OPEN PARLEY PER PR PAIR.
 *  2. SUMMONS WITH DELIVERY ACKNOWLEDGMENT — the convene event IS the
 *     summons, and it rides the hash chain (never fire-and-forget squid).
 *     Each named party gets a parley_summonses row pinned to the summons
 *     event's (channel, seq, hash). Agent-first (doctrine D11): a party with
 *     a declared daemon is 'summoned' and the daemon answers FIRST via
 *     POST /v1/mediator/summons/respond — itself a signed, chained event —
 *     and only a `refuse`/`escalate` wakes the human. A party with NO
 *     declared daemon escalates immediately: there is no agent to try first,
 *     and pretending otherwise would just delay the human silently.
 *  3. HUMAN APPROVE GATE — created at convene when the predicted conflict
 *     names an IRREVERSIBLE action (merge/revert/force-push) and only then;
 *     everything else stays agent-resolvable. The verdict state machine
 *     lives here ({@link renderGateVerdict}); the buttons render on the
 *     parleys HTML surface (src/parleys-page.ts). 'Modify' free text is
 *     re-injected into the losing agent's re-execution via the shared
 *     control-plane KV (mediator:reinjection:<repo>:<pr>) — the one
 *     namespace both workers already share for fleet:paused.
 *  4. EXPIRY DEFAULTS live in src/parleys.ts (applyParleyExpiries) — the
 *     lapse path is the parley state machine's own, so the Helm-default
 *     outcome is applied where every other lapse decision is made.
 *
 * KILL FLAG (`kill-mediator`, N6 machinery): the fleet:kill-mediator KV flag
 * makes every route in this module refuse before ANY read or write, and the
 * executor's scan checks the same key before any network call — the mediator
 * is fully inert when flagged, on both workers, from one switch.
 *
 * TRUST BOUNDARIES:
 *  - Convene/respond are MACHINE routes: no session, no pdu_ bearer — only a
 *    signed chained envelope under a registered identity's card, verified by
 *    delegating to handlePublish (never a second verification path that
 *    could drift). The bearer-publish route still does not exist.
 *  - Verdicts enter ONLY via a named human party's authenticated session on
 *    the parleys page. There is no JSON verdict route and no daemon path to
 *    a verdict — an agent cannot approve its own irreversible action.
 *  - The relay refuses to convene when either PR author cannot be resolved
 *    to a harbor-member relay account (fail closed, honest reason). The
 *    check run on GitHub still tells the authors about the prediction; what
 *    cannot exist is a parley whose named parties could never sign it.
 *  - Fleet paused ⇒ verdict buttons gray out AND the verdict route refuses:
 *    no surface renders (or accepts) a verdict the relay can't enforce.
 */

import type { Env } from './types.js';
import { randomHex } from './crypto.js';
import { handlePublish, operatorOnly } from './handlers.js';
import { MAX_OBSERVATION_CHARS } from './mediator.js';
import {
  DEFAULT_PARLEY_DEADLINE_HOURS,
  MAX_PARLEY_DEADLINE_HOURS,
  MIN_PARLEY_DEADLINE_HOURS,
  MEDIATOR_ID,
  MEDIATOR_TIER,
} from './parleys.js';
import {
  createParley,
  findOpenParleyForPair,
  getFleetPaused,
  getHarborByName,
  getHarborRole,
  getIdentity,
  getMediatorKilled,
  getParleySummons,
  getUserByLogin,
  insertMediatorPair,
  insertParleyGate,
  insertParleySummons,
  putMediatorReinjection,
  recordMediatorObservation,
  resolveParleyGateState,
  resolveParleySummons,
  setMediatorKilled,
  IRREVERSIBLE_ACTIONS,
  type ParleyGateAction,
  type ParleyGateRow,
  type ParleyPartySeed,
  type ParleyRow,
  type ParleySummonsRow,
  type UserRow,
} from './db.js';

// ── Policy constants ─────────────────────────────────────────────────────────

/**
 * The auto-convene confidence floor (plan §X4: "convenes parleys at ≥0.7
 * confidence"). Enforced HERE, server-side, not only in the executor: a
 * buggy or compromised executor must not be able to spam parleys with
 * low-confidence predictions — the floor is the relay's rule, the executor
 * merely respects it early to save a round trip.
 */
export const MEDIATOR_CONFIDENCE_FLOOR = 0.7;

/** Schema tag inside every mediator chain event's ciphertext. */
export const MEDIATOR_SCHEMA = 'mediator/1';

/** Cap on the symbols list a convene may carry (evidence, not a dump). */
const MAX_CONVENE_SYMBOLS = 50;

/** Bounds on the Modify free text (same cap as a signed position). */
export const MAX_MODIFY_TEXT_CHARS = 2000;

// ── Wire shapes (the mediator/1 dialect) ─────────────────────────────────────

/** One overlapping symbol: the evidence unit of a prediction. */
export interface ConflictSymbol {
  file: string;
  symbol: string;
}

/** One side of a predicted-conflict PR pair. */
export interface ConvenePr {
  number: number;
  /** GitHub login of the PR author — resolved to a relay account at convene. */
  author: string;
  /** PR creation time (unix seconds) — decides CLAIM order (earlier = first). */
  createdAt: number;
}

/** The ciphertext body of a convene event (executor → relay). */
export interface MediatorConveneBody {
  schema: typeof MEDIATOR_SCHEMA;
  type: 'convene';
  /** 'namespace/name' of the harbor the parley is convened in. */
  harbor: string;
  /** 'owner/repo' of the conflicting PR pair. */
  repo: string;
  prA: ConvenePr;
  prB: ConvenePr;
  symbols: ConflictSymbol[];
  confidence: number;
  /** Present ONLY when the predicted conflict is over an irreversible action. */
  action?: ParleyGateAction;
  deadlineHours?: number;
  /** login → daemon fingerprint: which daemon speaks for which author (D11). */
  daemons?: Record<string, string>;
}

/** The ciphertext body of a summons response (counterparty daemon → relay). */
export interface MediatorSummonsResponseBody {
  schema: typeof MEDIATOR_SCHEMA;
  type: 'summons-response';
  summonsId: string;
  response: 'ack' | 'refuse' | 'escalate';
  note?: string;
}

/** The chained-envelope request shape shared with handlePublish. */
interface ChainedRequest {
  card?: string;
  event?: {
    sender?: string;
    channel?: string;
    seq?: number;
    this_hash?: string;
    ciphertext?: string;
  };
}

// ── Small helpers ────────────────────────────────────────────────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const err = (status: number, code: string, error: string) => json(status, { code, error });

function base64UrlDecodeToString(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = 4 - (padded.length % 4 || 4);
    const bin = atob(padded + '='.repeat(pad === 4 ? 0 : pad));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Delegate a chained envelope to the ONE publish implementation.
 *
 * Why delegation instead of re-verifying here: handlePublish is the security
 * keystone — identity lookup, revocation, harbor binding, capability match,
 * rate limit, hash formula, signature, chain CAS. A second verification path
 * in this module would inevitably drift from it, and the drift would live on
 * a route that mints PARLEYS. So the mediator routes verify by construction:
 * the event is not trusted until the real publish gate has persisted it.
 */
async function delegateToPublish(env: Env, rawBody: string): Promise<Response> {
  const req = new Request('http://relay.internal/v1/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: rawBody,
  });
  return handlePublish(req, env);
}

// ── Kill flag (POST /v1/fleet/mediator — operator-gated toggle) ──────────────

/**
 * Operator toggle for the `kill-mediator` flag, the same shape as the fleet
 * pause toggle: POST { killed: boolean }, operator token required. When
 * killed, every mediator route refuses (409 MEDIATOR_KILLED) and the
 * executor's scan is inert — verified by the kill-flag gate tests.
 */
export async function handleMediatorToggle(request: Request, env: Env): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;
  let body: { killed?: unknown };
  try {
    body = (await request.json()) as { killed?: unknown };
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { killed: boolean }');
  }
  if (typeof body.killed !== 'boolean') {
    return err(400, 'BAD_REQUEST', 'killed must be a boolean');
  }
  const state = await setMediatorKilled(env.KV, body.killed);
  return json(200, { code: 'OK', error: null, ...state });
}

// ── Convene validation ───────────────────────────────────────────────────────

function parseConvenePr(v: unknown): ConvenePr | string {
  if (typeof v !== 'object' || v === null) return 'each PR must be an object { number, author, createdAt }';
  const p = v as { number?: unknown; author?: unknown; createdAt?: unknown };
  if (typeof p.number !== 'number' || !Number.isInteger(p.number) || p.number <= 0) return 'PR number must be a positive integer';
  if (typeof p.author !== 'string' || p.author.trim() === '') return 'PR author (GitHub login) required';
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt) || p.createdAt <= 0) return 'PR createdAt (unix seconds) required';
  return { number: p.number, author: p.author.trim(), createdAt: Math.floor(p.createdAt) };
}

/** Validate a decoded convene body. Returns the typed body or a string error. */
export function validateConveneBody(v: unknown): MediatorConveneBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a mediator/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== MEDIATOR_SCHEMA) return `schema must be '${MEDIATOR_SCHEMA}'`;
  if (b.type !== 'convene') return "type must be 'convene'";
  if (typeof b.harbor !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(b.harbor)) return "harbor must be 'namespace/name'";
  if (typeof b.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(b.repo)) return "repo must be 'owner/name'";
  const prA = parseConvenePr(b.prA);
  if (typeof prA === 'string') return `prA: ${prA}`;
  const prB = parseConvenePr(b.prB);
  if (typeof prB === 'string') return `prB: ${prB}`;
  if (prA.number === prB.number) return 'prA and prB must be different PRs';
  if (!Array.isArray(b.symbols) || b.symbols.length === 0) return 'symbols must be a non-empty array of { file, symbol }';
  if (b.symbols.length > MAX_CONVENE_SYMBOLS) return `symbols is capped at ${MAX_CONVENE_SYMBOLS} entries`;
  const symbols: ConflictSymbol[] = [];
  for (const s of b.symbols) {
    const e = s as { file?: unknown; symbol?: unknown };
    if (typeof e?.file !== 'string' || e.file === '' || typeof e?.symbol !== 'string' || e.symbol === '') {
      return 'each symbol must be { file, symbol } with non-empty strings';
    }
    symbols.push({ file: e.file, symbol: e.symbol });
  }
  if (typeof b.confidence !== 'number' || !Number.isFinite(b.confidence) || b.confidence < 0 || b.confidence > 1) {
    return 'confidence must be a number in [0, 1]';
  }
  let action: ParleyGateAction | undefined;
  if (b.action !== undefined) {
    if (typeof b.action !== 'string' || !(IRREVERSIBLE_ACTIONS as readonly string[]).includes(b.action)) {
      return `action must be one of: ${IRREVERSIBLE_ACTIONS.join(', ')} (the gate exists for irreversible actions ONLY)`;
    }
    action = b.action as ParleyGateAction;
  }
  let deadlineHours: number | undefined;
  if (b.deadlineHours !== undefined) {
    if (
      typeof b.deadlineHours !== 'number' ||
      !Number.isFinite(b.deadlineHours) ||
      b.deadlineHours < MIN_PARLEY_DEADLINE_HOURS ||
      b.deadlineHours > MAX_PARLEY_DEADLINE_HOURS
    ) {
      return `deadlineHours must be between ${MIN_PARLEY_DEADLINE_HOURS} and ${MAX_PARLEY_DEADLINE_HOURS}`;
    }
    deadlineHours = b.deadlineHours;
  }
  let daemons: Record<string, string> | undefined;
  if (b.daemons !== undefined) {
    if (typeof b.daemons !== 'object' || b.daemons === null || Array.isArray(b.daemons)) {
      return 'daemons must be an object mapping author login to daemon fingerprint';
    }
    daemons = {};
    for (const [login, fp] of Object.entries(b.daemons as Record<string, unknown>)) {
      if (typeof fp !== 'string' || !/^[0-9a-f]{64}$/i.test(fp)) return `daemons['${login}'] must be a 64-hex fingerprint`;
      daemons[login.toLowerCase()] = fp.toLowerCase();
    }
  }
  const body: MediatorConveneBody = {
    schema: MEDIATOR_SCHEMA,
    type: 'convene',
    harbor: b.harbor,
    repo: b.repo,
    prA,
    prB,
    symbols,
    confidence: b.confidence,
  };
  if (action !== undefined) body.action = action;
  if (deadlineHours !== undefined) body.deadlineHours = deadlineHours;
  if (daemons !== undefined) body.daemons = daemons;
  return body;
}

// ── POST /v1/mediator/convene ────────────────────────────────────────────────

interface ResolvedAuthor {
  user: UserRow;
  pr: ConvenePr;
  daemonFp: string | null;
}

/**
 * Resolve one PR author to a harbor-member relay account, plus the daemon
 * declared to speak for them (validated: registered, unrevoked, harbor
 * member — anything less counts as NO daemon, which escalates to the human
 * rather than summoning an agent the relay cannot trust to answer).
 */
async function resolveAuthor(
  env: Env,
  harborId: string,
  pr: ConvenePr,
  daemons: Record<string, string> | undefined,
): Promise<ResolvedAuthor | string> {
  const user = await getUserByLogin(env.DB, pr.author);
  if (!user) return `PR #${pr.number} author '${pr.author}' has no relay account`;
  const role = await getHarborRole(env.DB, harborId, 'user', user.id);
  if (!role) return `PR #${pr.number} author '${pr.author}' is not a member of this harbor`;
  let daemonFp: string | null = null;
  const declared = daemons?.[pr.author.toLowerCase()];
  if (declared) {
    const identity = await getIdentity(env.DB, declared);
    const daemonRole = identity && !identity.revoked ? await getHarborRole(env.DB, harborId, 'daemon', declared) : null;
    if (identity && !identity.revoked && daemonRole) daemonFp = declared;
    // An unregistered/revoked/non-member daemon is treated as absent — the
    // summons escalates to the human instead of waiting on a ghost.
  }
  return { user, pr, daemonFp };
}

/**
 * POST /v1/mediator/convene — the conflict-prediction intake.
 *
 * Order of gates is load-bearing:
 *   kill flag → body shape → confidence floor → one-open-per-pair →
 *   harbor + author resolution → publish (chain) → materialize.
 * Everything cheap and refusable happens BEFORE the event enters the chain,
 * so a refused convene leaves no orphan chain event; and the parley is only
 * materialized AFTER the publish gate accepted the event, so every parley's
 * summons coordinates point at a real, verified, persisted chain event.
 */
export async function handleMediatorConvene(request: Request, env: Env): Promise<Response> {
  if (await getMediatorKilled(env.KV)) {
    return err(409, 'MEDIATOR_KILLED', 'the kill-mediator flag is set — the mediator is inert');
  }

  let rawBody: string;
  let parsed: ChainedRequest;
  try {
    rawBody = await request.text();
    parsed = JSON.parse(rawBody) as ChainedRequest;
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { card, event }');
  }
  const ciphertext = parsed.event?.ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext === '') {
    return err(400, 'MISSING_EVENT', 'event with ciphertext required');
  }
  const decoded = base64UrlDecodeToString(ciphertext);
  let bodyUnknown: unknown;
  try {
    bodyUnknown = decoded === null ? null : JSON.parse(decoded);
  } catch {
    bodyUnknown = null;
  }
  const convene = validateConveneBody(bodyUnknown);
  if (typeof convene === 'string') return err(400, 'BAD_CONVENE', convene);

  // The floor is the relay's rule (fail closed on executor bugs).
  if (convene.confidence < MEDIATOR_CONFIDENCE_FLOOR) {
    return err(422, 'BELOW_FLOOR', `confidence ${convene.confidence} is below the ${MEDIATOR_CONFIDENCE_FLOOR} auto-convene floor`);
  }

  const prLo = Math.min(convene.prA.number, convene.prB.number);
  const prHi = Math.max(convene.prA.number, convene.prB.number);
  const existing = await findOpenParleyForPair(env.DB, convene.repo, prLo, prHi);
  if (existing) {
    // ONE open parley per PR pair: idempotent, and no duplicate summons spam.
    return json(200, { code: 'OK', error: null, existing: true, parleyId: existing });
  }

  const [ns, name] = convene.harbor.split('/');
  const harbor = await getHarborByName(env.DB, (ns ?? '').toLowerCase(), (name ?? '').toLowerCase());
  if (!harbor) return err(404, 'NO_SUCH_HARBOR', `no harbor '${convene.harbor}'`);

  // Claim order: the EARLIER-created PR is the first claimant.
  const [first, second] =
    convene.prA.createdAt <= convene.prB.createdAt ? [convene.prA, convene.prB] : [convene.prB, convene.prA];
  const firstAuthor = await resolveAuthor(env, harbor.id, first, convene.daemons);
  if (typeof firstAuthor === 'string') return err(422, 'CANNOT_CONVENE', firstAuthor);
  const secondAuthor = await resolveAuthor(env, harbor.id, second, convene.daemons);
  if (typeof secondAuthor === 'string') return err(422, 'CANNOT_CONVENE', secondAuthor);
  if (firstAuthor.user.id === secondAuthor.user.id) {
    return err(422, 'CANNOT_CONVENE', 'both PRs have the same author — nothing to mediate between');
  }

  // The summons enters the hash chain through the ONE publish gate.
  const published = await delegateToPublish(env, rawBody);
  if (published.status !== 200) return published;
  const pub = (await published.json()) as { seq: number; this_hash: string };
  const event = parsed.event as { channel: string };

  const now = Math.floor(Date.now() / 1000);
  const deadlineHours = convene.deadlineHours ?? DEFAULT_PARLEY_DEADLINE_HOURS;
  const parleyId = `p_${randomHex(16)}`;
  const nOverlap = convene.symbols.length;
  const subject =
    `[pd-mediator] Predicted conflict: PR #${first.number} ↔ PR #${second.number} — ` +
    `${nOverlap} overlapping symbol${nOverlap === 1 ? '' : 's'}` +
    (convene.action ? ` before ${convene.action}` : '');

  const parties: ParleyPartySeed[] = [
    { kind: 'user', id: firstAuthor.user.id, label: firstAuthor.user.login, tier: 'human', isParty: true, claimRank: 1 },
    { kind: 'user', id: secondAuthor.user.id, label: secondAuthor.user.login, tier: 'human', isParty: true, claimRank: 2 },
    { kind: 'mediator', id: MEDIATOR_ID, label: MEDIATOR_ID, tier: MEDIATOR_TIER, isParty: false },
  ];
  await createParley(env.DB, {
    id: parleyId,
    harborId: harbor.id,
    subject: subject.slice(0, 500),
    proposerId: firstAuthor.user.id,
    proposerLabel: firstAuthor.user.login,
    deadlineAt: now + Math.round(deadlineHours * 3600),
    createdAt: now,
    parties,
    convenedBy: 'mediator',
  });
  await insertMediatorPair(env.DB, {
    repo: convene.repo,
    pr_lo: prLo,
    pr_hi: prHi,
    first_pr: first.number,
    parley_id: parleyId,
    confidence: convene.confidence,
    symbols_json: JSON.stringify(convene.symbols),
    created_at: now,
  });

  // The mediator seat carries the DETERMINISTIC prediction facts — no model
  // call, and written through the same is_party=0-pinned UPDATE the observer
  // slice uses, so this note is structurally incapable of being a signature.
  const evidence = convene.symbols
    .slice(0, 5)
    .map((s) => `${s.file}:${s.symbol}`)
    .join(', ');
  const note =
    `Predicted symbol collision in ${convene.repo} between PR #${first.number} (${firstAuthor.user.login}) ` +
    `and PR #${second.number} (${secondAuthor.user.login}) at confidence ${convene.confidence.toFixed(2)}: ` +
    `${evidence}${convene.symbols.length > 5 ? ` and ${convene.symbols.length - 5} more` : ''}. ` +
    `Convened automatically; first claimant is PR #${first.number}.`;
  await recordMediatorObservation(env.DB, { parleyId, note: note.slice(0, MAX_OBSERVATION_CHARS) });

  const summonses: ParleySummonsRow[] = [];
  for (const author of [firstAuthor, secondAuthor]) {
    const hasDaemon = author.daemonFp !== null;
    const row: ParleySummonsRow = {
      id: `sm_${randomHex(12)}`,
      parley_id: parleyId,
      party_kind: 'user',
      party_id: author.user.id,
      party_label: author.user.login,
      daemon_fingerprint: author.daemonFp,
      summons_channel: event.channel,
      summons_seq: pub.seq,
      summons_hash: pub.this_hash,
      issued_at: now,
      // D11 agent-first: with a daemon the summons awaits the DAEMON's
      // chained answer; without one it escalates to the human immediately.
      state: hasDaemon ? 'summoned' : 'escalated',
      response_channel: null,
      response_seq: null,
      response_hash: null,
      responded_at: null,
      escalated_at: hasDaemon ? null : now,
    };
    await insertParleySummons(env.DB, row);
    summonses.push(row);
  }

  let gate: ParleyGateRow | null = null;
  if (convene.action) {
    await insertParleyGate(env.DB, { parleyId, action: convene.action, createdAt: now });
    gate = {
      parley_id: parleyId,
      action: convene.action,
      state: 'pending',
      verdict_by: null,
      verdict_by_label: null,
      verdict_at: null,
      modify_text: null,
      created_at: now,
    };
  }

  return json(201, {
    code: 'OK',
    error: null,
    parleyId,
    summons: {
      channel: event.channel,
      seq: pub.seq,
      hash: pub.this_hash,
    },
    summonses: summonses.map((s) => ({
      id: s.id,
      party: s.party_label,
      daemon: s.daemon_fingerprint,
      state: s.state,
    })),
    gate: gate ? { action: gate.action, state: gate.state } : null,
  });
}

// ── POST /v1/mediator/summons/respond ────────────────────────────────────────

/** Validate a decoded summons-response body. */
export function validateSummonsResponseBody(v: unknown): MediatorSummonsResponseBody | string {
  if (typeof v !== 'object' || v === null) return 'ciphertext must decode to a mediator/1 JSON body';
  const b = v as Record<string, unknown>;
  if (b.schema !== MEDIATOR_SCHEMA) return `schema must be '${MEDIATOR_SCHEMA}'`;
  if (b.type !== 'summons-response') return "type must be 'summons-response'";
  if (typeof b.summonsId !== 'string' || b.summonsId === '') return 'summonsId required';
  if (b.response !== 'ack' && b.response !== 'refuse' && b.response !== 'escalate') {
    return "response must be 'ack', 'refuse', or 'escalate'";
  }
  const body: MediatorSummonsResponseBody = {
    schema: MEDIATOR_SCHEMA,
    type: 'summons-response',
    summonsId: b.summonsId,
    response: b.response,
  };
  if (typeof b.note === 'string' && b.note.trim() !== '') body.note = b.note.slice(0, 500);
  return body;
}

/**
 * POST /v1/mediator/summons/respond — the counterparty daemon's chained
 * answer to a summons: the delivery acknowledgment.
 *
 * The response is itself a signed, chained event (the daemon publishes on
 * its OWN channel under its OWN card); the summons ledger records the
 * response event's chain coordinates, closing the round trip:
 * summons hash ↔ ack hash, both independently verifiable on the chain.
 * Only the summoned party's DECLARED daemon may answer (sender pinning),
 * a response is write-once (CAS on state='summoned'), and per D11 only
 * `refuse`/`escalate` wakes the human — an `ack` means the agents get to
 * try first.
 */
export async function handleMediatorSummonsRespond(request: Request, env: Env): Promise<Response> {
  if (await getMediatorKilled(env.KV)) {
    return err(409, 'MEDIATOR_KILLED', 'the kill-mediator flag is set — the mediator is inert');
  }

  let rawBody: string;
  let parsed: ChainedRequest;
  try {
    rawBody = await request.text();
    parsed = JSON.parse(rawBody) as ChainedRequest;
  } catch {
    return err(400, 'BAD_JSON', 'Request body must be JSON: { card, event }');
  }
  const ciphertext = parsed.event?.ciphertext;
  if (typeof ciphertext !== 'string' || ciphertext === '') {
    return err(400, 'MISSING_EVENT', 'event with ciphertext required');
  }
  const decoded = base64UrlDecodeToString(ciphertext);
  let bodyUnknown: unknown;
  try {
    bodyUnknown = decoded === null ? null : JSON.parse(decoded);
  } catch {
    bodyUnknown = null;
  }
  const response = validateSummonsResponseBody(bodyUnknown);
  if (typeof response === 'string') return err(400, 'BAD_RESPONSE', response);

  const summons = await getParleySummons(env.DB, response.summonsId);
  if (!summons) return err(404, 'UNKNOWN_SUMMONS', 'no such summons');
  // Sender pinning BEFORE the publish: only the declared daemon's key may
  // answer this summons, and we know that before spending chain writes.
  if (!summons.daemon_fingerprint || parsed.event?.sender !== summons.daemon_fingerprint) {
    return err(403, 'NOT_YOUR_SUMMONS', 'only the summoned party’s declared daemon may respond');
  }
  if (summons.state !== 'summoned') {
    return err(409, 'ALREADY_RESPONDED', `this summons is already ${summons.state} — responses are write-once`);
  }

  // The acknowledgment rides the chain through the one publish gate.
  const published = await delegateToPublish(env, rawBody);
  if (published.status !== 200) return published;
  const pub = (await published.json()) as { seq: number; this_hash: string };
  const event = parsed.event as { channel: string };

  const now = Math.floor(Date.now() / 1000);
  const state = response.response === 'ack' ? 'acked' : response.response === 'refuse' ? 'refused' : 'escalated';
  const humanWoken = state !== 'acked';
  const won = await resolveParleySummons(env.DB, {
    id: summons.id,
    state,
    responseChannel: event.channel,
    responseSeq: pub.seq,
    responseHash: pub.this_hash,
    respondedAt: now,
    escalatedAt: humanWoken ? now : null,
  });
  if (!won) {
    return err(409, 'ALREADY_RESPONDED', 'a concurrent response won — responses are write-once');
  }

  return json(200, {
    code: 'OK',
    error: null,
    summonsId: summons.id,
    state,
    humanWoken,
    ack: { channel: event.channel, seq: pub.seq, hash: pub.this_hash },
  });
}

// ── The human gate's verdict state machine ───────────────────────────────────

/** Everything the parleys page needs to decide what the gate panel renders. */
export type GateVerdictOutcome =
  | 'approved'
  | 'modified'
  | 'rejected'
  | 'mediator-killed'
  | 'fleet-paused'
  | 'no-gate'
  | 'gate-decided'
  | 'not-a-party'
  | 'bad-verdict'
  | 'modify-text-required'
  | 'error';

/**
 * Apply one human verdict to a parley's gate. Pure state machine over
 * already-authenticated inputs — the CALLER (the parleys page handler) has
 * done session + member + named-party gating; this function does the rest:
 *
 *   - kill flag ⇒ inert ('mediator-killed'), nothing written;
 *   - fleet paused ⇒ refused ('fleet-paused') — the relay must never accept
 *     a verdict it cannot enforce, so the grayed-out buttons on the page
 *     have a server-side twin here;
 *   - no gate / already decided ⇒ honest refusals, nothing written;
 *   - Modify REQUIRES text (that text is the whole point of Modify);
 *   - the write is CAS on state='pending' (write-once, like a signature);
 *   - on Modify, the free text is handed to the LOSING agent's re-execution
 *     via the control-plane KV: the loser is the SECOND CLAIMANT's PR (the
 *     first claimant proceeds — same claim order the expiry default uses).
 *
 * @returns The outcome the page maps to a notice code.
 */
export async function renderGateVerdict(
  env: Env,
  args: {
    parley: ParleyRow;
    gate: ParleyGateRow | null;
    /** The viewer's OWN named user seat — null means not a party. */
    viewerIsNamedParty: boolean;
    user: UserRow;
    verdict: string;
    modifyText: string | null;
    /** The losing agent's re-execution target (repo + second claimant's PR). */
    loserTarget: { repo: string; pr: number } | null;
    now: number;
  },
): Promise<GateVerdictOutcome> {
  if (await getMediatorKilled(env.KV)) return 'mediator-killed';
  if (!args.gate) return 'no-gate';
  if (!args.viewerIsNamedParty) return 'not-a-party';
  if (args.gate.state !== 'pending') return 'gate-decided';
  if (args.verdict !== 'approve' && args.verdict !== 'modify' && args.verdict !== 'reject') return 'bad-verdict';
  if (await getFleetPaused(env.KV)) return 'fleet-paused';

  let modifyText: string | null = null;
  if (args.verdict === 'modify') {
    const t = (args.modifyText ?? '').trim();
    if (t === '') return 'modify-text-required';
    if (t.length > MAX_MODIFY_TEXT_CHARS) return 'modify-text-required';
    modifyText = t;
  }

  const state = args.verdict === 'approve' ? 'approved' : args.verdict === 'modify' ? 'modified' : 'rejected';
  const won = await resolveParleyGateState(env.DB, {
    parleyId: args.parley.id,
    state,
    verdictBy: args.user.id,
    verdictByLabel: args.user.login,
    verdictAt: args.now,
    modifyText,
  });
  if (!won) return 'gate-decided';

  if (state === 'modified' && modifyText !== null && args.loserTarget) {
    // Best-effort handoff: a KV hiccup must not un-decide a decided gate.
    try {
      await putMediatorReinjection(env.KV, {
        parleyId: args.parley.id,
        repo: args.loserTarget.repo,
        pr: args.loserTarget.pr,
        action: args.gate.action,
        modifyText,
        decidedBy: args.user.login,
        at: args.now,
      });
    } catch {
      // The verdict stands; the re-injection is retried by re-reading the
      // gate row (modify_text is durable in D1) on the executor's next poll.
    }
  }
  return state;
}
