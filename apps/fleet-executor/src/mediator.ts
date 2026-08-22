/**
 * MEDIATOR — symbol-level conflict prediction across open PR pairs
 * (grand-plan DAG node mediator-body, executor half; plan §X4 second half).
 *
 * WHAT RUNS WHERE. Prediction runs HERE, in the executor, after a PR run
 * concludes: the delivered PR is compared against the repo's other open PRs
 * (recency-prioritized, ≤{@link MEDIATOR_MAX_PAIRS} pairs), a deterministic
 * symbol extractor pulls the CHANGED SYMBOLS out of each PR's unified diffs,
 * and an overlap score becomes a confidence. At or above the
 * {@link MEDIATOR_CONFIDENCE_FLOOR} the executor (1) posts a NEUTRAL check
 * run on both PR heads — a prediction informs, it never blocks — and
 * (2) reports the prediction to the relay's POST /v1/mediator/convene as a
 * SIGNED, CHAINED event under its N2 harbor card (src/squid-events.ts
 * publishChainedEvent — awaited, never fire-and-forget), which convenes the
 * parley between the two authors and issues the delivery-acknowledged
 * summonses. One open parley per pair is the RELAY's invariant; the executor
 * simply reports and lets the relay dedupe (200 existing=true).
 *
 * ── THE SYMBOL EXTRACTOR, AND WHAT IT IS NOT ────────────────────────────────
 * The plan sketches tree-sitter inside the executor container. What ships
 * here is a DETERMINISTIC DIFF-SYMBOL EXTRACTOR: it parses unified-diff
 * structure (hunk headers, whose context GitHub populates with the enclosing
 * declaration) plus declaration-shaped changed lines across the languages
 * this fleet actually reviews (TS/JS, Python, Go, Rust). That is genuinely
 * symbol-level — two PRs collide when they touch the SAME declaration in the
 * SAME file, not merely the same file — while being pure, testable, and
 * runnable in the Worker isolate with no container round-trip. Tree-sitter
 * in the sandbox container is a NAMED follow-up (it buys resolution inside
 * unlabeled hunks), not silently skipped: this header is the boundary marker.
 * The extractor is deliberately conservative — a missed symbol costs a missed
 * prediction (the merge conflict still surfaces the old way); an invented one
 * would summon two humans to a phantom dispute.
 *
 * ── SCORING (fixed, inspectable, no model) ──────────────────────────────────
 *   shared (file, symbol) pairs  n ≥ 1  → confidence = min(0.7 + 0.1·(n−1), 0.95)
 *   shared files, no shared symbol      → 0.4   (below the floor: signal, not summons)
 *   disjoint files                      → 0.0
 * One shared symbol lands EXACTLY on the 0.7 floor — the plan's threshold is
 * the smallest real collision, not a tuned constant. No AI call is involved:
 * a prediction that convenes humans must be explainable by pointing at the
 * overlapping declarations, and a deterministic score is auditable in a way
 * "the model felt 0.73" is not.
 *
 * ── GATES (all fail closed to inert) ────────────────────────────────────────
 *   1. tenant consent: `mediator.enabled: true` + a harbor in pd-fleet.yml
 *      (trusted default branch; parseFleetMediator);
 *   2. the `kill-mediator` flag (fleet:kill-mediator in the shared
 *      control-plane KV): set ⇒ ZERO GitHub calls, ZERO relay calls, zero
 *      everything — the kill-flag test pins this;
 *   3. the executor's N2 identity env (missing ⇒ prediction may still be
 *      computed but nothing can be reported; the scan declines to run).
 *
 * The scan NEVER throws and NEVER changes the run's verdict — it executes
 * after the check run has already concluded, exactly like squid telemetry.
 */

import type { ExecutorEnv } from './env.js';
import { type FleetMediatorConfig } from './fleet.js';
import { publishChainedEvent, type ChainedPublishResult, type SquidEnv } from './squid-events.js';
import type { OpenPRDetailed } from './github.js';

// ── Policy constants ─────────────────────────────────────────────────────────

/** Auto-convene floor (plan §X4). The relay enforces it too — fail closed twice. */
export const MEDIATOR_CONFIDENCE_FLOOR = 0.7;

/** Pair cap per scan (plan §X4: "capped, recency-prioritized, ≤50 pairs"). */
export const MEDIATOR_MAX_PAIRS = 50;

/** The kill flag's KV key — MUST equal the relay's KILL_MEDIATOR_KEY. */
export const KILL_MEDIATOR_KEY = 'fleet:kill-mediator';

