/**
 * X5 DIRECTORY + WHOIS — consent-first talent/skill search over harbors
 * (docs/proposals/relay-grand-plan.md §X5; grand-plan-dag.md node
 * directory-whois; doctrine D3 "no shadow index").
 *
 *   PUT /v1/harbor/card              signed self-report of declared capabilities
 *   GET /v1/harbor/directory         listed (consented) harbors — public read
 *   GET /v1/harbor/whois?q=          ranked search: declared (TF-IDF) +
 *                                    demonstrated (recency-decayed) signals
 *   PUT /v1/harbor/directory/weights operator-gated; every change audit-logged
 *
 * D3 ENFORCED AS CODE, not policy prose:
 *  - Consent gates DERIVATION, not just the read. `refreshCapabilityIndex`
 *    consults the listing consent BEFORE touching any event source; for an
 *    unlisted operator the derivation path issues zero reads against
 *    chain_heads / events / fleet_runs and returns a refusal.
 *  - Derivation covers only POST-CONSENT events: every source query is floored
 *    at `listed_at`, the instant the signed listing crossed private→public.
 *  - Derived rows are retention-bounded (DIRECTORY_SIGNAL_RETENTION_DAYS,
 *    pruned by the retention sweep) and DROPPED ON DELIST — deleted at the
 *    delist write, and the sweep re-enforces "capability_index rows for
 *    unlisted operators do not exist" on every fire.
 *
 * Trust boundaries:
 *  - Listing is a private→public scope crossing (ADR-0101; scope-ladder.ts is
 *    the single source of the ordering). The consent artifact is the SIGNED
 *    card itself: the listing tier is inside the Ed25519-signed canonical
 *    message, so the relay can prove the operator asked to be public. The
 *    ADR-0101 consent screen renders client-side; the relay accepts only the
 *    signed crossing it can verify.
 *  - The card is verified against the identities registry (registered,
 *    unrevoked, matching pubkey). No bearer path exists — "unattested" rows
 *    are impossible by construction (plan §X5; N2 doctrine).
 *  - Ranking is TF-IDF over declared capability text plus recency-decayed
 *    demonstrated signals derived from chain heads and run verdicts — an
 *    index over signatures, not self-reports. NO hand-built keyword or
 *    synonym lists anywhere (operator hard rule): tokenization + TF-IDF and
 *    exponential decay only.
 *  - Refuse-to-route: below the confidence floor the endpoint returns
 *    `{results: [], reason}` rather than a low-confidence match. Cold start
 *    returns `{results: [], reason}` with HTTP 200 — never 404.
 *  - Ranking-weight changes are operator-gated AND written to audit_log:
 *    down-weighting is accountable, never silent editorial power.
 *  - Fail semantics: bad shapes → 400, unknown/revoked identity or bad
 *    signature → 403, all fail closed; D1 throws bubble to index.ts's
 *    controlled INTERNAL_ERROR envelope.
 */

import type { Env } from './types.js';
import { verifyEd25519, hashHex } from './crypto.js';
import { appendAudit, getIdentity } from './db.js';
import { operatorOnly } from './handlers.js';
import { widensScope, type ScopeTier } from './scope-ladder.js';

// ── Policy constants ──────────────────────────────────────────────────────────

/** Derived demonstrated-signals older than this are pruned by the sweep. */
export const DIRECTORY_SIGNAL_RETENTION_DAYS = 90;
/** Card iat must be within this many seconds of relay now (replay bound). */
export const CARD_IAT_SKEW_SECONDS = 300;
/** Declared capability list bounds (free text, TF-IDF-ranked — never enums). */
const MAX_CAPABILITIES = 32;
const MIN_CAPABILITY_CHARS = 2;
const MAX_CAPABILITY_CHARS = 64;
const MAX_DISPLAY_NAME_CHARS = 64;
/** whois result page size. */
const MAX_WHOIS_RESULTS = 20;
/** Cap on distinct run channels considered per derivation pass. */
const MAX_RUN_CHANNELS = 50;

