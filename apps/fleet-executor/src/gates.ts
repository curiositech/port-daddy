/**
 * Deterministic ship gating — the biggest cost lever, at zero model risk.
 *
 * Most fleet cost is AI spend on ships that had nothing to say. The ship prompts
 * already declare surface gates in prose ("red-team: only if the diff touches
 * auth/crypto/…"; "tautology-sniffer: only if it touches test files") — but the
 * cloud executor still ran the FULL map-reduce to discover the gate was closed,
 * paying for every chunk. This module moves those gates into CODE: a ship whose
 * surface the diff doesn't touch is skipped BEFORE any `ai.run`, spending nothing.
 *
 * Class-aware docs-only routing (operator directive, 2026-07-07): a docs-only
 * diff (planning / thought-generation prose, NOT inline code documentation) has
 * nothing for the reviewer ships to review — but it is exactly where the IDEATION
 * ships (spark/spider/lookout/snipe) should run. So reviewers skip docs-only;
 * ideation runs on it.
 */

import type { ShipConfig } from './fleet.js';
import { decideShipParticipation, type PullRequestProfile } from '../../shared/fleet-participation.js';

/** A path is prose/docs (not code) — `.md`/`.mdx`, or anything under `docs/`. */
const PROSE_PATH_RE = /(\.mdx?$)|(^|\/)docs\//i;

/** Any code-ish source file — used to reject "docs-only" when real code changed. */
const CODE_PATH_RE = /\.(ts|tsx|js|jsx|mjs|cjs|rs|swift|go|py|rb|java|kt|c|h|cpp|sh|sql|toml|ya?ml|json)$/i;

/**
 * red-team's security surface (path-based; contents aren't cheaply inspectable
 * in the Worker, so err toward running on any security-looking path). Mirrors the
 * gate enumerated in red-team's prompt.
 */
const SECURITY_SURFACE_RE =
  /(lib\/(auth|capabilities|secret-env|bonds|cost-tracker|arbiter|file-claims|salvage|note-encryption))|(routes\/(auth|bonds))|(crypto|sign|verify|hash|token|secret|auth|capabilit|key|vault|wrap|hpke)/i;

const CI_RE = /(^|\/)(\.github\/workflows|ci|scripts)\/|Dockerfile|wrangler\.toml/i;
const DEPENDENCY_RE = /(^|\/)(package\.json|Cargo\.toml|pyproject\.toml|go\.mod)$/i;
const UI_RE = /\.(tsx|jsx|html|css|scss|swift)$|(^|\/)(website|website-v2|ui|views)\//i;
const DATA_RE = /\.(sql)$|(^|\/)(migrations|schemas?)\//i;

/** Deterministic, provider-neutral PR profile consumed by every ship policy. */
export function classifyPullRequest(
  changedPaths: string[],
  diffBytes = 0,
  diffText = '',
): PullRequestProfile {
  const has = (re: RegExp) => changedPaths.some(path => re.test(path));
  // Bound classification work and inspect only changed lines. This is safety
  // routing evidence, not semantic retrieval or a model-authored decision.
  const changedContent = diffText.slice(0, 200_000).split('\n')
    .filter(line => /^[+-](?!\+\+\+|---)/.test(line)).join('\n');
  const contentHas = (re: RegExp) => re.test(changedContent);
  const prClass = isDocsOnly(changedPaths) ? 'documentation'
    : has(DEPENDENCY_RE) ? 'dependencies'
      : has(SECURITY_SURFACE_RE) ? 'security'
        : has(CI_RE) ? 'ci'
          : has(DATA_RE) ? 'data'
            : has(UI_RE) ? 'ui'
              : changedPaths.length ? 'code' : 'unknown';
  const riskSignals: PullRequestProfile['riskSignals'] = [];
  if (has(/authenticat|login|oauth|oidc|session/i) || contentHas(/\b(authenticate|authentication|login|oauth|oidc|jwt|password)\b/i)) riskSignals.push('authentication');
  if (has(/authoriz|permission|capabilit|policy|grant/i) || contentHas(/\b(authorize|authorization|permission|capability|access[_-]?control|role[_-]?binding)\b/i)) riskSignals.push('authorization');
  if (has(/secret|token|credential|vault|keychain/i) || contentHas(/\b(secret|credential|api[_-]?key|private[_-]?key|access[_-]?token)\b/i)) riskSignals.push('secrets');
  if (has(/crypto|encrypt|decrypt|sign|verify|hash|hpke/i)) riskSignals.push('cryptography');
  if (has(/bill|cost|spend|credit|ledger|price/i) || contentHas(/\b(billing|invoice|charge|price|cost[_-]?microusd|spend[_-]?cap|credit[_-]?balance)\b/i)) riskSignals.push('billing');
  if (has(/tenant|account|installation|repository.*scope/i) || contentHas(/\b(tenant[_-]?id|account[_-]?id|installation[_-]?id|repository[_-]?id|cross[_-]?tenant)\b/i)) riskSignals.push('tenant-boundary');
  if (has(/migration|\.sql$/i) || contentHas(/\b(ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+TABLE|schema[_-]?migration)\b/i)) riskSignals.push('schema-migration');
  if (has(/deploy|workflow|wrangler|Dockerfile/i)) riskSignals.push('deployment');
  if (changedPaths.some(path => !isReviewableForBugs(path))) riskSignals.push('generated-code');
  if (has(/privacy|retention|redact|disclosure/i) || contentHas(/\b(privacy|retention|redact(?:ion)?|personally[_ -]?identifiable|disclosure)\b/i)) riskSignals.push('privacy');
  if (has(/database|storage|sqlite|d1|r2|kv|persist/i) || contentHas(/\b(database|sqlite|durable[_ -]?object|object[_ -]?storage|persist(?:ence|ed)?|\bD1\b|\bR2\b|\bKV\b)\b/i)) riskSignals.push('storage');
  if (diffBytes > 250_000 || changedPaths.length > 100) riskSignals.push('large-diff');
  if (prClass === 'code' && riskSignals.length === 0) riskSignals.push('security-uncertain');
  return { prClass, riskSignals: [...new Set(riskSignals)] };
}

