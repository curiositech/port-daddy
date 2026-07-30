/**
 * Human-facing fleet run page (ADR-0101 Phase 0).
 *
 *   GET /fleet/runs/:id?t=<hmac>   — server-rendered HTML deliberation breakdown
 *
 * This is the target of the GitHub check run's details_url ("View more details
 * on Port Daddy Fleet"). Access model — capability URL:
 *
 *   - The `t` token is hex(HMAC-SHA256(RUN_PAGE_SECRET, runId)), minted by the
 *     fleet-executor and embedded in the details_url. GitHub's own repo ACL
 *     decides who ever SEES that link, so token possession ≈ PR read access —
 *     and everything rendered here is also posted as PR comments, so the page
 *     never widens exposure. The token makes deterministic run ids
 *     (`run:<deliveryId>`) unguessable and is revocable by rotating the secret.
 *   - The operator bearer token (Authorization header) also opens any run.
 *   - Everything else gets the SAME 404 page whether the run exists or not
 *     (no existence oracle).
 *
 * Rendering is strictly server-side with every interpolated value HTML-escaped
 * (transcript content is model output — attacker-influenced text), and the
 * response carries a no-script CSP. No JavaScript is served at all.
 */

import { timingSafeEqual } from './crypto.js';
import { getFleetRunWithSteps, type FleetRunRow, type FleetRunStepRow } from './db.js';
import { resolveSession, userCanReadRepo } from './auth-github.js';
import type { Env } from './types.js';

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;

// ── Gate ──────────────────────────────────────────────────────────────────────

/** hex(HMAC-SHA256(secret, runId)) — must match apps/fleet-executor/src/run-page.ts. */
export async function runPageToken(secret: string, runId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(runId));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a presented capability token against the current (and, during a
 * rotation grace window, the previous) RUN_PAGE_SECRET. Accepts both the
 * versioned `v1.<hmac>` form the executor emits post-ADR-0101 (Z1) and the
 * legacy bare `<hmac>` form stamped on already-existing check runs. Fail-closed
 * on a missing/short current secret.
 */
async function verifyRunToken(env: Env, runId: string, presented: string): Promise<boolean> {
  const hmac = presented.startsWith('v1.') ? presented.slice(3) : presented;
  if (!/^[0-9a-f]{64}$/.test(hmac)) return false;
  const secrets = [env.RUN_PAGE_SECRET, env.RUN_PAGE_SECRET_PREV].filter(
    (s): s is string => typeof s === 'string' && s.length >= 32,
  );
  if (secrets.length === 0) return false;
  for (const secret of secrets) {
    if (timingSafeEqual(hmac, await runPageToken(secret, runId))) return true;
  }
  return false;
}