/** Canonical schema tag signed into every card. */
export const CARD_SCHEMA = 'pd-harbor-card/1';

export interface RankingWeights {
  declaredWeight: number;
  demonstratedWeight: number;
  halfLifeDays: number;
  confidenceFloor: number;
}

/** Committed defaults — served until an operator writes the weights row. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  declaredWeight: 0.6,
  demonstratedWeight: 0.4,
  halfLifeDays: 14,
  confidenceFloor: 0.15,
};

/**
 * Run-verdict → signal weight. fleet_runs.conclusion enumerates exactly these
 * values (schema.sql); this maps a STRUCTURED column we control, not free text.
 */
const RUN_VERDICT_WEIGHTS: Record<string, number> = {
  success: 1.0,
  neutral: 0.25,
  pending: 0,
  cancelled: 0,
  failure: -0.5,
};

// ── Shared response helper (same envelope as src/harbors.ts) ──────────────────

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const FP_RE = /^[0-9a-f]{64}$/;
const SIG_RE = /^[0-9a-f]{128}$/;

// ── Card storage ──────────────────────────────────────────────────────────────

export interface HarborCardRow {
  daemon_fingerprint: string;
  display_name: string | null;
  capabilities_json: string;
  card_iat: number;
  card_sig: string;
  listed: number;
  listed_at: number | null;
  updated_at: number;
}

export async function getHarborCard(
  db: D1Database,
  fingerprint: string,
): Promise<HarborCardRow | null> {
  const row = await db.prepare(
    'SELECT * FROM harbor_cards WHERE daemon_fingerprint = ?'
  ).bind(fingerprint).first<HarborCardRow>();
  return row ?? null;
}

async function listListedCards(db: D1Database): Promise<HarborCardRow[]> {
  const rows = await db.prepare(
    'SELECT * FROM harbor_cards WHERE listed = 1 ORDER BY listed_at DESC'
  ).all<HarborCardRow>();
  return rows.results ?? [];
}

/**
 * Canonical card hash — the Ed25519-signed message. The listing tier is INSIDE
 * the signature so the private→public consent crossing is itself attested.
 */
export function cardCanonicalHash(card: {
  fingerprint: string;
  iat: number;
  listing: ScopeTier;
  displayName: string | null;
  capabilities: string[];
}): string {
  return hashHex([
    CARD_SCHEMA,
    card.fingerprint,
    String(card.iat),
    card.listing,
    card.displayName ?? '',
    card.capabilities.join(','),
  ].join('|'));
}

// ── D3 derivation — consent gates DERIVATION, not just the read ───────────────

export type DeriveOutcome =
  | { ok: true; signals: number }
  | { ok: false; refused: 'not-listed' };

interface SignalRow {
  capability: string;
  signal_kind: 'chain-head' | 'run-verdict';
  source: string;
  observed_at: number;
  weight: number;
}

/**
 * (Re)derive one operator's demonstrated-capability signals.
 *
 * D3 AS CODE: the consent check is the FIRST thing this function does, and an
 * unlisted operator's call returns BEFORE any query against an event source
 * (chain_heads / events / fleet_runs) is even constructed. Tests assert the
 * refusal issues zero event-source reads — "no derivation", not "no rows".
 *
 * Post-consent only: every source query is floored at `listed_at`. Signals are
 * an index over SIGNATURES — chain heads the operator's key produced, and run
 * verdicts attributed through events the operator's key signed on a
 * fleet-cloud run channel — never over self-reports.
 */