/** Name on the neutral check runs the mediator posts. */
export const MEDIATOR_CHECK_NAME = 'Port Daddy Mediator';

/** Cap on symbols quoted into a convene event (evidence, not a dump). */
const MAX_REPORTED_SYMBOLS = 50;

// ── Symbol extraction (deterministic, from unified diffs) ────────────────────

/** One changed symbol: the (file, declaration) unit predictions are made of. */
export interface SymbolRef {
  file: string;
  symbol: string;
}

/**
 * Declaration shapes per language family. Each regex must capture the symbol
 * NAME in group 1 and must anchor on declaration syntax — a call site or a
 * mention inside a string must not match. Conservative on purpose (see the
 * module header: a phantom symbol summons real humans).
 */
const DECLARATION_PATTERNS: RegExp[] = [
  // TS/JS: function declarations (incl. export/async/generator).
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/,
  // TS/JS: class / interface / enum / type alias declarations.
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+([A-Za-z_$][\w$]*)/,
  /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
  // TS/JS: const/let/var bound to a function or arrow (the common module fn).
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?function\b/,
  // Python: def / async def / class.
  /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  /^class\s+([A-Za-z_]\w*)\s*[(:]/,
  // Go: func Name( and func (recv T) Name(.
  /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(/,
  // Rust: fn / struct / enum / trait (incl. pub(...) and async/unsafe fn).
  /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+|unsafe\s+)*fn\s+([A-Za-z_]\w*)/,
  /^(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
];

/**
 * The enclosing-declaration context git writes into a hunk header:
 * `@@ -a,b +c,d @@ <context>`. The context is the nearest preceding function
 * signature — exactly the "which symbol does this hunk edit?" answer for
 * changes INSIDE a declaration body, which pure added/removed-line matching
 * would miss entirely.
 */
const HUNK_HEADER = /^@@[^@]*@@ ?(.*)$/;

/** Pull a symbol name out of a hunk header's context text, if it has one. */
function symbolFromHunkContext(context: string): string | null {
  const text = context.trim();
  if (text === '') return null;
  for (const re of DECLARATION_PATTERNS) {
    const m = re.exec(text);
    if (m?.[1]) return m[1];
  }
  // Common non-declaration contexts git emits (e.g. a class body line, an
  // object literal) — a "name(" shape at the start is a method signature.
  const method = /^([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]?/.exec(text);
  if (method?.[1] && !/^(if|for|while|switch|return|catch)$/.test(method[1])) return method[1];
  return null;
}

/**
 * Extract the CHANGED SYMBOLS from one PR's file patches.
 *
 * Two sources, both structural:
 *   1. hunk-header context — the enclosing declaration of an in-body edit;
 *   2. added/removed lines that ARE declarations — a new, deleted, or
 *      re-signatured symbol.
 * Context lines (leading space) contribute nothing: being NEAR a change is
 * not being changed, and counting them would manufacture overlap.
 *
 * @param files The PR's files with unified-diff patches (patch may be absent
 *        for binary/huge files — those contribute no symbols).
 * @returns Deduped (file, symbol) refs in first-seen order.
 */
export function extractChangedSymbols(
  files: Array<{ filename: string; patch?: string }>,
): SymbolRef[] {
  const seen = new Set<string>();
  const out: SymbolRef[] = [];
  const add = (file: string, symbol: string) => {
    const key = `${file}\u0000${symbol}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ file, symbol });
    }
  };

  for (const f of files) {
    if (!f.patch) continue;
    for (const rawLine of f.patch.split('\n')) {
      const hunk = HUNK_HEADER.exec(rawLine);
      if (hunk) {
        const sym = symbolFromHunkContext(hunk[1] ?? '');
        if (sym) add(f.filename, sym);
        continue;
      }
      // Only ADDED/REMOVED lines count as changes. Skip the +++/--- file
      // header lines, whose leading characters would false-positive.
      if (!/^[+-]/.test(rawLine) || rawLine.startsWith('+++') || rawLine.startsWith('---')) continue;
      const code = rawLine.slice(1).trimStart();
      for (const re of DECLARATION_PATTERNS) {
        const m = re.exec(code);
        if (m?.[1]) {
          add(f.filename, m[1]);
          break;
        }
      }
    }
  }
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

/** One scored PR pair. */
export interface ConflictScore {
  confidence: number;
  /** The shared (file, symbol) pairs — the evidence a human can point at. */
  overlapping: SymbolRef[];
  /** Files touched by both PRs (with or without a shared symbol). */
  sharedFiles: string[];
}

/**
 * Score the collision between two PRs' changed-symbol sets. Deterministic —
 * see the module header for the exact function and why one shared symbol
 * lands exactly on the floor.
 */
export function scoreConflict(a: SymbolRef[], b: SymbolRef[]): ConflictScore {
  const bKeys = new Set(b.map((s) => `${s.file}\u0000${s.symbol}`));
  const overlapping = a.filter((s) => bKeys.has(`${s.file}\u0000${s.symbol}`));

  const aFiles = new Set(a.map((s) => s.file));
  const bFiles = new Set(b.map((s) => s.file));
  const sharedFiles = [...aFiles].filter((f) => bFiles.has(f));

  let confidence = 0;
  if (overlapping.length > 0) {
    confidence = Math.min(MEDIATOR_CONFIDENCE_FLOOR + 0.1 * (overlapping.length - 1), 0.95);
  } else if (sharedFiles.length > 0) {
    confidence = 0.4;
  }
  return { confidence, overlapping, sharedFiles };
}

// ── Pair selection ───────────────────────────────────────────────────────────

/**
 * Choose which other PRs the delivered PR is compared against: non-draft,
 * different number, in the recency order the API already returns
 * (updated desc), capped at {@link MEDIATOR_MAX_PAIRS} pairs. Draft PRs are
 * skipped — a draft's author has explicitly said "not yet", and summoning
 * them to defend unfinished work is parley fatigue by design.
 */
export function selectCandidatePairs(
  deliveredPr: number,
  openPrs: OpenPRDetailed[],
): OpenPRDetailed[] {
  return openPrs
    .filter((p) => p.number !== deliveredPr && !p.draft)
    .slice(0, MEDIATOR_MAX_PAIRS);
}

// ── Kill flag ────────────────────────────────────────────────────────────────

/**
 * Read the `kill-mediator` flag from the shared control-plane KV — the same
 * namespace and the same tolerant shapes as the fleet pause flag. Absent
 * binding or unreadable value ⇒ NOT killed for the pause flag, but note the
 * asymmetry chosen here: the mediator is a CONVENER of humans, so an
 * unreadable flag reads as KILLED (fail inert), the opposite of the review
 * gate's fail-running. Wrongly skipping a prediction costs a prediction;
 * wrongly summoning people against an operator's kill order costs trust.
 */
export async function isMediatorKilled(env: Pick<ExecutorEnv, 'CONTROL_KV'>): Promise<boolean> {
  const kv = env.CONTROL_KV;
  if (!kv) return false; // no control plane at all (unit tests): flag cannot exist
  try {
    const raw = await kv.get(KILL_MEDIATOR_KEY);
    if (!raw) return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    try {
      const parsed = JSON.parse(raw) as { killed?: boolean };
      return parsed.killed === true;
    } catch {
      return true; // unparseable kill flag: fail INERT (see docstring)
    }
  } catch {
    return true; // unreadable KV on a kill check: fail INERT
  }
}

// ── Re-injection consumption (the Modify gate's handoff) ─────────────────────

/** The gate's Modify payload, as the relay wrote it (db.ts MediatorReinjection). */
export interface MediatorReinjection {
  parleyId: string;
  repo: string;
  pr: number;
  action: string;
  modifyText: string;
  decidedBy: string;
  at: number;
}

/**
 * Consume (read-and-delete) a pending Modify re-injection for this PR.
 *
 * CONSUME-ONCE: the delete happens immediately after a successful read so a
 * retried delivery does not re-inject stale orders forever — the durable
 * record stays in the relay's parley_gates row (modify_text), which is the
 * artifact; this KV key is only the handoff. Best-effort: any KV failure
 * returns null and the run proceeds exactly as if no verdict existed.
 */
export async function consumeMediatorReinjection(
  env: Pick<ExecutorEnv, 'CONTROL_KV'>,
  repo: string,
  pr: number,
): Promise<MediatorReinjection | null> {
  const kv = env.CONTROL_KV;
  if (!kv) return null;
  const key = `mediator:reinjection:${repo}:${pr}`;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MediatorReinjection;
    if (typeof parsed.modifyText !== 'string' || parsed.modifyText.trim() === '') return null;
    await kv.delete(key);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Render a consumed re-injection as the MEDIATOR ORDERS context block every
 * ship on the re-execution sees. The human's words are quoted verbatim
 * (models get the instruction as written, not a paraphrase) inside a clearly
 * labeled frame so a transcript reader can see exactly what was injected.
 */
export function renderMediatorOrders(r: MediatorReinjection): string {
  return [
    '## MEDIATOR ORDERS (human gate verdict: MODIFY)',
    '',
    `A human party (${r.decidedBy}) reviewed the predicted conflict behind parley ${r.parleyId}`,
    `and chose MODIFY for the gated ${r.action}. This PR is the losing side and is being`,
    're-executed with the following instructions, which take precedence over the default approach:',
    '',
    `> ${r.modifyText.split('\n').join('\n> ')}`,
    '',
  ].join('\n');
}

// ── The scan ─────────────────────────────────────────────────────────────────

/** What one pair produced (for the transcript and the tests). */
export interface PairPrediction {
  otherPr: number;
  confidence: number;
  overlapping: SymbolRef[];
  /** Whether ≥ floor (check run + convene attempted). */
  fired: boolean;
  /** The relay's answer to the convene, when one was attempted. */
  convene: ChainedPublishResult | null;
}

/** The scan's honest overall report. */
export interface MediatorScanReport {
  ran: boolean;
  /** Why the scan did not run, when it did not. */
  reason:
    | 'disabled'
    | 'no-harbor'
    | 'kill-mediator'
    | 'no-identity'
    | 'delivered-pr-not-found'
    | null;
  pairsConsidered: number;
  predictions: PairPrediction[];
}

/** The I/O the scan needs, injected so the gates are testable hermetically. */
export interface MediatorScanIo {
  /** Open PRs, recency-ordered (github.ts fetchOpenPullRequestsDetailed). */
  listOpenPrs(): Promise<OpenPRDetailed[]>;
  /** One PR's file patches (github.ts fetchPRFilePatches). */
  fetchPatches(prNumber: number): Promise<Array<{ filename: string; patch?: string }>>;
  /** Post one completed NEUTRAL check run (create + complete, github.ts). */
  postNeutralCheck(headSha: string, summary: string): Promise<void>;
  /** The awaited chained publish to /v1/mediator/convene (squid-events.ts). */
  publishConvene(channelSuffix: string, body: unknown): Promise<ChainedPublishResult>;
}

/**
 * Run one mediator scan for a just-reviewed PR against the repo's other open
 * PRs. See the module header for the full behavior; the gate ORDER here is
 * the tested contract:
 *
 *   consent → kill flag → identity → data.
 *
 * The kill check runs BEFORE any {@link MediatorScanIo} call, so a flagged
 * mediator performs zero GitHub and zero relay traffic (the kill-flag test
 * counts the calls). Never throws; every failure shows up in the report.
 *
 * @param env Executor env (kill-flag KV + N2 identity presence check).
 * @param args The delivered PR, tenant config, and injected I/O.
 * @returns The honest scan report; the RUN it followed is unaffected.
 */
export async function runMediatorScan(
  env: Pick<ExecutorEnv, 'CONTROL_KV' | 'RELAY_PUBLISH_URL' | 'FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX' | 'FLEET_EXECUTOR_HARBOR_CARD'>,
  args: {
    repo: string; // 'owner/name'
    deliveredPr: number;
    config: FleetMediatorConfig;
    io: MediatorScanIo;
  },
): Promise<MediatorScanReport> {
  const report: MediatorScanReport = { ran: false, reason: null, pairsConsidered: 0, predictions: [] };
  try {
    if (!args.config.enabled) {
      report.reason = 'disabled';
      return report;
    }
    if (!args.config.harbor) {
      report.reason = 'no-harbor';
      return report;
    }
    if (await isMediatorKilled(env)) {
      report.reason = 'kill-mediator';
      return report;
    }
    if (
      !env.RELAY_PUBLISH_URL ||
      !env.FLEET_EXECUTOR_ED25519_PRIVATE_KEY_HEX ||
      !env.FLEET_EXECUTOR_HARBOR_CARD
    ) {
      report.reason = 'no-identity';
      return report;
    }

    const openPrs = await args.io.listOpenPrs();
    const delivered = openPrs.find((p) => p.number === args.deliveredPr);
    if (!delivered) {
      // Without the delivered PR's createdAt there is no honest claim order.
      report.reason = 'delivered-pr-not-found';
      return report;
    }
    const candidates = selectCandidatePairs(args.deliveredPr, openPrs);
    report.pairsConsidered = candidates.length;
    if (candidates.length === 0) {
      report.ran = true;
      return report;
    }

    const deliveredSymbols = extractChangedSymbols(await args.io.fetchPatches(delivered.number));
    for (const other of candidates) {
      const otherSymbols = extractChangedSymbols(await args.io.fetchPatches(other.number));
      const score = scoreConflict(deliveredSymbols, otherSymbols);
      const fired = score.confidence >= MEDIATOR_CONFIDENCE_FLOOR;
      const prediction: PairPrediction = {
        otherPr: other.number,
        confidence: score.confidence,
        overlapping: score.overlapping,
        fired,
        convene: null,
      };
      report.predictions.push(prediction);
      if (!fired) continue;

      const evidence = score.overlapping
        .slice(0, 5)
        .map((s) => `${s.file}:${s.symbol}`)
        .join(', ');
      const summary =
        `Predicted symbol collision with PR #${other.number} at confidence ` +
        `${score.confidence.toFixed(2)}: ${evidence}` +
        `${score.overlapping.length > 5 ? ` and ${score.overlapping.length - 5} more` : ''}. ` +
        `This check is NEUTRAL by design — a prediction informs, it never blocks. ` +
        `A parley between the two authors is being convened on the relay.`;
      // Neutral check runs on BOTH heads: both authors should see the same
      // prediction from their own PR. Best-effort each.
      await args.io.postNeutralCheck(delivered.headSha, summary);
      await args.io.postNeutralCheck(
        other.headSha,
        summary.replace(`PR #${other.number}`, `PR #${delivered.number}`),
      );

      const pairKey = [delivered.number, other.number].sort((x, y) => x - y).join('-');
      prediction.convene = await args.io.publishConvene(
        `mediator:${args.repo.replace('/', '-')}:${pairKey}`,
        {
          schema: 'mediator/1',
          type: 'convene',
          harbor: args.config.harbor,
          repo: args.repo,
          prA: { number: delivered.number, author: delivered.author, createdAt: delivered.createdAt },
          prB: { number: other.number, author: other.author, createdAt: other.createdAt },
          symbols: score.overlapping.slice(0, MAX_REPORTED_SYMBOLS),
          confidence: score.confidence,
          ...(args.config.action ? { action: args.config.action } : {}),
          ...(Object.keys(args.config.daemons).length > 0 ? { daemons: args.config.daemons } : {}),
        },
      );
    }
    report.ran = true;
    return report;
  } catch {
    // The scan must never disturb the concluded run.
    return report;
  }
}

/**
 * The production {@link MediatorScanIo}, over the real GitHub + relay
 * transports. Kept as a builder so execute.ts stays a one-line call site and
 * the scan itself remains hermetically testable.
 */
export function buildMediatorScanIo(deps: {
  env: SquidEnv;
  owner: string;
  repo: string;
  token: string;
  listOpenPrs: (owner: string, repo: string, token: string) => Promise<OpenPRDetailed[]>;
  fetchPatches: (
    owner: string,
    repo: string,
    prNumber: number,
    token: string,
  ) => Promise<Array<{ filename: string; patch?: string }>>;
  createCheckRun: (
    owner: string,
    repo: string,
    name: string,
    headSha: string,
    token: string,
  ) => Promise<number>;
  completeCheckRun: (
    owner: string,
    repo: string,
    checkRunId: number,
    conclusion: 'success' | 'failure' | 'neutral',
    summary: string,
    token: string,
  ) => Promise<void>;
}): MediatorScanIo {
  const conveneUrl = (deps.env.RELAY_PUBLISH_URL ?? '').replace(
    /\/v1\/publish$/,
    '/v1/mediator/convene',
  );
  return {
    listOpenPrs: () => deps.listOpenPrs(deps.owner, deps.repo, deps.token),
    fetchPatches: (prNumber) => deps.fetchPatches(deps.owner, deps.repo, prNumber, deps.token),
    postNeutralCheck: async (headSha, summary) => {
      if (!headSha) return;
      const id = await deps.createCheckRun(deps.owner, deps.repo, MEDIATOR_CHECK_NAME, headSha, deps.token);
      if (id) await deps.completeCheckRun(deps.owner, deps.repo, id, 'neutral', summary, deps.token);
    },
    publishConvene: (channelSuffix, body) =>
      publishChainedEvent(deps.env, channelSuffix, body, conveneUrl),
  };
}