/** Operator bearer OR a valid (versioned/legacy) capability token. */
async function hasTokenAuth(request: Request, env: Env, runId: string): Promise<boolean> {
  const auth = request.headers.get('Authorization');
  if (auth && env.RELAY_OPERATOR_TOKEN && env.RELAY_OPERATOR_TOKEN.length >= 32) {
    const bearer = auth.replace(/^Bearer\s+/i, '');
    if (timingSafeEqual(bearer, env.RELAY_OPERATOR_TOKEN)) return true;
  }
  const presented = new URL(request.url).searchParams.get('t') ?? '';
  if (!presented) return false;
  return verifyRunToken(env, runId, presented);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // No scripts, ever: transcript content is model output.
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      // Capability URLs must not end up in caches or search indexes.
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

const PAGE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.25rem 4rem;
    background: #0c131f; color: #dce5f1;
    font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 60rem; margin: 0 auto; }
  a { color: #7fb4ff; }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  .eyebrow {
    font-size: 0.75rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.14em; color: #8fa3bd; margin-bottom: 0.75rem;
  }
  .meta { color: #97a8c0; font-size: 0.875rem; }
  .badge {
    display: inline-block; padding: 0.2rem 0.65rem; border-radius: 999px;
    font-size: 0.875rem; font-weight: 700; vertical-align: middle; margin-left: 0.5rem;
  }
  .badge.success { background: #14351f; color: #6fd692; border: 1px solid #2c6b42; }
  .badge.failure { background: #3b1720; color: #ff9aa8; border: 1px solid #7c3040; }
  .badge.neutral, .badge.other { background: #2a2f3a; color: #b8c2d4; border: 1px solid #4a5468; }
  .statgrid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1px; background: #223047; border: 1px solid #223047; margin: 1.5rem 0 2rem;
  }
  .stat { background: #101a2a; padding: 0.9rem 1rem; }
  .stat .k { font-size: 0.8125rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #8fa3bd; }
  .stat .v { font-size: 1.25rem; font-weight: 700; margin-top: 0.15rem; font-variant-numeric: tabular-nums; }
  section.ship { border: 1px solid #223047; background: #101a2a; margin-bottom: 1.25rem; }
  section.ship > header {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 0.75rem 1rem; border-bottom: 1px solid #223047; background: #132033;
  }
  section.ship > header h2 { margin: 0; font-size: 1.0625rem; }
  section.ship > header .ship-title { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
  .outcome {
    font-size: 0.75rem; font-weight: 700; letter-spacing: 0.03em; text-transform: uppercase;
    padding: 0.1rem 0.55rem; border-radius: 999px;
  }
  .outcome.tone-pass    { background: #14351f; color: #6fd692; border: 1px solid #2c6b42; }
  .outcome.tone-block   { background: #3b1720; color: #ff9aa8; border: 1px solid #7c3040; }
  .outcome.tone-neutral { background: #2a2f3a; color: #b8c2d4; border: 1px solid #4a5468; }
  ol.steps { list-style: none; margin: 0; padding: 0; }
  li.step { padding: 0.7rem 1rem; border-bottom: 1px solid #1a2638; border-left: 3px solid transparent; }
  li.step:last-child { border-bottom: none; }
  li.step.tone-pass  { border-left-color: #2c6b42; }
  li.step.tone-block { border-left-color: #7c3040; }
  li.step.tone-skip  { border-left-color: #3a4560; }
  .step-head { display: flex; gap: 0.6rem; align-items: baseline; flex-wrap: wrap; }
  .step-icon { font-size: 1rem; line-height: 1.2; flex: none; }
  .narrative { color: #dce5f1; font-size: 0.9375rem; flex: 1 1 20rem; }
  .t { color: #718096; font-size: 0.8125rem; font-variant-numeric: tabular-nums; margin-left: auto; }
  details { margin-top: 0.45rem; }
  summary { cursor: pointer; color: #8fa3bd; font-size: 0.8125rem; }
  pre {
    margin: 0.5rem 0 0; padding: 0.75rem; overflow-x: auto;
    background: #0a1017; border: 1px solid #1a2638;
    font: 0.8125rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  .review { margin-top: 0.55rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .finding {
    background: #0d1522; border: 1px solid #223047; border-left-width: 3px;
    padding: 0.5rem 0.7rem; border-radius: 4px;
  }
  .finding.sev-high   { border-left-color: #ff6b7f; }
  .finding.sev-medium { border-left-color: #e8c15a; }
  .finding.sev-low    { border-left-color: #6a7a92; }
  .finding-head { display: flex; gap: 0.6rem; align-items: baseline; flex-wrap: wrap; font-size: 0.8125rem; }
  .finding-head .sev { font-weight: 700; }
  .floc {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #9db7dc;
    background: #0a1017; padding: 0.05rem 0.4rem; border-radius: 3px; border: 1px solid #1a2638;
  }
  .finding-body { margin-top: 0.35rem; color: #c3cfe0; font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; }
  ol.breakdown { list-style: none; margin: 0.4rem 0 0; padding: 0; }
  ol.breakdown li {
    padding: 0.15rem 0; color: #97a8c0; font-size: 0.8125rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  footer { margin-top: 2.5rem; color: #718096; font-size: 0.875rem; border-top: 1px solid #223047; padding-top: 1rem; }
`;

function shell(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body><main>${inner}</main></body>
</html>`;
}

function notFoundPage(): Response {
  return htmlResponse(
    shell(
      'Run not found — Port Daddy Fleet',
      `<div class="eyebrow">Port Daddy Fleet</div>
       <h1>Run not found</h1>
       <p class="meta">This run does not exist, or the link is missing its access token.
       Open the page from the pull request's <strong>“View more details on Port Daddy Fleet”</strong> link.</p>`,
    ),
    404,
  );
}

// ── Rendering ────────────────────────────────────────────────────────────────

function badgeClass(conclusion: string): string {
  if (conclusion === 'success') return 'success';
  if (conclusion === 'failure') return 'failure';
  if (conclusion === 'neutral') return 'neutral';
  return 'other';
}

function fmtUtc(sec: number): string {
  return new Date(sec * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 90 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Sum a numeric field across step detail blobs (tokens live per step). */
function sumDetailField(steps: FleetRunStepRow[], field: string): number {
  let total = 0;
  for (const s of steps) {
    if (!s.detail) continue;
    try {
      // reason: parsed JSON boundary — value is typeof-checked below before use.
      const d = JSON.parse(s.detail) as Record<string, unknown>;
      const v = d[field];
      if (typeof v === 'number' && Number.isFinite(v)) total += v;
    } catch {
      /* non-JSON detail — nothing to sum */
    }
  }
  return total;
}

// ── Step semantics: English narratives over the raw kind/detail ──────────────
//
// The transcript store speaks in machine kinds ("map-chunk", "reduce",
// "ship-verdict") and dumps its `detail` blob as raw JSON. That reads as
// "endless helpful maps with no specificity". This layer turns each row into a
// plain-English sentence describing what the agent actually did, renders a
// ship's structured findings as an on-page review with line-level annotations
// (the same substance findings-render.ts posts to GitHub, not a JSON dump), and
// consolidates the repetitive per-chunk MAP rows into one line the operator can
// skip past. Everything model-influenced is still HTML-escaped.

type Severity = 'HIGH' | 'MEDIUM' | 'LOW';
interface Finding {
  path: string;
  line: number;
  severity: Severity;
  body: string;
}

const SEV_BADGE: Record<Severity, string> = { HIGH: '🔴 HIGH', MEDIUM: '🟡 MEDIUM', LOW: '⚪ LOW' };
const SEV_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Parse a step's detail blob to a value, or null when absent/non-JSON. */
function parseDetail(step: FleetRunStepRow): unknown {
  if (!step.detail || step.detail === 'null') return null;
  try {
    return JSON.parse(step.detail);
  } catch {
    return null;
  }
}

/** Pretty-print a step's detail for the secondary "raw step data" affordance. */
function prettyDetail(step: FleetRunStepRow): string | null {
  if (!step.detail || step.detail === 'null') return null;
  try {
    return JSON.stringify(JSON.parse(step.detail), null, 2);
  } catch {
    return step.detail;
  }
}

/** Read a finite number field off a parsed object, else undefined. */
function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Narrow a parsed detail to a plain object (not array/primitive/null). */
function asObject(detail: unknown): Record<string, unknown> {
  return detail && typeof detail === 'object' && !Array.isArray(detail)
    ? (detail as Record<string, unknown>)
    : {};
}

/**
 * Tolerantly extract line-level {@link Finding}s from a ship-verdict detail.
 * Reviewer ships store the raw `Finding[]`; older/opaque shapes may nest it
 * under `.findings`. Anything that does not match the {path,line,body} schema
 * is ignored (it falls through to the raw-JSON affordance instead).
 */
function extractFindings(detail: unknown): Finding[] {
  const arr = Array.isArray(detail)
    ? detail
    : Array.isArray(asObject(detail).findings)
      ? (asObject(detail).findings as unknown[])
      : null;
  if (!arr) return [];
  const out: Finding[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== 'string' || typeof o.line !== 'number' || typeof o.body !== 'string') continue;
    const s = String(o.severity ?? 'LOW').toUpperCase();
    const severity: Severity = s === 'HIGH' ? 'HIGH' : s === 'MEDIUM' || s === 'MED' ? 'MEDIUM' : 'LOW';
    out.push({ path: o.path, line: o.line, severity, body: o.body });
  }
  return out;
}

/** Last PASS/BLOCK token in a step title, e.g. "pd-code-reviewer: BLOCK". */
function verdictFromTitle(title: string): 'PASS' | 'BLOCK' | null {
  const m = /:\s*(PASS|BLOCK)\b/i.exec(title);
  const token = m?.[1];
  return token ? (token.toUpperCase() as 'PASS' | 'BLOCK') : null;
}

/**
 * Render a ship's findings as a legible review with line-level annotations —
 * the on-page equivalent of the markdown reviewer comment (findings-render.ts),
 * so the operator reads an actual review instead of a raw JSON array. Grouped
 * HIGH → MEDIUM → LOW; every path/body is escaped (model output).
 */
function renderFindingsHtml(findings: Finding[]): string {
  if (findings.length === 0) return '';
  const sorted = [...findings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  const rows = sorted
    .map(
      f => `<div class="finding sev-${f.severity.toLowerCase()}">
        <div class="finding-head">
          <span class="sev">${esc(SEV_BADGE[f.severity])}</span>
          <span class="floc">${esc(f.path)}:${esc(String(f.line))}</span>
        </div>
        <div class="finding-body">${esc(f.body)}</div>
      </div>`,
    )
    .join('');
  return `<div class="review">${rows}</div>`;
}

interface StepView {
  icon: string;
  tone: 'pass' | 'block' | 'neutral' | 'info' | 'skip';
  headline: string;
  bodyHtml: string;
}

/** Turn one non-MAP transcript step into an English narrative + optional body. */
function describeStep(step: FleetRunStepRow, shipLabel: string): StepView {
  const detail = parseDetail(step);
  const obj = asObject(detail);

  switch (step.kind) {
    case 'reduce': {
      const n = numField(obj, 'chunkCount');
      const len = numField(obj, 'outputLength');
      return {
        icon: '🧵',
        tone: 'info',
        headline:
          `Merged the findings from ${n ?? 'several'} diff chunks into one review` +
          `${len != null ? ` (${len.toLocaleString('en-US')} chars).` : '.'}`,
        bodyHtml: '',
      };
    }

    case 'ship-skipped': {
      const reason = typeof obj.reason === 'string' ? obj.reason : 'nothing to review on this diff';
      return {
        icon: '⏭️',
        tone: 'skip',
        headline: `Skipped ${shipLabel} — ${reason}. No AI spend.`,
        bodyHtml: '',
      };
    }

    case 'ship-finding':
      return {
        icon: '⚠️',
        tone: 'block',
        headline: `${shipLabel} returned output the fleet could not parse — treated as errored (fail-closed).`,
        bodyHtml: '',
      };

    case 'ship-verdict': {
      const verdict = verdictFromTitle(step.title);

      // Ideation ships propose forward work rather than gating.
      if (/ideation/i.test(step.title) || 'proposals' in obj) {
        const proposals = obj.proposals;
        if (Array.isArray(proposals)) {
          const items = proposals
            .map(p => {
              const po = asObject(p);
              const t = typeof po.title === 'string' ? po.title : 'proposal';
              const action = typeof po.action === 'string' ? po.action : 'idea';
              const rationale = typeof po.rationale === 'string' ? po.rationale : '';
              return `<div class="finding">
                <div class="finding-head"><span class="floc">${esc(action)}</span><span>${esc(t)}</span></div>
                ${rationale ? `<div class="finding-body">${esc(rationale)}</div>` : ''}
              </div>`;
            })
            .join('');
          return {
            icon: '💡',
            tone: 'neutral',
            headline:
              `${shipLabel} proposed ${proposals.length} piece${proposals.length === 1 ? '' : 's'} of ` +
              'forward work (advisory — never gates the merge).',
            bodyHtml: proposals.length ? `<div class="review">${items}</div>` : '',
          };
        }
        return {
          icon: '💡',
          tone: 'neutral',
          headline: `${shipLabel} ran as an ideation ship (advisory) — its proposal block was malformed.`,
          bodyHtml: '',
        };
      }

      // A ship whose job errored resolves fail-closed.
      if (obj.errored === true) {
        return {
          icon: '⚠️',
          tone: 'block',
          headline: `${shipLabel} errored — resolved to ${verdict ?? 'BLOCK'} (fail-closed).`,
          bodyHtml: '',
        };
      }

      // Reviewer verdict: render its structured findings as a real review.
      const findings = extractFindings(detail);
      const count = findings.length;
      const headline =
        count > 0
          ? `${shipLabel} reviewed the diff and returned ${verdict ?? 'a verdict'} with ` +
            `${count} finding${count === 1 ? '' : 's'}.`
          : `${shipLabel} reviewed the diff and returned ${verdict ?? 'a verdict'} — no findings.`;
      return {
        icon: verdict === 'BLOCK' ? '🛑' : '✅',
        tone: verdict === 'BLOCK' ? 'block' : 'pass',
        headline,
        bodyHtml: renderFindingsHtml(findings),
      };
    }

    case 'review-posted':
      return obj.posted === true
        ? { icon: '📤', tone: 'info', headline: `Posted ${shipLabel}'s review to the pull request.`, bodyHtml: '' }
        : { icon: '🧼', tone: 'pass', headline: `${shipLabel} came back clean — nothing to post.`, bodyHtml: '' };

    case 'ideas-captured':
      return {
        icon: '📥',
        tone: 'info',
        headline: step.title.replace(/^pd-\S+:\s*/, `${shipLabel} captured `),
        bodyHtml: '',
      };

    case 'check-completed': {
      const c = typeof obj.conclusion === 'string' ? obj.conclusion : 'done';
      const reason = typeof obj.reason === 'string' ? ` (${obj.reason})` : '';
      return {
        icon: c === 'failure' ? '🛑' : '🏁',
        tone: c === 'success' ? 'pass' : c === 'failure' ? 'block' : 'neutral',
        headline: `Fleet check concluded: ${c}${reason}.`,
        bodyHtml: '',
      };
    }

    default:
      return { icon: '•', tone: 'info', headline: step.title || step.kind, bodyHtml: '' };
  }
}

/** One rendered `<li>` for a described step, with a collapsed raw-data escape. */
function renderStepLi(view: StepView, offsetSec: number, rawJson: string | null): string {
  const raw = rawJson
    ? `<details class="raw"><summary>raw step data</summary><pre>${esc(rawJson)}</pre></details>`
    : '';
  return `<li class="step tone-${view.tone}">
    <div class="step-head">
      <span class="step-icon">${view.icon}</span>
      <span class="narrative">${esc(view.headline)}</span>
      <span class="t">+${esc(String(offsetSec))}s</span>
    </div>
    ${view.bodyHtml}
    ${raw}
  </li>`;
}

/**
 * Consolidate a run of consecutive MAP-chunk steps into ONE line — "skip through
 * most of this". The English headline states how many chunks were scanned and
 * the total analysis size; the per-chunk breakdown (which preserves each
 * original "MAP chunk i/N" title) is tucked into a collapsed `<details>`.
 */
function renderConsolidatedMap(chunks: FleetRunStepRow[], runStartSec: number): string {
  const first = chunks[0];
  if (!first) return '';
  const n = chunks.length;
  const offset = Math.max(0, first.created_at - runStartSec);
  let total = 0;
  let empties = 0;
  const breakdown = chunks
    .map(c => {
      const o = asObject(parseDetail(c));
      const len = numField(o, 'outputLength');
      if (len != null) total += len;
      const empty = 'responseShape' in o;
      if (empty) empties += 1;
      const lenLabel = len != null ? ` · ${len.toLocaleString('en-US')} chars` : '';
      return `<li>${esc(c.title)}${esc(lenLabel)}${empty ? ' · ⚠ EMPTY (see raw)' : ''}</li>`;
    })
    .join('');

  const size = total ? `, ${total.toLocaleString('en-US')} chars of analysis` : '';
  const headline =
    n === 1
      ? `Scanned the diff in a single pass${total ? ` (${total.toLocaleString('en-US')} chars of analysis)` : ''}.`
      : `Scanned the diff across ${n} chunks${size} — mapped in parallel, then reduced.`;
  const emptyNote = empties > 0 ? ` <span class="meta">(${empties} chunk${empties === 1 ? '' : 's'} returned empty)</span>` : '';

  return `<li class="step tone-info">
    <div class="step-head">
      <span class="step-icon">🗺️</span>
      <span class="narrative">${esc(headline)}${emptyNote}</span>
      <span class="t">+${esc(String(offset))}s</span>
    </div>
    <details class="consolidated"><summary>${esc(n === 1 ? 'Chunk detail' : `Per-chunk breakdown · ${n} steps`)}</summary>
      <ol class="breakdown">${breakdown}</ol>
    </details>
  </li>`;
}

/** A one-line at-a-glance outcome for a ship, from its verdict step. */
function shipOutcome(list: FleetRunStepRow[]): { text: string; tone: StepView['tone'] } | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    if (!s || (s.kind !== 'ship-verdict' && s.kind !== 'ship-finding')) continue;
    if (s.kind === 'ship-finding') return { text: 'errored · unparseable output', tone: 'block' };
    if (/ideation/i.test(s.title)) return { text: 'advisory · ideation', tone: 'neutral' };
    if (asObject(parseDetail(s)).errored === true) return { text: 'errored · fail-closed', tone: 'block' };
    const verdict = verdictFromTitle(s.title);
    const count = extractFindings(parseDetail(s)).length;
    const suffix = count ? `${count} finding${count === 1 ? '' : 's'}` : 'clean';
    return { text: `${verdict ?? 'done'} · ${suffix}`, tone: verdict === 'BLOCK' ? 'block' : 'pass' };
  }
  return null;
}

/** Group transcript steps per ship, preserving order; null ship ⇒ "fleet". */
function renderShips(steps: FleetRunStepRow[], runStartSec: number): string {
  const groups = new Map<string, FleetRunStepRow[]>();
  for (const s of steps) {
    const key = s.ship ?? 'fleet';
    const list = groups.get(key) ?? [];
    list.push(s);
    groups.set(key, list);
  }
  let html = '';
  for (const [ship, list] of groups) {
    const label = ship === 'fleet' ? 'Fleet' : `pd-${ship}`;
    const outcome = ship === 'fleet' ? null : shipOutcome(list);
    const outcomeHtml = outcome ? `<span class="outcome tone-${outcome.tone}">${esc(outcome.text)}</span>` : '';

    const lis: string[] = [];
    for (let i = 0; i < list.length; ) {
      const cur = list[i];
      if (!cur) {
        i += 1;
        continue;
      }
      if (cur.kind === 'map-chunk') {
        let j = i;
        while (j < list.length && list[j]?.kind === 'map-chunk') j += 1;
        lis.push(renderConsolidatedMap(list.slice(i, j), runStartSec));
        i = j;
      } else {
        const offset = Math.max(0, cur.created_at - runStartSec);
        lis.push(renderStepLi(describeStep(cur, label), offset, prettyDetail(cur)));
        i += 1;
      }
    }

    html += `<section class="ship">
      <header>
        <div class="ship-title"><h2>${esc(label)}</h2>${outcomeHtml}</div>
        <span class="meta">${list.length} step${list.length === 1 ? '' : 's'}</span>
      </header>
      <ol class="steps">${lis.join('')}</ol>
    </section>`;
  }
  return html;
}

function renderRunPage(run: FleetRunRow, steps: FleetRunStepRow[]): string {
  const ships = run.ships_csv ? run.ships_csv.split(',') : [];
  const inputTokens = sumDetailField(steps, 'inputTokens');
  const outputTokens = sumDetailField(steps, 'outputTokens');
  // Defense-in-depth: only ever link an https URL (a poisoned row must not
  // become a javascript: href).
  const prLink = /^https:\/\//.test(run.pr_url)
    ? `<a href="${esc(run.pr_url)}">#${esc(run.pr_number)}</a>`
    : `#${esc(run.pr_number)}`;
  const inner = `
    <div class="eyebrow">Port Daddy Fleet — deliberation transcript</div>
    <h1>${esc(run.repo_full_name)} <span class="meta">PR</span> ${prLink}
      <span class="badge ${badgeClass(run.conclusion)}">${esc(run.conclusion || 'pending')}</span></h1>
    <p class="meta">head <code>${esc(run.head_sha.slice(0, 12))}</code>
      · ${esc(fmtUtc(run.created_at))}
      · wall-clock ${esc(fmtMs(run.ms))}
      · ships: ${ships.length ? esc(ships.map(s => `pd-${s}`).join(', ')) : '—'}</p>
    <div class="statgrid">
      <div class="stat"><div class="k">Ships</div><div class="v">${ships.length}</div></div>
      <div class="stat"><div class="k">Transcript steps</div><div class="v">${steps.length}</div></div>
      <div class="stat"><div class="k">Input tokens</div><div class="v">${inputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Output tokens</div><div class="v">${outputTokens.toLocaleString('en-US')}</div></div>
      <div class="stat"><div class="k">Neurons</div><div class="v">${run.neurons == null ? '—' : run.neurons.toLocaleString('en-US')}</div></div>
    </div>
    ${renderShips(steps, run.created_at)}
    <footer>Run <code>${esc(run.id)}</code> · delivery <code>${esc(run.delivery_id)}</code>.
    This is a capability link: anyone holding this exact URL can view the page. Its contents match
    what the fleet posted as PR comments.</footer>`;
  return shell(`${run.repo_full_name} PR #${run.pr_number} — Port Daddy Fleet`, inner);
}

// ── Handler ──────────────────────────────────────────────────────────────────

/** GET /fleet/runs/:id — HTML page. Unauthorized and unknown are the same 404. */
export async function handleFleetRunPage(
  request: Request,
  env: Env,
  runId: string,
): Promise<Response> {
  if (!runId || runId.trim() !== runId || !RUN_ID_RE.test(runId) || runId.includes('..')) {
    return notFoundPage();
  }
  try {
    // Fast path: operator bearer or capability token authorizes without a DB
    // fetch or GitHub round-trip.
    const tokenOk = await hasTokenAuth(request, env, runId);
    const found = await getFleetRunWithSteps(env.DB, runId);
    if (!found) return notFoundPage();

    if (!tokenOk) {
      // Login path (ADR-0101 Phase 1): a signed-in user may open the page iff
      // GitHub says they can read the run's repo. Unauthorized ≙ unknown ≙ 404.
      const session = await resolveSession(request, env);
      if (!session) return notFoundPage();
      const [owner, repo] = (found.run.repo_full_name ?? '').split('/');
      if (!owner || !repo) return notFoundPage();
      if (!(await userCanReadRepo(env, session, owner, repo))) return notFoundPage();
    }

    return htmlResponse(renderRunPage(found.run, found.steps), 200);
  } catch {
    return htmlResponse(
      shell(
        'Error — Port Daddy Fleet',
        `<div class="eyebrow">Port Daddy Fleet</div><h1>Temporarily unavailable</h1>
         <p class="meta">The transcript store could not be read. Try again shortly.</p>`,
      ),
      500,
    );
  }
}