export async function refreshCapabilityIndex(
  env: Env,
  fingerprint: string,
  now: number,
): Promise<DeriveOutcome> {
  const card = await getHarborCard(env.DB, fingerprint);
  if (!card || card.listed !== 1 || card.listed_at === null) {
    return { ok: false, refused: 'not-listed' };
  }
  const since = card.listed_at;
  const signals: SignalRow[] = [];

  // Signed activity: chain heads this fingerprint produced after consent.
  const heads = await env.DB.prepare(
    'SELECT channel, issued_at FROM chain_heads WHERE sender = ? AND issued_at >= ?'
  ).bind(fingerprint, since).all<{ channel: string; issued_at: number }>();
  for (const h of heads.results ?? []) {
    signals.push({
      capability: '*',
      signal_kind: 'chain-head',
      source: h.channel,
      observed_at: h.issued_at,
      weight: 1.0,
    });
  }

  // Run verdicts, attributed through SIGNED events: channels this fingerprint
  // published on that follow the fleet-cloud run convention
  // (`<relayFp>:fleet-cloud:<runId>`, N2). The verdict itself comes from the
  // fleet_runs header the channel names.
  const evs = await env.DB.prepare(
    "SELECT channel, MAX(iat) AS iat FROM events WHERE sender = ? AND iat >= ? AND channel LIKE '%fleet-cloud%' GROUP BY channel LIMIT ?"
  ).bind(fingerprint, since, MAX_RUN_CHANNELS).all<{ channel: string; iat: number }>();
  const runIds: string[] = [];
  const RUN_MARKER = ':fleet-cloud:';
  for (const e of evs.results ?? []) {
    // Run ids themselves contain colons (`run:<deliveryId>`), so take
    // everything after the channel-convention marker, never the last segment.
    const idx = e.channel.indexOf(RUN_MARKER);
    if (idx < 0) continue; // bare coordination channel — no run to attribute
    const runId = e.channel.slice(idx + RUN_MARKER.length);
    if (runId && !runIds.includes(runId)) runIds.push(runId);
  }
  if (runIds.length > 0) {
    const placeholders = runIds.map(() => '?').join(',');
    // Floored at `since` like every other source query: a run CREATED before
    // the consent instant contributes no signal, even when the signed event
    // that attributes it arrived post-consent (D3: post-consent events only).
    const runs = await env.DB.prepare(
      `SELECT id, conclusion, created_at FROM fleet_runs WHERE id IN (${placeholders}) AND created_at >= ?`
    ).bind(...runIds, since).all<{ id: string; conclusion: string; created_at: number }>();
    for (const r of runs.results ?? []) {
      signals.push({
        capability: '*',
        signal_kind: 'run-verdict',
        source: r.id,
        observed_at: r.created_at,
        weight: RUN_VERDICT_WEIGHTS[r.conclusion] ?? 0,
      });
    }
  }

  // Idempotent rewrite of this operator's derived rows.
  await env.DB.prepare(
    'DELETE FROM capability_index WHERE daemon_fingerprint = ?'
  ).bind(fingerprint).run();
  for (const s of signals) {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO capability_index (daemon_fingerprint, capability, signal_kind, source, observed_at, weight) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(fingerprint, s.capability, s.signal_kind, s.source, s.observed_at, s.weight).run();
  }
  return { ok: true, signals: signals.length };
}

/** Delist = derived rows die with the consent, at the write itself. */
async function dropDerivedRows(db: D1Database, fingerprint: string): Promise<void> {
  await db.prepare(
    'DELETE FROM capability_index WHERE daemon_fingerprint = ?'
  ).bind(fingerprint).run();
}

// ── PUT /v1/harbor/card — signed self-report ─────────────────────────────────

interface CardBody {
  fingerprint?: unknown;
  capabilities?: unknown;
  displayName?: unknown;
  iat?: unknown;
  listing?: unknown;
  sig?: unknown;
}