/**
 * A docs-only diff = at least one changed path, every path is prose, and NO code
 * file changed. `AGENTS.md`, `docs/plans/foo.md`, `fleet/ships/spider.md` → true;
 * anything touching a `.ts`/`.rs`/… → false (that's a code change with docs, not
 * a docs-only diff).
 */
export function isDocsOnly(changedPaths: string[]): boolean {
  if (changedPaths.length === 0) return false;
  if (changedPaths.some(p => CODE_PATH_RE.test(p))) return false;
  return changedPaths.every(p => PROSE_PATH_RE.test(p));
}

/**
 * Files whose diffs cannot carry a reviewable defect.
 *
 * These are machine-authored or machine-derived: nobody wrote the bug, and no
 * reviewer can act on the hunk. They are, however, frequently the LARGEST
 * entries in a diff — a lockfile refresh or a regenerated snapshot dwarfs the
 * hand-written change it accompanies.
 *
 * Excluding them before chunking is the cheapest possible saving in this
 * pipeline. Review is map-reduce with one model call per 12k-char chunk, so
 * every chunk of regenerated JSON is a call spent producing findings about
 * output no human controls — and worse, it displaces real code into further
 * chunks, which is what makes a reviewer's view of the actual change partial in
 * the first place.
 */
const UNREVIEWABLE_PATH_RE = new RegExp(
  [
    // dependency lockfiles
    '(^|/)(package-lock\\.json|pnpm-lock\\.yaml|yarn\\.lock|Cargo\\.lock|poetry\\.lock|go\\.sum|Gemfile\\.lock)$',
    // generated / derived artifacts
    '(^|/)(dist|build|out|coverage|vendor|node_modules|target)/',
    '(^|/)docs/artifacts/',
    // Terminal recordings are evidence, not authored program source. Their
    // semantic checks live beside the recorder; feeding raw ANSI streams to a
    // reviewer both wastes the context window and makes its view less useful.
    '\\.cast$',
    '\\.(min\\.(js|css)|map|snap)$',
    '(^|/)__snapshots__/',
    '\\.snapshot\\.json$',
    // binary-ish assets a text reviewer cannot reason about
    '\\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|eot|mp4|mov|zip|gz|wasm)$',
  ].join('|'),
  'i',
);

/**
 * Whether a changed file's diff is worth spending a review call on.
 *
 * Conservative by construction: anything not positively recognised as generated
 * is reviewable. A false negative here silently hides real code from review,
 * which is far worse than the tokens a false positive costs.
 */
export function isReviewableForBugs(path: string): boolean {
  return !UNREVIEWABLE_PATH_RE.test(path);
}

export interface GateDecision {
  run: boolean;
  disposition?: 'required' | 'advisory' | 'abstain' | 'ineligible';
  /** Why the ship was skipped (for the transcript). Absent when it runs. */
  reason?: string;
}

/**
 * Decide whether a ship should run against this diff, BEFORE any AI spend.
 * The trusted participation policy, not the ship name, owns relevance and vote
 * authority. An incomplete changed-file inventory is conservatively promoted to
 * the strongest runnable disposition declared by that policy.
 */
export function decideShipGate(
  ship: ShipConfig,
  changedPaths: string[],
  _docsOnly: boolean,
  diffBytes = 0,
  inventoryIncomplete = false,
  diffText = '',
): GateDecision {
  if (!ship.participationValid) {
    return { run: false, disposition: 'ineligible', reason: 'invalid or unauthorized participation policy' };
  }
  const decision = decideShipParticipation(ship.participation, classifyPullRequest(changedPaths, diffBytes, diffText));
  if (inventoryIncomplete && decision.disposition !== 'required' && decision.disposition !== 'advisory') {
    const declared = [ship.participation.default, ...ship.participation.rules.map(rule => rule.disposition)];
    const conservative = declared.includes('required') ? 'required'
      : declared.includes('advisory') ? 'advisory' : decision.disposition;
    return {
      run: conservative === 'required' || conservative === 'advisory',
      disposition: conservative,
      reason: `changed-file inventory incomplete; conservative ${conservative} participation`,
    };
  }
  return {
    run: decision.disposition === 'required' || decision.disposition === 'advisory',
    disposition: decision.disposition,
    reason: decision.reason,
  };
}