export async function handlePutHarborCard(request: Request, env: Env): Promise<Response> {
  let body: CardBody;
  try {
    body = (await request.json()) as CardBody;
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body required' });
  }

  const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint.trim().toLowerCase() : '';
  if (!FP_RE.test(fingerprint)) {
    return json(400, { code: 'BAD_FINGERPRINT', error: 'fingerprint must be 64 hex chars' });
  }
  if (!Array.isArray(body.capabilities) || body.capabilities.length === 0 || body.capabilities.length > MAX_CAPABILITIES) {
    return json(400, { code: 'BAD_CAPABILITIES', error: `capabilities must be a non-empty array of at most ${MAX_CAPABILITIES} strings` });
  }
  const capabilities: string[] = [];
  for (const c of body.capabilities) {
    if (typeof c !== 'string') return json(400, { code: 'BAD_CAPABILITIES', error: 'every capability must be a string' });
    const t = c.trim();
    if (t.length < MIN_CAPABILITY_CHARS || t.length > MAX_CAPABILITY_CHARS) {
      return json(400, { code: 'BAD_CAPABILITIES', error: `each capability must be ${MIN_CAPABILITY_CHARS}–${MAX_CAPABILITY_CHARS} chars` });
    }
    if (t.includes(',') || t.includes('|')) {
      return json(400, { code: 'BAD_CAPABILITIES', error: 'capabilities must not contain "," or "|" (canonical-form separators)' });
    }
    capabilities.push(t);
  }
  const displayName =
    body.displayName === undefined || body.displayName === null
      ? null
      : typeof body.displayName === 'string' && body.displayName.trim().length <= MAX_DISPLAY_NAME_CHARS && body.displayName.trim().length > 0
        ? body.displayName.trim()
        : undefined;
  if (displayName === undefined) {
    return json(400, { code: 'BAD_DISPLAY_NAME', error: `displayName must be a 1–${MAX_DISPLAY_NAME_CHARS} char string when present` });
  }

  // A card is either private (self-report on file, NOT in the directory, NO
  // derivation) or public (listed; derivation begins at this consent). Only
  // these two rungs of the scope ladder are meaningful for a directory card.
  const listing = body.listing;
  if (listing !== 'private' && listing !== 'public') {
    return json(400, { code: 'BAD_LISTING', error: "listing must be 'private' or 'public'" });
  }
  const iat = typeof body.iat === 'number' && Number.isFinite(body.iat) ? Math.floor(body.iat) : null;
  if (iat === null) return json(400, { code: 'BAD_IAT', error: 'iat (unix seconds) required' });
  const sig = typeof body.sig === 'string' ? body.sig.trim().toLowerCase() : '';
  if (!SIG_RE.test(sig)) return json(400, { code: 'BAD_SIG', error: 'sig must be a 128-hex-char ed25519 signature' });

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > CARD_IAT_SKEW_SECONDS) {
    return json(400, { code: 'STALE_CARD', error: `card iat must be within ${CARD_IAT_SKEW_SECONDS}s of relay time` });
  }

  // Identity gate: registered, unrevoked — fail closed. No bearer path exists.
  const identity = await getIdentity(env.DB, fingerprint);
  if (!identity || identity.revoked) {
    return json(403, { code: 'UNKNOWN_IDENTITY', error: 'no registered, unrevoked daemon identity with that fingerprint' });
  }

  // The signature covers the listing tier — the private→public crossing is
  // itself the signed ADR-0101 consent artifact (scope-ladder.ts ordering).
  const canonical = cardCanonicalHash({ fingerprint, iat, listing, displayName, capabilities });
  const sigOk = await verifyEd25519(identity.pub_key, canonical, sig);
  if (!sigOk) {
    return json(403, { code: 'BAD_SIGNATURE', error: 'card signature does not verify against the registered identity key' });
  }

  const prev = await getHarborCard(env.DB, fingerprint);
  const wasListed = prev?.listed === 1;
  const wantsListing = listing === 'public';
  // widensScope is the single source of the crossing direction (ADR-0101):
  // unlisted→listed widens private→public and requires the signed consent
  // above; listed→unlisted narrows and triggers the D3 row drop.
  const crossesToPublic = !wasListed && wantsListing && widensScope('private', 'public');
  const delists = wasListed && !wantsListing;

  // Consent instant: set at the crossing, preserved while listed, cleared on
  // delist. Re-listing later starts a NEW consent window (old rows are gone).
  // listed_at is propagated ONLY from a prior card that was actually LISTED —
  // a stale listed_at on a non-listed row (crash remnant, imported data) must
  // never widen the consent window; and a listed row that somehow lost its
  // listed_at is repaired to `now` rather than left null.
  const listedAt = wantsListing ? (wasListed ? (prev?.listed_at ?? now) : now) : null;

  await env.DB.prepare(`
    INSERT INTO harbor_cards (daemon_fingerprint, display_name, capabilities_json, card_iat, card_sig, listed, listed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (daemon_fingerprint) DO UPDATE SET
      display_name = excluded.display_name,
      capabilities_json = excluded.capabilities_json,
      card_iat = excluded.card_iat,
      card_sig = excluded.card_sig,
      listed = excluded.listed,
      listed_at = excluded.listed_at,
      updated_at = excluded.updated_at
  `).bind(
    fingerprint,
    displayName,
    JSON.stringify(capabilities),
    iat,
    sig,
    wantsListing ? 1 : 0,
    listedAt,
    now,
  ).run();

  let derivedSignals = 0;
  if (delists) {
    // D3: derived rows die WITH the consent — at this write, not merely at the
    // next sweep (the sweep re-enforces the invariant as a backstop).
    await dropDerivedRows(env.DB, fingerprint);
    await appendAudit(env.DB, {
      daemon_fingerprint: fingerprint,
      action: 'directory.delisted',
      target: 'harbor_cards',
      detail: JSON.stringify({ droppedDerivedRows: true }),
    });
  } else if (wantsListing) {
    if (crossesToPublic) {
      await appendAudit(env.DB, {
        daemon_fingerprint: fingerprint,
        action: 'directory.listed',
        target: 'harbor_cards',
        detail: JSON.stringify({ listedAt, consent: 'signed private->public crossing' }),
      });
    }
    // Derivation begins AT listing consent (consent→first-row freshness is a
    // Mercy signal in the plan); refreshed here and by later re-PUTs.
    const outcome = await refreshCapabilityIndex(env, fingerprint, now);
    derivedSignals = outcome.ok ? outcome.signals : 0;
  }
  // An unlisted card that stays unlisted triggers NO derivation of any kind.

  return json(200, {
    code: 'OK',
    error: null,
    card: {
      fingerprint,
      displayName,
      capabilities,
      listed: wantsListing,
      listedAt,
      updatedAt: now,
    },
    derivedSignals,
  });
}

// ── Ranking weights (operator-set, audit-logged) ──────────────────────────────

export async function getRankingWeights(db: D1Database): Promise<RankingWeights> {
  const row = await db.prepare(
    'SELECT declared_weight, demonstrated_weight, half_life_days, confidence_floor FROM directory_ranking_weights WHERE id = 1'
  ).first<{ declared_weight: number; demonstrated_weight: number; half_life_days: number; confidence_floor: number }>();
  if (!row) return DEFAULT_RANKING_WEIGHTS;
  return {
    declaredWeight: row.declared_weight,
    demonstratedWeight: row.demonstrated_weight,
    halfLifeDays: row.half_life_days,
    confidenceFloor: row.confidence_floor,
  };
}

interface WeightsBody {
  declaredWeight?: unknown;
  demonstratedWeight?: unknown;
  halfLifeDays?: unknown;
  confidenceFloor?: unknown;
}

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export async function handleSetDirectoryWeights(request: Request, env: Env): Promise<Response> {
  const authErr = operatorOnly(request, env);
  if (authErr) return authErr;

  let body: WeightsBody;
  try {
    body = (await request.json()) as WeightsBody;
  } catch {
    return json(400, { code: 'BAD_REQUEST', error: 'JSON body required' });
  }

  const old = await getRankingWeights(env.DB);
  const next: RankingWeights = {
    declaredWeight: body.declaredWeight === undefined ? old.declaredWeight : (isFiniteNum(body.declaredWeight) ? body.declaredWeight : NaN),
    demonstratedWeight: body.demonstratedWeight === undefined ? old.demonstratedWeight : (isFiniteNum(body.demonstratedWeight) ? body.demonstratedWeight : NaN),
    halfLifeDays: body.halfLifeDays === undefined ? old.halfLifeDays : (isFiniteNum(body.halfLifeDays) ? body.halfLifeDays : NaN),
    confidenceFloor: body.confidenceFloor === undefined ? old.confidenceFloor : (isFiniteNum(body.confidenceFloor) ? body.confidenceFloor : NaN),
  };
  if (
    !Number.isFinite(next.declaredWeight) || next.declaredWeight < 0 ||
    !Number.isFinite(next.demonstratedWeight) || next.demonstratedWeight < 0 ||
    next.declaredWeight + next.demonstratedWeight <= 0 ||
    !Number.isFinite(next.halfLifeDays) || next.halfLifeDays <= 0 || next.halfLifeDays > 365 ||
    !Number.isFinite(next.confidenceFloor) || next.confidenceFloor < 0 || next.confidenceFloor > 1
  ) {
    return json(400, {
      code: 'BAD_WEIGHTS',
      error: 'weights must be finite: declared/demonstrated >= 0 (sum > 0), 0 < halfLifeDays <= 365, 0 <= confidenceFloor <= 1',
    });
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`
    INSERT INTO directory_ranking_weights (id, declared_weight, demonstrated_weight, half_life_days, confidence_floor, updated_at)
    VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      declared_weight = excluded.declared_weight,
      demonstrated_weight = excluded.demonstrated_weight,
      half_life_days = excluded.half_life_days,
      confidence_floor = excluded.confidence_floor,
      updated_at = excluded.updated_at
  `).bind(next.declaredWeight, next.demonstratedWeight, next.halfLifeDays, next.confidenceFloor, now).run();

  // Every ranking-weight change is written to the audit log (plan §X5):
  // down-weighting is accountable, never silent editorial power.
  await appendAudit(env.DB, {
    action: 'directory.ranking-weights.change',
    target: 'directory_ranking_weights',
    detail: JSON.stringify({ old, next }),
  });

  return json(200, { code: 'OK', error: null, weights: next });
}

// ── GET /v1/harbor/directory — listed harbors (public read by consent) ────────

export async function handleDirectory(env: Env): Promise<Response> {
  const cards = await listListedCards(env.DB);
  return json(200, {
    code: 'OK',
    error: null,
    harbors: cards.map((c) => ({
      fingerprint: c.daemon_fingerprint,
      displayName: c.display_name,
      capabilities: JSON.parse(c.capabilities_json) as string[],
      listedAt: c.listed_at,
      updatedAt: c.updated_at,
    })),
    ...(cards.length === 0 ? { reason: 'cold-start: no harbors have consented to listing yet' } : {}),
  });
}

// ── TF-IDF over declared capabilities (sanctioned baseline; no keyword lists) ─

/**
 * Tokenize free text for TF-IDF. This is TOKENIZATION (splitting on
 * non-word boundaries), not a keyword/synonym list — there is no enumeration
 * of category terms anywhere in this module (operator hard rule).
 */
export function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length >= 2);
}

/**
 * Cosine TF-IDF scores of `query` against each document (a document is one
 * card's declared capabilities joined). Returns one score in [0,1] per doc.
 */
export function scoreDeclared(query: string, docs: string[][]): number[] {
  const docTokens = docs.map((caps) => tokenize(caps.join(' ')));
  const n = docTokens.length;
  const df = new Map<string, number>();
  for (const toks of docTokens) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string): number => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const qTokens = tokenize(query);
  if (qTokens.length === 0) return docs.map(() => 0);
  const qTf = new Map<string, number>();
  for (const t of qTokens) qTf.set(t, (qTf.get(t) ?? 0) + 1);
  const qVec = new Map<string, number>();
  let qNormSq = 0;
  for (const [t, c] of qTf) {
    const w = (c / qTokens.length) * idf(t);
    qVec.set(t, w);
    qNormSq += w * w;
  }
  const qNorm = Math.sqrt(qNormSq);

  return docTokens.map((toks) => {
    if (toks.length === 0 || qNorm === 0) return 0;
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    let dot = 0;
    let dNormSq = 0;
    for (const [t, c] of tf) {
      const w = (c / toks.length) * idf(t);
      dNormSq += w * w;
      const qw = qVec.get(t);
      if (qw !== undefined) dot += w * qw;
    }
    const dNorm = Math.sqrt(dNormSq);
    return dNorm === 0 ? 0 : dot / (qNorm * dNorm);
  });
}

// ── GET /v1/harbor/whois?q= — ranked, refuse-to-route, never 404 ─────────────

/** Recency-decayed demonstrated score, saturated into [0,1). */
export function demonstratedSaturation(
  rows: Array<{ observed_at: number; weight: number }>,
  now: number,
  halfLifeDays: number,
): number {
  const halfLifeSeconds = halfLifeDays * 24 * 60 * 60;
  let sum = 0;
  for (const r of rows) {
    const age = Math.max(0, now - r.observed_at);
    sum += r.weight * Math.pow(2, -age / halfLifeSeconds);
  }
  const clamped = Math.max(0, sum);
  return clamped / (clamped + 1);
}

export async function handleWhois(request: Request, env: Env): Promise<Response> {
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length === 0) {
    return json(400, { code: 'BAD_QUERY', error: 'q (search text) required' });
  }
  const now = Math.floor(Date.now() / 1000);
  const weights = await getRankingWeights(env.DB);
  const cards = await listListedCards(env.DB);

  // Cold start is a normal, stated condition — never a 404.
  if (cards.length === 0) {
    return json(200, {
      code: 'OK',
      error: null,
      results: [],
      reason: 'cold-start: no harbors have consented to listing yet',
    });
  }

  // Demonstrated signals for the listed cohort (rows exist ONLY post-consent —
  // reading them derives nothing; derivation happened at consent time).
  const sig = await env.DB.prepare(
    'SELECT daemon_fingerprint, observed_at, weight FROM capability_index'
  ).all<{ daemon_fingerprint: string; observed_at: number; weight: number }>();
  const byFp = new Map<string, Array<{ observed_at: number; weight: number }>>();
  for (const r of sig.results ?? []) {
    const list = byFp.get(r.daemon_fingerprint) ?? [];
    list.push({ observed_at: r.observed_at, weight: r.weight });
    byFp.set(r.daemon_fingerprint, list);
  }

  const capsPerCard = cards.map((c) => JSON.parse(c.capabilities_json) as string[]);
  const declared = scoreDeclared(q, capsPerCard);
  const wSum = weights.declaredWeight + weights.demonstratedWeight;
  const wD = weights.declaredWeight / wSum;
  const wM = weights.demonstratedWeight / wSum;

  const scored = cards
    .map((c, i) => {
      const declaredScore = declared[i] ?? 0;
      const demonstratedScore = demonstratedSaturation(byFp.get(c.daemon_fingerprint) ?? [], now, weights.halfLifeDays);
      return {
        fingerprint: c.daemon_fingerprint,
        displayName: c.display_name,
        capabilities: capsPerCard[i] ?? [],
        declaredScore,
        demonstratedScore,
        confidence: wD * declaredScore + wM * demonstratedScore,
      };
    })
    // A card must MATCH the query on its declared capabilities to be routable;
    // demonstrated activity alone never turns a non-match into a result.
    .filter((r) => r.declaredScore > 0)
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  if (top === undefined) {
    return json(200, {
      code: 'OK',
      error: null,
      results: [],
      reason: 'no-match: no listed harbor declares capabilities matching the query',
    });
  }
  // Refuse-to-route: a low-confidence best match is an empty answer with a
  // reason, not a bad route.
  if (top.confidence < weights.confidenceFloor) {
    return json(200, {
      code: 'OK',
      error: null,
      results: [],
      reason: `below-confidence-floor: best match confidence ${top.confidence.toFixed(3)} < floor ${weights.confidenceFloor}`,
    });
  }

  return json(200, {
    code: 'OK',
    error: null,
    results: scored.slice(0, MAX_WHOIS_RESULTS).map((r) => ({
      fingerprint: r.fingerprint,
      displayName: r.displayName,
      capabilities: r.capabilities,
      confidence: Number(r.confidence.toFixed(4)),
      declaredScore: Number(r.declaredScore.toFixed(4)),
      demonstratedScore: Number(r.demonstratedScore.toFixed(4)),
    })),
    weights,
  });
}
