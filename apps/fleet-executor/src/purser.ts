/**
 * The PURSER — an adversarial, obstreperous gatekeeper ship.
 *
 * Where the reviewer ships critique the diff as written, the purser holds the
 * PR to the STRONGEST interpretation of what it claims to do:
 *
 *   a. STEEL-MAN — one AI call over the PR title/body/diff produces the
 *      best-interpretation contract: purpose + testable obligations[] +
 *      testTargets[]. The parsed contract is then UPSERTED INTO THE REVIEWED
 *      PR'S BODY (operator mandate, 2026-08-19: the steel-man argument and its
 *      obligations are the best chronology of what a PR should be, and the PR
 *      summary is where that chronology lives — maintained by this agent,
 *      edit-in-place between HTML markers). Malformed output ⇒ transcript
 *      error and a BROKEN-SHIP result (`errored: true`, which fails the run —
 *      see the doctrine note below); the purser never bluffs a contract.
 *   b. AUTHOR TESTS — a second AI call authors adversarial unit + integration
 *      test files that grill the contract's edge cases. Files are validated by
 *      the stacked-pr path whitelist + size caps (model output is untrusted),
 *      then by the EXECUTABILITY GATE (src/purser-executability.ts, fail
 *      closed): every authored path must live inside the repo's OWN,
 *      evidence-fetched jest `testMatch` (never just an operator-declared
 *      `testPaths` prefix), and every relative import must resolve to a real
 *      file. Unknown/unfetchable evidence is a REJECTION, not a pass. A
 *      rejection here preserves the steel-man contract + authored tests as
 *      evidence in a comment (never fabricated as executed), stops BEFORE
 *      touching the Git Data API — no branch, no test PR, no retarget — and
 *      returns a BROKEN-SHIP result so the run fails until the authoring or
 *      config defect is fixed. (Root-caused by #5860: five tests lived outside the repo's
 *      configured jest discovery path and imported a nonexistent module; the
 *      purser retargeted the reviewed PR onto them anyway.)
 *   c. SANDBOX (feature-flagged) — when env.SANDBOX exists, the repo's test
 *      runner executes the new tests against the PR head in a Cloudflare
 *      Sandbox. Absent binding ⇒ executed:false, NEVER fabricated results.
 *   d. STACK — branch `purser/pr-<n>-tests` is cut from the PR's BASE sha and
 *      a test PR is opened for it. The reviewed PR is RETARGETED onto the
 *      test branch — so it sits stacked on top of the tests and must satisfy
 *      them — ONLY when it is same-repo (not a fork) AND `sandbox.executed`
 *      is true: retargeting onto tests that were merely authored but never
 *      run hides the true origin/main diff and shrinks normal CI for no
 *      verified benefit (the other half of #5860 — "the body admitted they
 *      were not run"). Fork PRs, and same-repo PRs whose tests did not
 *      execute, get the test PR + a comment explaining why NOT retargeted,
 *      but the implementation PR's base is left untouched. A 403 (App lacks
 *      `contents: write`) degrades honestly — tests are posted inline in a
 *      comment and the missing permission is named + escalated — but it is
 *      still a BROKEN-SHIP result: the run fails until the permission lands.
 *   e. VERDICT — blocking iff pd-fleet.yml says `blocking: true`. BLOCK while
 *      sandbox-executed tests fail on the PR head. Sandbox unavailable ⇒ the
 *      `blockWithoutSandbox` flag decides (default false ⇒ advisory): the
 *      purser never blocks on tests that were never run unless the operator
 *      explicitly opted into fail-closed. (This governs the ship's PASS/BLOCK
 *      merge-gate verdict; RETARGETING is a separate, stricter action — see d.)
 *
 * Comment tone: firm, adversarial, professional. Demands, with reasons.
 * Never abusive.
 *
 * THE BROKEN-SHIP DOCTRINE (operator ruling, 2026-08-19; see verdict.ts
 * `aggregateConclusion`). The purser used to degrade every machinery failure —
 * malformed steel-man, malformed plan, failed authoring, rejected or
 * non-executable tests, a 403 on the stack, an outright crash — to an ADVISORY
 * PASS "so it never blocks on work it could not do". The observable result:
 * the purser authored tests into a directory the repo's own test runner would
 * never discover, stacked nothing, and the run stayed green. That is a broken
 * ship sailing past the gate it exists to keep. Machinery failures now return
 * `errored: true` under the ship's REAL blocking flag, which fails the run —
 * the breakage gets fixed in the diff that surfaced it. The ONE deliberate
 * exception is sandbox ABSENCE on well-formed, executable, stacked tests:
 * that is a configured deployment state (`blockWithoutSandbox` decides it),
 * not a breakage.
 */

import type { ExecutorEnv } from './env.js';
import type { ShipConfig } from './fleet.js';
import type { ShipResult, Verdict } from './verdict.js';
import {
  postShipComment,
  upsertPrBodySection,
  PullRequestHeadValidationError,
  type PRContext,
  type PullRequestHeadGuard,
} from './github.js';
import { extractAiText, describeResponseShape } from './ai-response.js';
import { extractWorkersAiUsage } from './telemetry.js';
import { stripThinkSpans } from './xo.js';
import {
  createOrUpdateBranch,
  fetchRepoFileText,
  fetchRepoTreePaths,
  findOpenPrForBranch,
  openStackedPr,
  readBranchFiles,
  retargetPrBase,
  validateStackedFiles,
  GitHubApiError,
  type StackedFile,
  type StackedPrResult,
} from './stacked-pr.js';
import {
  checkGeneratedTestsExecutable,
  extractJestTestMatch,
  extractPackageJsonTestMatch,
  extractPackageTypeModule,
  JEST_CONFIG_CANDIDATES,
  matchesAnyTestMatch,
  repairMisrootedRelativeImport,
  type ExecutabilityEvidence,
  type ExecutabilityResult,
} from './purser-executability.js';
import {
  decideRerun,
  decodeFingerprint,
  encodeFingerprint,
  fingerprintDiff,
  withAuthoredTests,
} from './purser-rerun.js';
import {
  runTestsInSandbox,
  MAX_NAMED_FAILURES,
  type SandboxRunOutcome,
} from './sandbox-runner.js';
import {
  authorTestFiles,
  parseTestPlan,
  MAX_PLANNED_FILES,
  type AuthorFailure,
  type PlannedFile,
} from './purser-authoring.js';
import { fleetPrBodyTrailers } from './fleet-pr-body.js';
import { repairContractOutput, REPAIR_ESCALATION_MODEL } from './repair.js';
import { emitSquidEvent } from './squid-events.js';
import { emitInterruption } from './interruptions.js';
import {
  FleetAiCircuit,
  FleetAiDependencyError,
  PROVIDER_MAX_DELIVERY_ATTEMPTS,
} from './ai-resilience.js';

// ---------------------------------------------------------------------------

/** Output cap for the steel-man call (a contract is small). */
const STEELMAN_MAX_TOKENS = 2048;
/**
 * Output cap for ONE file's authoring call.
 *
 * This is a per-FILE budget now, not a budget shared by every file in one
 * response. Under the old single-call contract, four files split one 4096-token
 * cap and the fourth reliably truncated mid-string — which, in a JSON payload,
 * invalidated the whole response including the three good files.
 */
const TESTS_MAX_TOKENS = 4096;
/** Output cap for the PLAN call (paths + intents; deliberately small). */
const PLAN_MAX_TOKENS = 1024;
/** Head of a malformed response recorded for diagnosis. See {@link runPurser}. */
const RAW_DIAGNOSTIC_CHARS = 2000;
/** Diff budget for the purser's prompts (chars). */
const PURSER_DIFF_CHAR_LIMIT = 24_000;
/** Transcript cap for the sandbox failure tail. */
const FAILURE_TAIL_BYTES = 1024;

/** Structural twin of execute.ts's ShipMetrics (accumulated per AI call). */
export interface PurserMetrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  calls: number;
  allEmpty: boolean;
  /** ai.run results that carried a readable `usage` block (see ShipMetrics). */
  usageReports: number;
}

/** Structural twin of execute.ts's Transcript (best-effort step recorder). */
export interface TranscriptLike {
  step(kind: string, ship: string | null, title: string, detail: unknown): Promise<void>;
}

export interface SteelManContract {
  purpose: string;
  /** The complete/best interpretation of the PR, as testable obligations. */
  obligations: string[];
  /** Modules/behaviors the adversarial tests should target. */
  testTargets: string[];
}

// ---------------------------------------------------------------------------
// Parsing (strict fenced JSON; the purser does not guess)

/**
 * A fenced code block, with the `json` info-string OPTIONAL and case-insensitive.
 * Models routinely emit ```` ``` ````, ```` ```JSON ````, or ```` ```json5 ````
 * when told "fenced json"; rejecting those threw away a well-formed contract
 * over a label.
 */
const JSON_FENCE_RE = /```[ \t]*[A-Za-z0-9]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/;

/**
 * Extract the purser's JSON payload from a model response.
 *
 * WHY TOLERANCE HERE IS SAFE: this function only decides WHICH substring to
 * hand to `JSON.parse`. Every caller ({@link parseSteelMan},
 * {@link parseAuthoredFiles}) then applies the SAME strict shape validation as
 * before and returns null on any deviation, so widening extraction can only
 * ever recover a contract the model really did emit — it can never invent one.
 * When nothing parses, the purser reports itself broken (`errored: true`) and
 * the run fails — never a quiet pass.
 *
 * The 2026-08-04 run recorded `steel-man output was not the required fenced
 * JSON contract` with `outputLength: 1416` — 1.4KB of model output discarded
 * because it did not match one rigid fence pattern. The three tolerances added,
 * in the order they are tried:
 *
 *   1. `<think>…</think>` reasoning spans are stripped FIRST (reusing
 *      `stripThinkSpans` from xo.ts — prior art, not a second implementation).
 *      This matters for more than tidiness: a reasoning model drafts its answer
 *      inside the think span, so the OLD regex would happily match the DRAFT
 *      fence and parse a discarded intermediate instead of the final answer.
 *   2. Any fenced block, not only one labelled exactly ```` ```json ````.
 *   3. Markdown prose around a bare, unfenced JSON object/array — the widest
 *      `{`…`}` / `[`…`]` slice, which must still fully parse.
 *
 * @param output Raw model text (possibly with think spans and prose).
 * @returns The parsed JSON value, or undefined when nothing parseable is found.
 */
function parseFencedJson(output: string): unknown | undefined {
  const text = stripThinkSpans(output ?? '');
  if (!text) return undefined;

  const candidates: string[] = [];
  const fence = JSON_FENCE_RE.exec(text);
  if (fence) candidates.push(fence[1].trim());
  candidates.push(text.trim());
  const firstBracket = text.search(/[[{]/);
  if (firstBracket !== -1) {
    const close = text[firstBracket] === '[' ? ']' : '}';
    const last = text.lastIndexOf(close);
    if (last > firstBracket) candidates.push(text.slice(firstBracket, last + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next, wider candidate.
    }
  }
  return undefined;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') return null;
    if (v.trim()) out.push(v.trim());
  }
  return out;
}

/**
 * Parse the steel-man contract. Accepts `contract` as either an obligations
 * array directly or `{ obligations: [...] }`. Returns null on ANY deviation —
 * a malformed steel-man means the purser stops as a BROKEN SHIP (errored ⇒
 * the run fails); it never improvises a contract the author will then be
 * held to.
 */
export function parseSteelMan(output: string): SteelManContract | null {
  const parsed = parseFencedJson(output);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const purpose = typeof o.purpose === 'string' ? o.purpose.trim() : '';
  if (!purpose) return null;

  const contractRaw = o.contract;
  let obligations: string[] | null = null;
  if (Array.isArray(contractRaw)) {
    obligations = stringArray(contractRaw);
  } else if (contractRaw && typeof contractRaw === 'object') {
    obligations = stringArray((contractRaw as Record<string, unknown>).obligations);
  }
  if (!obligations || obligations.length === 0) return null;

  const testTargets = stringArray(o.testTargets) ?? [];
  return { purpose, obligations, testTargets };
}

/**
 * Parse the authored test files. Accepts `{ files: [...] }` or a bare array of
 * `{ path, contents }`. Returns null when malformed or empty — the purser
 * either authors real tests or says so honestly.
 */
export function parseAuthoredFiles(output: string): StackedFile[] | null {
  const parsed = parseFencedJson(output);
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>).files
      : undefined;
  if (!Array.isArray(arr) || arr.length === 0) return null;

  const files: StackedFile[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') return null;
    const o = item as Record<string, unknown>;
    if (typeof o.path !== 'string' || typeof o.contents !== 'string') return null;
    files.push({ path: o.path, contents: o.contents });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Prompts

function truncatedDiff(diff: string): string {
  if (diff.length <= PURSER_DIFF_CHAR_LIMIT) return diff;
  return `${diff.slice(0, PURSER_DIFF_CHAR_LIMIT)}\n… (diff truncated at ${PURSER_DIFF_CHAR_LIMIT} chars)`;
}

function prBlock(prCtx: PRContext): string {
  return (
    `# PR #${prCtx.prNumber}: ${prCtx.title}\n\n` +
    `## PR description\n${prCtx.body || '(none)'}\n\n` +
    `## Diff\n\`\`\`diff\n${truncatedDiff(prCtx.diff)}\n\`\`\``
  );
}

/**
 * The steel-man output contract, factored so the REPAIR pass (src/repair.ts)
 * restates EXACTLY the format the original prompt demanded — repair can never
 * drift from the contract the ship was first held to.
 */
const STEELMAN_CONTRACT =
  'Output EXACTLY one fenced JSON object and nothing else:\n\n' +
  '```json\n' +
  '{\n' +
  '  "purpose": "<one-sentence statement of what this PR is for>",\n' +
  '  "contract": { "obligations": ["<testable obligation>", "..."] },\n' +
  '  "testTargets": ["<file/module/behavior the tests should target>", "..."]\n' +
  '}\n' +
  '```';

/**
 * The PLAN output contract for the repair pass — the fenced shape plus the
 * ship's own testPaths directory constraint, mirroring testPlanSystemPrompt so
 * a repaired plan is held to the same path rules as an original one.
 *
 * @param ship The purser ship (supplies testPaths).
 * @returns The contract text handed to {@link repairContractOutput}.
 */
function discoveryPathNote(testMatchPatterns: string[] | null): string {
  if (!testMatchPatterns?.length) {
    return (
      'No trusted test-discovery patterns were available for this repair. ' +
      'Correct JSON shape alone does not prove executability; authored tests will still ' +
      'fail the final gate unless discovery evidence can be read from the base ref.\n'
    );
  }
  return (
    'Every path MUST ALSO match at least one test-discovery pattern read from the ' +
    'repository\'s trusted base ref:\n' +
    `${testMatchPatterns.map(pattern => `- ${pattern}`).join('\n')}\n` +
    'A file can be inside an allowed directory and still be invisible to the test runner; ' +
    'an invisible path will be rejected.\n'
  );
}

function planContractBlock(ship: ShipConfig, testMatchPatterns: string[] | null = null): string {
  const pathNote =
    ship.testPaths.length > 0
      ? `Every path MUST be INSIDE one of these directories: ` +
        `${ship.testPaths.map(p => `${p}/`).join(', ')}\n`
      : '';
  return (
    pathNote +
    discoveryPathNote(testMatchPatterns) +
    'Output EXACTLY one fenced JSON object and nothing else:\n\n' +
    '```json\n' +
    '{ "files": [ { "path": "<repo-relative test file path>", "intent": "<what this file grills>" } ] }\n' +
    '```'
  );
}

function steelManSystemPrompt(ship: ShipConfig, graftText: string): string {
  return (
    graftText +
    `${ship.prompt}\n\n` +
    `You are pd-${ship.name}, running the STEEL-MAN phase. Read the PR title, ` +
    `description, and diff, and construct the STRONGEST, most complete ` +
    `interpretation of what this change is obligated to do — the contract its ` +
    `author would claim if pressed. Not its laziest reading: its best one.\n\n` +
    `${STEELMAN_CONTRACT}\n\n` +
    `Each obligation must be TESTABLE — a concrete behavior a unit or ` +
    `integration test can verify, including the edge cases the diff implies ` +
    `but may not handle.`
  );
}

/** The contract block shared by the PLAN and AUTHOR prompts. */
function contractBlock(steel: SteelManContract): string {
  return (
    `Purpose: ${steel.purpose}\n` +
    `Obligations:\n${steel.obligations.map(o => `- ${o}`).join('\n')}\n` +
    (steel.testTargets.length
      ? `Test targets:\n${steel.testTargets.map(t => `- ${t}`).join('\n')}\n`
      : '')
  );
}

/**
 * PLAN prompt — decide WHICH files to write, not what is in them.
 *
 * Small JSON on purpose: this is the same shape and size as the steel-man call,
 * which is the purser step that has always parsed reliably. File CONTENTS are
 * not requested here — they travel as raw code fences in the per-file authoring
 * step, where no escaping can corrupt them.
 *
 * A model that ignores the instruction and returns complete `{path, contents}`
 * files is not punished: {@link runPurser} takes them via
 * {@link parseAuthoredFiles} and skips the per-file calls entirely.
 */
export function testPlanSystemPrompt(ship: ShipConfig, steel: SteelManContract, graftText: string): string {
  // Say DIRECTORY, and show the trailing slash, because the validator means a
  // directory: it keeps a file only when `path === g || path.startsWith(g +
  // '/')`. Asking for a "prefix" invited the literal reading and got it — on
  // #7175 the model planned `tests/purser-authoring.test.ts`, mirroring the
  // source file it was grilling. That IS under the prefix `tests/purser`, so
  // the model complied with the instruction as written, and the validator
  // rejected it anyway. Every file failed the same way and the run stacked
  // nothing, which reads as "the purser produced no tests" rather than "the
  // purser was asked for the wrong thing".
  const pathNote =
    ship.testPaths.length > 0
      ? `Every path MUST be INSIDE one of these directories: ` +
        `${ship.testPaths.map(p => `${p}/`).join(', ')} ` +
        `(note the trailing slash — e.g. '${ship.testPaths[0]}/my-case.test.ts' is inside it, ` +
        `but '${ship.testPaths[0]}-my-case.test.ts' is NOT and will be rejected).\n`
      : '';
  return (
    graftText +
    `You are pd-${ship.name}, running the TEST PLANNING phase. ` +
    `You hold this contract for the PR (its best interpretation):\n\n` +
    contractBlock(steel) +
    `\nPlan the adversarial test files that would GRILL this contract — edge ` +
    `cases, boundary values, error paths, concurrency and idempotency where ` +
    `relevant. Do NOT write the tests yet. Name the files and what each one is ` +
    `for.\n\n` +
    pathNote +
    `Paths must be relative (no leading '/', no '..'). At most ${MAX_PLANNED_FILES} files — ` +
    `prefer fewer, denser files over many thin ones.\n\n` +
    `Output EXACTLY one fenced JSON object and nothing else:\n\n` +
    '```json\n' +
    '{ "files": [ { "path": "<repo-relative test file path>", "intent": "<what this file grills>" } ] }\n' +
    '```'
  );
}

/** Parse either accepted PLAN response shape into the paths it proposes. */
function plannedResponsePaths(text: string): string[] | null {
  const authored = parseAuthoredFiles(text);
  if (authored) return authored.map(file => file.path);
  const plan = parseTestPlan(text);
  return plan ? plan.map(file => file.path) : null;
}

/**
 * Is a planned path structurally eligible for a discovery repair?
 *
 * Traversal and paths outside the ship's configured directory
 * belong to the existing per-file validator. Treating those as a testMatch
 * miss would replan an entire batch and undo partial success for a bad sibling.
 */
function discoveryRepairEligible(path: string, ship: ShipConfig): boolean {
  if (!validateStackedFiles([{ path, contents: '' }]).ok) return false;
  return ship.testPaths.length === 0 ||
    ship.testPaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/** Safe, in-scope paths the trusted runner configuration would never discover. */
function undiscoverablePlannedPaths(
  text: string,
  testMatchPatterns: string[] | null,
  ship: ShipConfig,
): string[] {
  if (!testMatchPatterns?.length) return [];
  const paths = plannedResponsePaths(text);
  if (!paths) return [];
  return paths.filter(path =>
    discoveryRepairEligible(path, ship) && !matchesAnyTestMatch(path, testMatchPatterns));
}

/**
 * AUTHOR prompt — write ONE file, emitted as a raw code fence.
 *
 * The response contract is a bare fenced block, so the file's newlines, quotes
 * and backslashes are never escaped and therefore can never be mis-escaped.
 * This is the specific failure the split exists to remove: a JSON string value
 * carrying a whole source file is the most fragile thing a model can be asked
 * for, and it cost a 2026-08-09 run its entire 6KB of authored tests.
 */
function fileAuthorSystemPrompt(
  ship: ShipConfig,
  steel: SteelManContract,
  planned: PlannedFile,
  graftText: string,
  evidence: ExecutabilityEvidence,
  repairFailure?: string,
): string {
  const repairNote = repairFailure
    ? `\nA previous draft for this exact path failed the trusted executability gate:\n` +
      `${repairFailure}\nRewrite the complete file and fix that failure. Do not move or rename it.\n`
    : '';
  const runnerNote = evidence.testMatchPatterns?.length
    ? `\nTrusted runner evidence (authoritative, not inferred from the PR diff): this ` +
      `repository routes \`${planned.path}\` through Jest. Its testMatch patterns are: ` +
      `${evidence.testMatchPatterns.join(', ')}. Use Jest globals such as describe, test/it, ` +
      `and expect (or the repository's existing Jest imports). Never import from 'vitest', ` +
      `'bun:test', or 'node:test'; those runners are incompatible with this path.` +
      (evidence.packageTypeModule === true
        ? ` The trusted package.json sets type=module, so do not use an unbound __dirname.\n`
        : '\n')
    : `\nTrusted test-runner evidence is unavailable. Do not guess or import a runner-specific ` +
      `API; use only test idioms directly evidenced by repository files.\n`;
  return (
    graftText +
    `You are pd-${ship.name}, running the ADVERSARIAL TEST AUTHORING phase. ` +
    `You hold this contract for the PR (its best interpretation):\n\n` +
    contractBlock(steel) +
    `\nWrite EXACTLY ONE file: \`${planned.path}\`.\n` +
    (planned.intent ? `Its job: ${planned.intent}\n` : '') +
    `\nIt must GRILL the contract above — the PR has to satisfy its best ` +
    `interpretation, not its laziest. Use the repo's existing test framework ` +
    `and idioms as evident from the diff. The file must be complete and ` +
    `runnable on its own: real imports, no placeholders, no "// TODO", no ` +
    `elisions like "... rest unchanged". Relative imports resolve from the ` +
    `directory containing ${planned.path}; count every required '..' segment ` +
    `from that directory and never invent a module — imports must name real repository files.\n` +
    runnerNote +
    repairNote +
    `\n` +
    `Output the file as ONE fenced code block and nothing else — no JSON, no ` +
    `commentary before or after:\n\n` +
    '```ts\n' +
    '// the complete contents of ' + planned.path + '\n' +
    '```'
  );
}

// ---------------------------------------------------------------------------
// AI plumbing (mirrors execute.ts's aiOptions/accumulateUsage, kept local so
// the purser stays importable without execute.ts's private helpers)

function aiOptions(
  env: ExecutorEnv,
  shipName: string,
): { extraHeaders: Record<string, string>; gateway?: { id: string } } {
  const opts: { extraHeaders: Record<string, string>; gateway?: { id: string } } = {
    extraHeaders: { 'x-session-affinity': `pd-fleet-${shipName}` },
  };
  if (env.AI_GATEWAY_ID) opts.gateway = { id: env.AI_GATEWAY_ID };
  return opts;
}

function accumulate(metrics: PurserMetrics, res: unknown, text: string): void {
  const u = extractWorkersAiUsage(res);
  metrics.inputTokens += u.inputTokens ?? 0;
  metrics.outputTokens += u.outputTokens ?? 0;
  metrics.cachedInputTokens += u.cachedInputTokens ?? 0;
  metrics.calls += 1;
  // Mirrors execute.ts's accumulateUsage: count the calls whose result actually
  // carried a usage block, so the run page can say "not reported" instead of
  // rendering a 0 that reads as free.
  if (u.inputTokens != null || u.outputTokens != null) metrics.usageReports += 1;
  if (text) metrics.allEmpty = false;
}

async function purserAiCall(
  ship: ShipConfig,
  env: ExecutorEnv,
  system: string,
  user: string,
  maxTokens: number,
  metrics: PurserMetrics,
  aiCircuit: FleetAiCircuit,
  /**
   * Model for THIS step, when it differs from the ship's own. Already guarded
   * by fleet.ts against unknown ids, so an unusable pin arrives here as
   * undefined rather than as a model that silently returns blank.
   */
  stepModel?: string,
  assertCurrentHead: PullRequestHeadGuard = async () => {},
): Promise<{ text: string; res: unknown }> {
  const request = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    ...(ship.temperature === null ? {} : { temperature: ship.temperature }),
  };
  await assertCurrentHead(`before pd-${ship.name} Purser model call`);
  const res = await aiCircuit.run(() =>
    env.AI.run(
      (stepModel ?? ship.cfModel) as Parameters<typeof env.AI.run>[0],
      request,
      aiOptions(env, ship.name),
    ),
  );
  await assertCurrentHead(`after pd-${ship.name} Purser model call`);
  const { text } = extractAiText(res);
  accumulate(metrics, res, text);
  return { text, res };
}

/** Cheap runner evidence used before authoring; deliberately omits the tree. */
async function gatherTrustedRunnerEvidence(
  prCtx: PRContext,
  token: string,
): Promise<ExecutabilityEvidence> {
  const pkg = await fetchRepoFileText(prCtx.owner, prCtx.repo, 'package.json', prCtx.baseSha, token);
  let testMatchPatterns: string[] | null = null;
  for (const name of JEST_CONFIG_CANDIDATES) {
    const text = await fetchRepoFileText(prCtx.owner, prCtx.repo, name, prCtx.baseSha, token);
    if (text) {
      testMatchPatterns = extractJestTestMatch(text);
      if (testMatchPatterns) break;
    }
  }
  if (!testMatchPatterns) {
    if (pkg) testMatchPatterns = extractPackageJsonTestMatch(pkg);
  }
  return {
    testMatchPatterns,
    repoTreePaths: null,
    packageTypeModule: pkg ? extractPackageTypeModule(pkg) : null,
  };
}

/**
 * Gather the evidence {@link checkGeneratedTestsExecutable} needs, from the PR's
 * BASE sha (the trusted, zero-trust ref — never the PR head): the repo's real
 * Jest testMatch patterns and its full file tree. Every fetch degrades to null
 * on failure (network error, 404, unparseable) rather than throwing — the gate
 * itself fails closed on null, so a fetch failure here still ends in rejection,
 * never a silent pass.
 *
 * Runner evidence may be supplied from the authoring phase so successful plans
 * do not refetch package/config files. The expensive recursive tree read stays
 * deferred until authored files survive local path validation.
 */
async function gatherExecutabilityEvidence(
  prCtx: PRContext,
  token: string,
  runnerEvidence?: ExecutabilityEvidence,
): Promise<ExecutabilityEvidence> {
  const trustedRunner = runnerEvidence ?? await gatherTrustedRunnerEvidence(prCtx, token);
  const repoTreePaths = await fetchRepoTreePaths(prCtx.owner, prCtx.repo, prCtx.baseSha, token);
  return { ...trustedRunner, repoTreePaths };
}

// ---------------------------------------------------------------------------
// Comment rendering — firm, adversarial, professional. Demands, with reasons.

function renderObligations(steel: SteelManContract): string {
  return steel.obligations.map((o, i) => `${i + 1}. ${o}`).join('\n');
}

/**
 * HTML markers bounding the purser's contract section in the reviewed PR's
 * body. Exported so tests (and any future renderer) locate the section by the
 * same strings the writer uses — the two can never drift apart.
 */
export const PURSER_CONTRACT_START = '<!-- pd-purser:contract:start -->';
export const PURSER_CONTRACT_END = '<!-- pd-purser:contract:end -->';

/**
 * Render the steel-manned contract as the PR-summary section the purser
 * maintains between {@link PURSER_CONTRACT_START} and
 * {@link PURSER_CONTRACT_END}.
 *
 * WHY THE PR BODY AND NOT ONLY A COMMENT (operator mandate, 2026-08-19): the
 * PR summary is the durable chronology of what a PR should be — it is what a
 * future reader, a bisect, or a release note reads first. The steel-man
 * argument and its obligations ARE that chronology, so an agent maintains
 * them there, edit-in-place, on every fresh steel-man.
 *
 * @param steel The parsed steel-man contract (purpose + obligations).
 * @returns Markdown for the section body (markers are added by the caller).
 */
export function buildContractBodySection(steel: SteelManContract): string {
  return [
    '---',
    '## Contract (steel-manned by pd-purser)',
    `**Purpose:** ${steel.purpose}`,
    `**Obligations — the interpretation this PR is held to:**\n${renderObligations(steel)}`,
    '_Maintained by pd-purser, edit-in-place on each fresh steel-man. Dispute an ' +
      'obligation on the purser’s review thread, with reasons — do not delete this section._',
  ].join('\n\n');
}

function renderSandboxSection(sandbox: SandboxRunOutcome): string {
  if (!sandbox.executed) {
    return (
      `**Execution: NOT RUN.** ${sandbox.reason ?? 'sandbox unavailable'}. ` +
      `These tests have not been executed — no result is being claimed for them. ` +
      `They still state the contract; run them.`
    );
  }
  if (sandbox.passed) {
    return (
      `**Execution: RAN — PASSED.** The PR head satisfies these tests today. ` +
      `Keep it that way.`
    );
  }
  // Name the failures individually when the runner's format allowed it. This
  // is the difference between "your PR fails its contract, here is 1 KB of
  // scrollback" and "these four cases fail" — the second is actionable, the
  // first is a chore. `failures` is best-effort by construction (see
  // parseTestFailures), so the raw tail stays available underneath rather than
  // being replaced by it.
  const named = sandbox.failures.length
    ? `\n\n**Failing:**\n${sandbox.failures.map(f => `- \`${f}\``).join('\n')}` +
      (sandbox.failures.length >= MAX_NAMED_FAILURES
        ? `\n\n…capped at ${MAX_NAMED_FAILURES}; the full output below has the rest.`
        : '')
    : `\n\nI could not name the individual cases from this runner's output ` +
      `format — the raw tail is below. The failure itself is not in doubt: the ` +
      `suite exited non-zero.`;

  return (
    `**Execution: RAN — FAILED.** The PR head does NOT satisfy its own ` +
    `best-interpretation contract.` +
    named +
    `\n\n<details>\n<summary>Failing output (tail)</summary>\n\n` +
    '```\n' +
    sandbox.outputTail.slice(-FAILURE_TAIL_BYTES) +
    '\n```\n\n</details>'
  );
}

function renderTestList(files: StackedFile[]): string {
  return files.map(f => `- \`${f.path}\``).join('\n');
}

function renderInlineTests(files: StackedFile[]): string {
  return files
    .map(
      f =>
        `<details>\n<summary><code>${f.path}</code></summary>\n\n` +
        `\`\`\`\n${f.contents}\n\`\`\`\n\n</details>`,
    )
    .join('\n\n');
}

interface CommentParams {
  prCtx: PRContext;
  steel: SteelManContract;
  files: StackedFile[];
  sandbox: SandboxRunOutcome;
  stackedPr: StackedPrResult | null;
  retargeted: boolean;
  degradedReason: string | null;
  isFork: boolean;
  /**
   * Set when a stacked test PR exists but retargeting was deliberately SKIPPED
   * (never attempted) because the tests were not executed — as opposed to
   * `retargeted: false` with no reason, which means an attempted retarget
   * failed. Distinguishing the two keeps the comment honest about whether the
   * purser even tried.
   */
  retargetSkipReason: string | null;
}

function buildPurserComment(p: CommentParams): string {
  const parts: string[] = [];
  parts.push(
    `I have steel-manned this PR. This is the contract it is claiming, read at ` +
      `its strongest — and the interpretation it will be held to:`,
  );
  parts.push(`**Purpose:** ${p.steel.purpose}`);
  parts.push(`**Obligations:**\n${renderObligations(p.steel)}`);
  parts.push(
    `I have authored ${p.files.length} adversarial test file(s) against that ` +
      `contract:\n${renderTestList(p.files)}`,
  );
  parts.push(renderSandboxSection(p.sandbox));

  if (p.degradedReason) {
    parts.push(
      `**Degraded honestly:** ${p.degradedReason} The tests are therefore ` +
        `posted inline below instead of as a stacked branch. The demand stands ` +
        `regardless of my write access: satisfy these tests.\n\n` +
        renderInlineTests(p.files),
    );
  } else if (p.stackedPr) {
    if (p.retargeted) {
      parts.push(
        `**The stack:** the tests live in #${p.stackedPr.number} (${p.stackedPr.url}). ` +
          `This PR has been retargeted onto that test branch — it now sits ON TOP ` +
          `of its own contract's tests and merges through them. If a test is wrong, ` +
          `argue with the test in #${p.stackedPr.number}, with reasons; do not ` +
          `route around it.`,
      );
    } else if (p.isFork) {
      parts.push(
        `**The stack:** the tests live in #${p.stackedPr.number} (${p.stackedPr.url}). ` +
          `This PR comes from a fork, so I have not retargeted it — but the demand ` +
          `is unchanged: the PR must satisfy those tests before it merges.`,
      );
    } else if (p.retargetSkipReason) {
      parts.push(
        `**The stack:** the tests live in #${p.stackedPr.number} (${p.stackedPr.url}). ` +
          `This PR has NOT been retargeted onto them: ${p.retargetSkipReason} The demand ` +
          `stands regardless: satisfy those tests before this merges.`,
      );
    } else {
      parts.push(
        `**The stack:** the tests live in #${p.stackedPr.number} (${p.stackedPr.url}). ` +
          `Retargeting this PR onto the test branch did not complete; the demand ` +
          `is unchanged: satisfy those tests.`,
      );
    }
  }

  parts.push(
    `These demands are not decoration. Each obligation above is something this ` +
      `PR's own description implies; if an obligation is wrong, say so and I will ` +
      `stand corrected — otherwise, meet it.`,
  );
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------

/**
 * Re-execute an already-authored test suite and report its status.
 *
 * This is the steady-state path: a PR that has been pushed to since the purser
 * first ruled on it. It spends ZERO model calls — the contract was settled on
 * the first run and the tests are read back off the purser's own branch.
 *
 * The verdict logic deliberately mirrors the authoring path rather than being
 * softened: a re-run that fails is exactly as blocking as a first run that
 * fails. If it were advisory, an author could make a red gate green by pushing
 * an empty commit, which is the whole failure this gate exists to prevent.
 *
 * @returns The ship result, blocking iff the ship is configured blocking and
 *          sandbox-executed tests failed.
 */
async function rerunExistingTests(
  ship: ShipConfig,
  prCtx: PRContext,
  env: ExecutorEnv,
  token: string,
  transcript: TranscriptLike,
  files: StackedFile[],
  testPr: { number: number; url: string },
  reason: string,
  verifiedExecutability?: ExecutabilityResult,
  assertCurrentHead: PullRequestHeadGuard = async () => {},
): Promise<ShipResult> {
  const executability = verifiedExecutability ?? checkGeneratedTestsExecutable(
    files,
    await gatherExecutabilityEvidence(prCtx, token),
  );
  if (!executability.ok) {
    await transcript.step(
      'purser-tests',
      ship.name,
      `pd-${ship.name}: reused tests NON-EXECUTABLE`,
      {
        testPrNumber: testPr.number,
        error: executability.reason,
        fileCount: files.length,
      },
    );
    await assertCurrentHead(`before pd-${ship.name} reused-tests failure comment`);
    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      `**Re-run stopped — the existing Purser tests are not executable by this repository's trusted runner.**\n\n` +
        `The tests in #${testPr.number} (${testPr.url}) were not run and are not evidence that this PR violates its contract. ` +
        `Purser machinery failed closed before the sandbox: ${executability.reason}\n\n` +
        `Repair or close the test PR, then re-run Fleet. The implementation PR must not be blamed for a contract file the runner cannot load.`,
      token,
      assertCurrentHead,
    );
    return {
      ship: ship.name,
      blocking: ship.blocking,
      verdict: ship.blocking ? 'BLOCK' : 'PASS',
      errored: true,
      findings: [],
    };
  }
  await assertCurrentHead(`before pd-${ship.name} reused-tests sandbox`);
  const sandbox = await runTestsInSandbox({
    sandboxBinding: env.SANDBOX,
    owner: prCtx.owner,
    repo: prCtx.repo,
    headSha: prCtx.headSha,
    files,
    token,
  });
  await assertCurrentHead(`after pd-${ship.name} reused-tests sandbox`);

  await transcript.step(
    'purser-sandbox',
    ship.name,
    sandbox.executed
      ? `pd-${ship.name}: re-ran existing tests — ${sandbox.passed ? 'PASSED' : 'FAILED'}`
      : `pd-${ship.name}: re-run NOT EXECUTED`,
    {
      rerun: true,
      testPrNumber: testPr.number,
      executed: sandbox.executed,
      passed: sandbox.passed,
      failures: sandbox.failures,
      ...(sandbox.reason ? { reason: sandbox.reason } : {}),
    },
  );

  const status = renderSandboxSection(sandbox);
  const body =
    `**Re-run — no new tests authored.** This PR already has a contract, ` +
    `settled in #${testPr.number} (${testPr.url}). I did not re-write it: ` +
    `${reason}. Tests are authored once and then held to; a gate that rewrites ` +
    `itself every time you push is a treadmill, not a standard.\n\n` +
    `I re-executed the ${files.length} existing test file(s) against this ` +
    `head.\n\n${status}\n\n` +
    `<details>\n<summary>The tests being enforced (${files.length})</summary>\n\n` +
    files.map(f => `- \`${f.path}\``).join('\n') +
    `\n\n</details>\n\n` +
    `If a test is wrong, argue with it in #${testPr.number}, with reasons. ` +
    `Do not route around it.`;

  await assertCurrentHead(`before pd-${ship.name} reused-tests comment`);
  await postShipComment(
    prCtx.owner,
    prCtx.repo,
    prCtx.prNumber,
    ship.name,
    ship.role,
    body,
    token,
    assertCurrentHead,
  );

  let verdict: Verdict;
  if (sandbox.executed) {
    verdict = sandbox.passed ? 'PASS' : 'BLOCK';
  } else {
    verdict = ship.blockWithoutSandbox ? 'BLOCK' : 'PASS';
  }
  return { ship: ship.name, blocking: ship.blocking, verdict, errored: false, findings: [] };
}

/**
 * Run the purser against one PR. Product and permanent dependency failures
 * resolve to an honest ShipResult + transcript trail. A retryable Workers AI
 * dependency fault is deliberately rethrown while queue budget remains; the
 * queue is the single retry layer for every Fleet ship. Current-head validation
 * errors also propagate so the orchestrator can cancel an obsolete run.
 */
export async function runPurser(
  ship: ShipConfig,
  prCtx: PRContext,
  env: ExecutorEnv,
  token: string,
  transcript: TranscriptLike,
  metrics: PurserMetrics,
  /** Skill-graft prompt prefix ('' ⇒ none) — see src/skill-graft.ts. */
  graftText = '',
  /** Run id for squid coordination events ('' ⇒ unknown; events still fire). */
  runId = '',
  /** Tenant `squidEvents: true` consent from pd-fleet.yml (default false). */
  squidConsent = false,
  /** One circuit shared by every AI call in this queue delivery. */
  aiCircuit = new FleetAiCircuit(),
  /** Provider attempt after successful checkpoint continuations are excluded. */
  providerAttempt = PROVIDER_MAX_DELIVERY_ATTEMPTS,
  /** Fail-closed live-head proof around model work and publication. */
  assertCurrentHead: PullRequestHeadGuard = async () => {},
): Promise<ShipResult> {
  // The BROKEN-SHIP result (see the module doc): the purser's machinery failed
  // to do its job, so it says so under its REAL blocking flag. `errored: true`
  // is the authoritative signal — aggregateConclusion fails the run on it
  // whatever the flag, so the breakage gets fixed instead of tolerated.
  const brokenShip: ShipResult = {
    ship: ship.name,
    blocking: ship.blocking,
    verdict: ship.blocking ? 'BLOCK' : 'PASS',
    errored: true,
    findings: [],
  };

  // Branch/PR names are derived once: the re-run probe below and the stack
  // phase further down must agree on them or the purser would read one branch
  // and write another.
  const branchName = `purser/pr-${prCtx.prNumber}-tests`;
  const fingerprint = fingerprintDiff(prCtx.diff ?? '');

  try {
    // --- 0. RE-RUN PROBE ----------------------------------------------------
    // Before spending a single token, ask whether this PR already HAS a
    // contract. Tests are authored once and then re-executed; see
    // src/purser-rerun.ts for why re-authoring on every push is actively
    // harmful rather than merely wasteful.
    let reused: { files: StackedFile[]; testPr: { number: number; url: string } } | null = null;
    let rerunNote: string | null = null;
    try {
      const existingPr = await findOpenPrForBranch(prCtx.owner, prCtx.repo, branchName, token);
      if (existingPr) {
        const prior = decodeFingerprint(existingPr.body);
        // Read ONLY the paths recorded at author time. The branch tree is the
        // whole repository (base_tree), so there is nothing to discover here —
        // see readBranchFiles. No recorded paths ⇒ no read at all ⇒ author.
        const priorFiles = prior?.tests.length
          ? await readBranchFiles(prCtx.owner, prCtx.repo, branchName, prior.tests, token)
          : null;
        const decision = decideRerun(
          prior,
          fingerprint,
          Boolean(priorFiles && priorFiles.length),
        );
        if (decision.action === 'reuse' && priorFiles) {
          reused = { files: priorFiles, testPr: { number: existingPr.number, url: existingPr.url } };
          rerunNote = decision.reason;
        } else {
          rerunNote = `re-authoring: ${decision.reason}`;
        }
      }
    } catch (err) {
      // A probe failure must never cost the run — fall through to authoring,
      // which is the pre-existing behaviour.
      rerunNote = `re-run probe failed (${String(err).slice(0, 120)}); authoring fresh`;
    }

    let verifiedReuse: ExecutabilityResult | undefined;
    if (reused) {
      verifiedReuse = checkGeneratedTestsExecutable(
        reused.files,
        await gatherExecutabilityEvidence(prCtx, token),
      );
      if (
        !verifiedReuse.ok &&
        (verifiedReuse.kind === 'syntax-error' ||
          verifiedReuse.kind === 'incompatible-runner' ||
          verifiedReuse.kind === 'unresolved-import' ||
          verifiedReuse.kind === 'undiscoverable-path')
      ) {
        rerunNote =
          `re-authoring: existing Purser tests are not executable by the trusted runner ` +
          `(${verifiedReuse.reason})`;
        await transcript.step(
          'purser-rerun',
          ship.name,
          `pd-${ship.name}: REJECTED non-executable reused tests from #${reused.testPr.number}; authoring fresh`,
          {
            testPrNumber: reused.testPr.number,
            files: reused.files.map(f => f.path),
            reason: verifiedReuse.reason,
            action: 'author-fresh',
          },
        );
        reused = null;
        verifiedReuse = undefined;
      }
    }

    if (reused) {
      await transcript.step(
        'purser-rerun',
        ship.name,
        `pd-${ship.name}: REUSING existing tests from #${reused.testPr.number} (0 AI calls)`,
        {
          testPrNumber: reused.testPr.number,
          files: reused.files.map(f => f.path),
          reason: rerunNote,
          aiCallsSaved: 2,
        },
      );
      return await rerunExistingTests(
        ship,
        prCtx,
        env,
        token,
        transcript,
        reused.files,
        reused.testPr,
        rerunNote ?? '',
        verifiedReuse,
        assertCurrentHead,
      );
    }

    // One bounded repair pass (src/repair.ts) shared by the two purser call
    // sites whose failures are model-formatting slips rather than judgment.
    // The parser passed as `validate` is the only judge of healing.
    const purserRepair = async (
      reason: string,
      priorOutput: string,
      contract: string,
      maxTokens: number,
      validate: (text: string) => boolean,
    ) => {
      const outcome = await repairContractOutput({
        shipLabel: `pd-${ship.name}`,
        model: ship.cfModel,
        contract,
        priorOutput,
        reason,
        call: async (model, system, user) =>
          (
            await purserAiCall(
              ship,
              env,
              system,
              user,
              maxTokens,
              metrics,
              aiCircuit,
              model,
              assertCurrentHead,
            )
          ).text,
        validate,
        abortOnError: error => error instanceof PullRequestHeadValidationError,
      });
      await transcript.step(
        'ship-repair',
        ship.name,
        outcome.healed
          ? `pd-${ship.name}: contract repair HEALED on ${outcome.healedBy} (${reason})`
          : `pd-${ship.name}: contract repair FAILED after ${outcome.attempts.length} attempt(s) (${reason})`,
        { healed: outcome.healed, healedBy: outcome.healedBy, reason, attempts: outcome.attempts },
      );
      return outcome;
    };

    // --- a. STEEL-MAN -------------------------------------------------------
    const steelCall = await purserAiCall(
      ship,
      env,
      steelManSystemPrompt(ship, graftText),
      prBlock(prCtx),
      STEELMAN_MAX_TOKENS,
      metrics,
      aiCircuit,
      undefined,
      assertCurrentHead,
    );
    let steelText = steelCall.text;
    let steel = parseSteelMan(steelText);
    if (!steel) {
      const repair = await purserRepair(
        'steel-man output was not the required fenced JSON contract',
        steelText,
        STEELMAN_CONTRACT,
        STEELMAN_MAX_TOKENS,
        text => parseSteelMan(text) !== null,
      );
      if (repair.healed) {
        steelText = repair.text;
        steel = parseSteelMan(steelText);
      }
    }
    if (!steel) {
      await transcript.step('purser-steelman', ship.name, `pd-${ship.name}: steel-man MALFORMED`, {
        error: 'steel-man output was not the required fenced JSON contract (repair also failed)',
        responseShape: steelCall.text ? undefined : describeResponseShape(steelCall.res),
        outputLength: steelText.length,
      });
      return brokenShip;
    }
    await transcript.step(
      'purser-steelman',
      ship.name,
      `pd-${ship.name}: steel-manned contract (${steel.obligations.length} obligation(s))`,
      {
        purpose: steel.purpose,
        obligationCount: steel.obligations.length,
        // The full obligations text, not just its count — this is the actual
        // contract the PR is held to (posted verbatim into the PR body by
        // upsertPrBodySection below); the run page renders it so the operator
        // never has to open the PR to read what "steel-manned" concluded.
        obligations: steel.obligations,
        testTargets: steel.testTargets,
      },
    );

    // --- a.5 THE CONTRACT GOES INTO THE PR SUMMARY --------------------------
    // Operator mandate (2026-08-19): the steel-man argument and its obligations
    // are the best chronology of what a PR should be, and that chronology
    // belongs in the PR's own body — the summary every reader and every gate
    // reads first — not only in a comment that scrolls away. Edit-in-place
    // between HTML markers; the author's own prose is never touched. The
    // outcome is recorded either way so a missed write is loud, not silent.
    await assertCurrentHead(`before pd-${ship.name} PR contract summary mutation`);
    const summaryPosted = await upsertPrBodySection(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      PURSER_CONTRACT_START,
      PURSER_CONTRACT_END,
      buildContractBodySection(steel),
      token,
      assertCurrentHead,
    );
    await transcript.step(
      'purser-contract-posted',
      ship.name,
      summaryPosted
        ? `pd-${ship.name}: steel-man contract (${steel.obligations.length} obligation(s)) written into the PR summary`
        : `pd-${ship.name}: FAILED to write the steel-man contract into the PR summary`,
      { posted: summaryPosted, obligationCount: steel.obligations.length },
    );

    // --- b. PLAN TESTS ------------------------------------------------------
    // One small-JSON call names the files; the contents come one call each,
    // below. See purser-authoring.ts for why this is split.
    const planCall = await purserAiCall(
      ship,
      env,
      testPlanSystemPrompt(ship, steel, graftText),
      prBlock(prCtx),
      PLAN_MAX_TOKENS,
      metrics,
      aiCircuit,
      ship.cfPlanModel,
      assertCurrentHead,
    );

    // FAST PATH: a model that ignored "plan only" and returned complete files
    // has already done the work — take it and skip the per-file calls.
    let planText = planCall.text;
    let files: StackedFile[] = parseAuthoredFiles(planText) ?? [];
    let authorFailures: AuthorFailure[] = [];
    let plan: PlannedFile[] = [];
    let evidence: ExecutabilityEvidence | null = null;
    let authoringEvidence: ExecutabilityEvidence | null = null;

    // A malformed OR provably undiscoverable plan gets one bounded repair pass
    // before it counts as breakage. A repaired response may come back as either
    // a plan OR complete files, so both parsers are accepted as proof of
    // healing. This is semantic repair, not path guessing: the model receives
    // the exact trusted globs and our existing matcher remains the judge.
    // Complete files are the deliberate fast path: they have already spent the
    // authoring tokens, so they keep flowing to the existing per-file and final
    // executability gates below. A true plan has not authored anything yet;
    // gather evidence here, then repair bad paths before the per-file calls.
    const plannedPaths = files.length === 0 ? plannedResponsePaths(planText) : null;
    const hasRepairEligiblePath =
      plannedPaths?.some(path => discoveryRepairEligible(path, ship)) ?? false;
    if (files.length === 0 && (plannedPaths === null || hasRepairEligiblePath)) {
      evidence = await gatherExecutabilityEvidence(prCtx, token);
    }
    const undiscoverable =
      files.length === 0
        ? undiscoverablePlannedPaths(planText, evidence?.testMatchPatterns ?? null, ship)
        : [];
    if (files.length === 0 && (plannedPaths === null || undiscoverable.length > 0)) {
      const reason =
        plannedPaths === null
          ? 'plan output was neither a file plan nor a complete files block'
          : `planned path(s) miss the repository test-discovery patterns: ${undiscoverable.join(', ')}`;
      const repair = await purserRepair(
        reason,
        planText,
        planContractBlock(ship, evidence?.testMatchPatterns ?? null),
        PLAN_MAX_TOKENS,
        text => {
          const paths = plannedResponsePaths(text);
          return paths !== null &&
            undiscoverablePlannedPaths(text, evidence?.testMatchPatterns ?? null, ship).length === 0;
        },
      );
      if (repair.healed) {
        planText = repair.text;
        files = parseAuthoredFiles(planText) ?? [];
      }
    }

    // A valid-shaped plan that stayed undiscoverable after both bounded repair
    // attempts must stop BEFORE per-file authoring. Spending more tokens on
    // files the trusted runner cannot see would recreate #8298 with a clearer
    // transcript but the same fleet-wide outage.
    const remainingUndiscoverable =
      files.length === 0
        ? undiscoverablePlannedPaths(planText, evidence?.testMatchPatterns ?? null, ship)
        : [];
    if (remainingUndiscoverable.length > 0) {
      await transcript.step('purser-plan', ship.name, `pd-${ship.name}: test plan NON-DISCOVERABLE`, {
        files: remainingUndiscoverable,
        testMatchPatterns: evidence?.testMatchPatterns,
      });
      return brokenShip;
    }

    if (files.length > 0) {
      await transcript.step(
        'purser-plan',
        ship.name,
        `pd-${ship.name}: plan call returned ${files.length} complete file(s) (per-file calls skipped)`,
        { files: files.map(f => f.path), aiCallsSaved: files.length },
      );
    } else {
      const parsedPlan = parseTestPlan(planText);
      if (!parsedPlan) {
        await transcript.step('purser-plan', ship.name, `pd-${ship.name}: test plan MALFORMED`, {
          error: 'plan output was neither a file plan nor a complete files block (repair also failed)',
          outputLength: planText.length,
          // The old code recorded ONLY the length, which is unactionable: every
          // past failure was undiagnosable after the fact. The head of the real
          // response is what says whether the model refused, truncated, or
          // simply labelled its fence differently.
          rawHead: planText.slice(0, RAW_DIAGNOSTIC_CHARS),
          responseShape: planCall.text ? undefined : describeResponseShape(planCall.res),
        });
        return brokenShip;
      }
      plan = parsedPlan;
      await transcript.step(
        'purser-plan',
        ship.name,
        `pd-${ship.name}: planned ${plan.length} adversarial test file(s)`,
        { files: plan.map(p => ({ path: p.path, intent: p.intent })) },
      );

      // --- c. AUTHOR EACH FILE (one call per file) --------------------------
      // The final executability gate already needs this trusted evidence. Pull
      // it forward so authoring sees the actual Jest contract even when a
      // release/version diff contains no test-runner clues of its own.
      authoringEvidence = evidence ?? await gatherTrustedRunnerEvidence(prCtx, token);
      const authored = await authorTestFiles(plan, async (path, intent) => {
        const call = await purserAiCall(
          ship,
          env,
          fileAuthorSystemPrompt(ship, steel, { path, intent }, graftText, authoringEvidence!),
          prBlock(prCtx),
          TESTS_MAX_TOKENS,
          metrics,
          aiCircuit,
          ship.cfAuthorModel,
          assertCurrentHead,
        );
        return call.text;
      });
      files = authored.files;
      authorFailures = authored.failures;
    }

    if (files.length === 0) {
      await transcript.step('purser-tests', ship.name, `pd-${ship.name}: test authoring FAILED`, {
        error: 'no planned file authored usable contents',
        planned: plan.map(p => p.path),
        failures: authorFailures,
      });
      return brokenShip;
    }
    // PARTIAL SUCCESS is a real outcome now: the files that authored cleanly
    // still get stacked, and the ones that did not are named rather than
    // silently dropped. The old all-or-nothing shape returned zero here.
    if (authorFailures.length > 0) {
      await transcript.step(
        'purser-tests',
        ship.name,
        `pd-${ship.name}: authored ${files.length}/${plan.length} planned file(s)`,
        { authored: files.map(f => f.path), failures: authorFailures },
      );
    }
    // VALIDATE PER FILE, THEN AS A SET.
    //
    // Validating only the set made one unusable path reject every file beside
    // it — which quietly undid the partial-success property the per-file
    // authoring exists to provide: three good tests discarded because a fourth
    // path had a `..` in it. Each file is checked ALONE first (reusing the same
    // audited validator, so no path rule is duplicated or weakened here), and a
    // failure drops that ONE file with a named reason.
    //
    // Nothing is loosened by this. A file that survives has passed exactly the
    // checks it passed before, so a traversal path is still never written; it
    // simply no longer takes its innocent neighbours with it.
    const kept: StackedFile[] = [];
    for (const f of files) {
      const perFile = validateStackedFiles([f]);
      if (!perFile.ok) {
        authorFailures.push({ path: f.path, reason: perFile.reason });
        continue;
      }
      if (
        ship.testPaths.length > 0 &&
        !ship.testPaths.some(g => f.path === g || f.path.startsWith(`${g}/`))
      ) {
        authorFailures.push({
          path: f.path,
          reason: `path outside testPaths prefixes (${ship.testPaths.join(', ')})`,
        });
        continue;
      }
      kept.push(f);
    }
    files = kept;

    // Set-level properties (count ceiling, duplicate paths) can only be judged
    // on the survivors, so this runs after the per-file pass and stays
    // all-or-nothing — a set that breaks them has no honest subset to keep.
    const validation = files.length > 0 ? validateStackedFiles(files) : { ok: false as const, reason: '' };
    if (files.length === 0 || !validation.ok) {
      await transcript.step('purser-tests', ship.name, `pd-${ship.name}: authored tests REJECTED`, {
        error:
          files.length === 0
            ? authorFailures.map(f => `${f.path}: ${f.reason}`).join('; ') || 'no usable files'
            : (validation as { reason: string }).reason,
        fileCount: files.length,
        failures: authorFailures,
      });
      return brokenShip;
    }
    const fileSummaries = files.map(f => ({
      path: f.path,
      bytes: new TextEncoder().encode(f.contents).length,
    }));
    await transcript.step(
      'purser-tests',
      ship.name,
      `pd-${ship.name}: authored ${files.length} adversarial test file(s)`,
      {
        files: fileSummaries,
        totalBytes: fileSummaries.reduce((acc, f) => acc + f.bytes, 0),
        failures: authorFailures,
      },
    );

    // --- b.5 EXECUTABILITY GATE (fail closed) --------------------------------
    // validateStackedFiles (path safety) and ship.testPaths (an OPERATOR-
    // DECLARED prefix) do not prove the repo's REAL test runner would ever
    // discover these files, or that they load without crashing on a missing
    // import. #5860 shipped files that passed both checks yet lived outside the
    // repo's own jest.config.js testMatch and imported a module that did not
    // exist — Jest would never have run them, and the purser retargeted the
    // reviewed PR onto them anyway. This checks against the repo's ACTUAL
    // evidence (its own jest config + file tree at the PR's base sha), never
    // against configuration the purser only trusts because it wrote it.
    evidence ??= await gatherExecutabilityEvidence(prCtx, token, authoringEvidence ?? undefined);
    let executability = checkGeneratedTestsExecutable(files, evidence);
    const deterministicRepairs: Array<{
      path: string;
      fromSpecifier: string;
      toSpecifier: string;
      matchedTreePath: string;
    }> = [];
    while (
      !executability.ok &&
      executability.kind === 'unresolved-import' &&
      deterministicRepairs.length < MAX_PLANNED_FILES
    ) {
      const repair = repairMisrootedRelativeImport(
        files,
        executability,
        evidence.repoTreePaths,
      );
      if (!repair) break;
      const candidateSafety = validateStackedFiles(repair.files);
      if (!candidateSafety.ok) break;
      files = repair.files;
      deterministicRepairs.push({
        path: repair.path,
        fromSpecifier: repair.fromSpecifier,
        toSpecifier: repair.toSpecifier,
        matchedTreePath: repair.matchedTreePath,
      });
      executability = checkGeneratedTestsExecutable(files, evidence);
    }
    if (deterministicRepairs.length > 0) {
      await transcript.step(
        'purser-author-repair',
        ship.name,
        executability.ok
          ? `pd-${ship.name}: authored-file repair HEALED ${deterministicRepairs[0].path}`
          : `pd-${ship.name}: authored-file deterministic repair PARTIAL`,
        {
          strategy: 'trusted-tree-relative-import',
          attempts: 0,
          repairs: deterministicRepairs,
          result: executability.ok
            ? 'trusted executability gate passed after deterministic rewrite'
            : executability.reason,
        },
      );
    }
    const authoredRepairPaths = new Set<string>();
    while (
      !executability.ok &&
      (executability.kind === 'syntax-error' ||
        executability.kind === 'unresolved-import' ||
        executability.kind === 'incompatible-runner') &&
      executability.path &&
      authoredRepairPaths.size < MAX_PLANNED_FILES &&
      !authoredRepairPaths.has(executability.path)
    ) {
      // #8313: discovery-aware planning healed the filenames, then an authored
      // file nested at tests/unit/purser imported ../../scripts/... as though
      // it lived one directory higher. The trusted gate caught it, but throwing
      // away every authored file made the fleet-wide outage permanent. Give
      // Each distinct offending file gets one bounded rewrite with the exact
      // gate error. Siblings keep their original bytes, and the same safety +
      // executability validators remain the sole judges of whether healing
      // occurred. This matters when two independently-authored siblings both
      // guessed the same foreign runner: healing the first merely reveals the
      // second failure.
      const repairPath = executability.path;
      // Set size is the 1-based repair ordinal recorded in the transcript.
      authoredRepairPaths.add(repairPath);
      const repairIntent = plan.find(item => item.path === repairPath)?.intent ??
        'preserve the authored test intent while fixing its executability failure';
      const repairError = executability.reason;
      const repaired = await authorTestFiles(
        [{ path: repairPath, intent: repairIntent }],
        async (path, intent) => {
          const call = await purserAiCall(
            ship,
            env,
            fileAuthorSystemPrompt(
              ship,
              steel,
              { path, intent },
              graftText,
              evidence,
              repairError,
            ),
            prBlock(prCtx),
            TESTS_MAX_TOKENS,
            metrics,
            aiCircuit,
            // The rewrite runs on the ESCALATION tier, never the author tier:
            // a model that just authored a non-executable file is the worst
            // candidate to fix it (14-day D1 record: 83 of 110 same-model
            // rewrites FAILED). Same posture as repairContractOutput's second
            // attempt — when the author tier already IS the escalation model
            // this is a no-op, but an operator opt-down pin no longer drags
            // the repair down with it.
            REPAIR_ESCALATION_MODEL,
            assertCurrentHead,
          );
          return call.text;
        },
      );

      let repairReason = repaired.failures[0]?.reason ?? 'repair emitted no usable file';
      let healed = false;
      if (repaired.files.length === 1) {
        const candidate = files.map(file =>
          file.path === repairPath ? repaired.files[0] : file,
        );
        const candidateSafety = validateStackedFiles(candidate);
        if (!candidateSafety.ok) {
          repairReason = candidateSafety.reason;
        } else {
          const candidateExecutability = checkGeneratedTestsExecutable(candidate, evidence);
          if (
            candidateExecutability.ok ||
            (!candidateExecutability.ok && candidateExecutability.path !== repairPath)
          ) {
            files = candidate;
            executability = candidateExecutability;
            healed = true;
            repairReason = candidateExecutability.ok
              ? 'trusted executability gate passed after one rewrite'
              : `this file passed after one rewrite; next failing sibling: ${candidateExecutability.reason}`;
          } else {
            repairReason = candidateExecutability.reason;
          }
        }
      }
      await transcript.step(
        'purser-author-repair',
        ship.name,
        healed
          ? `pd-${ship.name}: authored-file repair HEALED ${repairPath}`
          : `pd-${ship.name}: authored-file repair FAILED ${repairPath}`,
        {
          path: repairPath,
          originalError: repairError,
          result: repairReason,
          attempts: 1,
          repairNumber: authoredRepairPaths.size,
        },
      );
    }
    if (!executability.ok) {
      await transcript.step('purser-tests', ship.name, `pd-${ship.name}: authored tests NON-EXECUTABLE`, {
        error: executability.reason,
        fileCount: files.length,
      });
      const notExecuted: SandboxRunOutcome = {
        executed: false,
        passed: null,
        outputTail: '',
        failures: [],
        reason: `not executed: ${executability.reason}`,
      };
      // Preserve the contract + authored tests as ADVISORY EVIDENCE (same
      // inline-tests treatment as the 403 degradation below) and explicitly do
      // NOT open a branch, stack a test PR, or touch the reviewed PR's base —
      // publishing a branch of provably non-executable tests would be worse
      // than the fork case, not better.
      await assertCurrentHead(`before pd-${ship.name} non-executable-tests comment`);
      await postShipComment(
        prCtx.owner,
        prCtx.repo,
        prCtx.prNumber,
        ship.name,
        ship.role,
        buildPurserComment({
          prCtx,
          steel,
          files,
          sandbox: notExecuted,
          stackedPr: null,
          retargeted: false,
          degradedReason: `these authored tests failed the executability gate: ${executability.reason}`,
          isFork: prCtx.isFork,
          retargetSkipReason: null,
        }),
        token,
        assertCurrentHead,
      );
      // Never fabricate a sandbox result for tests that structurally could not
      // run, and never retarget the implementation PR's base onto them — but a
      // purser that authored undiscoverable tests IS a broken ship: `errored`
      // fails the run so the authoring/config defect gets fixed, instead of
      // the demand quietly evaporating (the 2026-08-19 tests/purser incident:
      // testPaths pointed outside the repo's jest testMatch, every authored
      // file was rejected here, nothing was stacked, and the run stayed green).
      return brokenShip;
    }

    // --- c. SANDBOX (feature-flagged; honest when absent) -------------------
    await assertCurrentHead(`before pd-${ship.name} authored-tests sandbox`);
    const sandbox = await runTestsInSandbox({
      sandboxBinding: env.SANDBOX,
      owner: prCtx.owner,
      repo: prCtx.repo,
      headSha: prCtx.headSha,
      files,
      token,
    });
    await assertCurrentHead(`after pd-${ship.name} authored-tests sandbox`);
    await transcript.step(
      'purser-sandbox',
      ship.name,
      sandbox.executed
        ? `pd-${ship.name}: sandbox ${sandbox.passed ? 'PASSED' : 'FAILED'}`
        : `pd-${ship.name}: sandbox NOT RUN`,
      {
        executed: sandbox.executed,
        passed: sandbox.passed,
        failuresTail:
          sandbox.executed && sandbox.passed === false
            ? sandbox.outputTail.slice(-FAILURE_TAIL_BYTES)
            : '',
        ...(sandbox.reason ? { reason: sandbox.reason } : {}),
      },
    );

    // --- d. STACK -----------------------------------------------------------
    const baseBranch = prCtx.baseRef || env.DEFAULT_BRANCH || 'main';
    let stackedPr: StackedPrResult | null = null;
    let retargeted = false;
    let degradedReason: string | null = null;
    let retargetSkipReason: string | null = null;

    try {
      await assertCurrentHead(`before pd-${ship.name} test branch mutation`);
      await createOrUpdateBranch(
        prCtx.owner,
        prCtx.repo,
        branchName,
        prCtx.baseSha,
        files,
        `purser: adversarial tests for #${prCtx.prNumber}`,
        token,
        assertCurrentHead,
      );
      await assertCurrentHead(`before pd-${ship.name} test PR mutation`);
      stackedPr = await openStackedPr(
        prCtx.owner,
        prCtx.repo,
        branchName,
        baseBranch,
        `purser: adversarial tests for #${prCtx.prNumber}`,
        `${buildTestPrBody(prCtx, steel, files)}\n\n` +
          `${encodeFingerprint(withAuthoredTests(fingerprint, files.map(f => f.path)))}`,
        ['purser', 'adversarial-tests'],
        token,
        assertCurrentHead,
      );
      // Cloud squid: announce the stacked test PR (fire-and-forget, never blocks).
      await assertCurrentHead(`before pd-${ship.name} stacked-PR event`);
      emitSquidEvent(env, 'pr-stacked', {
        repo: `${prCtx.owner}/${prCtx.repo}`,
        pr: prCtx.prNumber,
        runId,
        ship: ship.name,
        url: stackedPr.url,
      }, squidConsent);
      // GUARD: only same-repo (non-fork) PRs are retargeted onto the tests, and
      // ONLY when the exact generated tests were actually EXECUTED — sandbox
      // absent (the default deploy, no SANDBOX binding) means the tests were
      // authored but never run, exactly the #5860 failure mode ("the body
      // admitted they were not run"). Retargeting a PR onto an unexecuted
      // contract hides the true origin/main diff and shrinks normal CI for no
      // verified benefit — the purser must not do that on faith.
      if (!prCtx.isFork && sandbox.executed) {
        try {
          await assertCurrentHead(`before pd-${ship.name} implementation PR retarget`);
          await retargetPrBase(
            prCtx.owner,
            prCtx.repo,
            prCtx.prNumber,
            branchName,
            token,
            assertCurrentHead,
          );
          retargeted = true;
        } catch (err) {
          console.error(
            `[fleet-executor] pd-${ship.name} retarget #${prCtx.prNumber} failed: ${String(err)}`,
          );
        }
      } else if (!prCtx.isFork && !sandbox.executed) {
        retargetSkipReason =
          'the adversarial tests were authored but not executed ' +
          `(${sandbox.reason ?? 'sandbox unavailable'}), so there is no verified result to hold this PR to.`;
      }
    } catch (err) {
      if (err instanceof PullRequestHeadValidationError) throw err;
      if (err instanceof GitHubApiError && err.status === 403) {
        // Honest degradation: the App lacks `contents: write`. Tests go inline
        // in the comment; the verdict stays advisory.
        degradedReason =
          'the GitHub App lacks the `contents: write` permission, so I could ' +
          'not push the test branch or open the stacked PR.';
        // HITL: only an operator can grant the permission — escalate a real
        // human ask (fire-and-forget; never blocks or changes this run).
        await assertCurrentHead(`before pd-${ship.name} GitHub-permission HITL page`);
        emitInterruption(env, {
          title: `pd-${ship.name}: GitHub App lacks contents:write on ${prCtx.owner}/${prCtx.repo}`,
          body:
            `While reviewing PR #${prCtx.prNumber} of ${prCtx.owner}/${prCtx.repo}, ` +
            `pd-${ship.name} got a 403 pushing its adversarial-test branch: the GitHub App ` +
            `installation lacks the \`contents: write\` permission. Tests were degraded to an ` +
            `inline comment and the verdict stayed advisory. Grant the App \`contents: write\` ` +
            `(GitHub → Settings → Installed GitHub Apps) so the purser can stack test PRs again.`,
          urgency: 'high',
          sourceAgent: `fleet-executor/${ship.name}`,
          ...(runId ? { sourceSession: runId } : {}),
          ...(prCtx.installationId ? { installationId: prCtx.installationId } : {}),
        });
      } else {
        degradedReason = `stacking failed (${String(err).slice(0, 200)}).`;
      }
    }
    await transcript.step(
      'purser-stacked',
      ship.name,
      stackedPr
        ? `pd-${ship.name}: stacked tests as #${stackedPr.number}${retargeted ? ' (PR retargeted onto tests)' : ''}`
        : `pd-${ship.name}: stacking degraded`,
      {
        testPrNumber: stackedPr?.number ?? null,
        testPrUrl: stackedPr?.url ?? null,
        retargeted,
        sandboxExecuted: sandbox.executed,
        ...(degradedReason ? { degraded: degradedReason } : {}),
        ...(retargetSkipReason ? { retargetSkipped: retargetSkipReason } : {}),
      },
    );

    // --- Comment (always posted: the demands are the product) ---------------
    await assertCurrentHead(`before pd-${ship.name} Purser result comment`);
    await postShipComment(
      prCtx.owner,
      prCtx.repo,
      prCtx.prNumber,
      ship.name,
      ship.role,
      buildPurserComment({
        prCtx,
        steel,
        files,
        sandbox,
        stackedPr,
        retargeted,
        degradedReason,
        isFork: prCtx.isFork,
        retargetSkipReason,
      }),
      token,
      assertCurrentHead,
    );

    // --- e. VERDICT ---------------------------------------------------------
    // Stacking degraded (403 / Git Data failure) ⇒ the fleet's machinery could
    // not do its job. The comment above still carries the contract + inline
    // tests (honest degradation), and the interruption escalated the human
    // ask — but the run must not stay green over it: `errored` fails the run
    // until the permission/failure is fixed (broken-ship doctrine). A sandbox
    // FAILURE observed before the degradation still reads as BLOCK.
    if (degradedReason && !stackedPr) {
      const verdict: Verdict =
        sandbox.executed && sandbox.passed === false ? 'BLOCK' : brokenShip.verdict;
      return { ...brokenShip, verdict };
    }

    let verdict: Verdict;
    if (sandbox.executed) {
      // BLOCK while sandbox-executed tests fail on the PR head.
      verdict = sandbox.passed ? 'PASS' : 'BLOCK';
    } else {
      // Never block on tests that were never run — unless the operator
      // explicitly opted into fail-closed via blockWithoutSandbox.
      verdict = ship.blockWithoutSandbox ? 'BLOCK' : 'PASS';
      if (ship.blockWithoutSandbox) {
        // HITL: the operator chose fail-closed and the sandbox binding is
        // absent — this PR is now BLOCKED pending a human. Escalate a real ask
        // (fire-and-forget; the BLOCK verdict above stands regardless).
        await assertCurrentHead(`before pd-${ship.name} sandbox-absence HITL page`);
        emitInterruption(env, {
          title: `pd-${ship.name}: BLOCK on ${prCtx.owner}/${prCtx.repo}#${prCtx.prNumber} — sandbox absent, blockWithoutSandbox set`,
          body:
            `pd-${ship.name} authored adversarial tests for PR #${prCtx.prNumber} of ` +
            `${prCtx.owner}/${prCtx.repo} but could not EXECUTE them: no SANDBOX binding is ` +
            `provisioned${sandbox.reason ? ` (${sandbox.reason})` : ''}. Because this ship sets ` +
            `\`blockWithoutSandbox: true\`, the verdict is a fail-closed BLOCK until a human acts. ` +
            `Either provision the sandbox binding (wrangler.toml [containers]) or relax ` +
            `\`blockWithoutSandbox\` in pd-fleet.yml, then re-run the fleet on the PR.`,
          urgency: 'critical',
          sourceAgent: `fleet-executor/${ship.name}`,
          ...(runId ? { sourceSession: runId } : {}),
          ...(prCtx.installationId ? { installationId: prCtx.installationId } : {}),
        });
      }
    }
    return { ship: ship.name, blocking: ship.blocking, verdict, errored: false, findings: [] };
  } catch (err) {
    if (err instanceof PullRequestHeadValidationError) throw err;
    if (err instanceof FleetAiDependencyError) {
      const failure = err.failure;
      await transcript.step(
        'ship-error',
        ship.name,
        `pd-${ship.name}: ERROR — ${failure.summary}`,
        {
          error: failure.summary,
          status: failure.status,
          code: failure.code,
          retryable: failure.retryable,
          providerCircuitOpen: aiCircuit.isOpen,
          providerAttempt,
        },
      );

      if (failure.retryable && providerAttempt < PROVIDER_MAX_DELIVERY_ATTEMPTS) {
        throw err;
      }

      await transcript.step(
        'ship-verdict',
        ship.name,
        `pd-${ship.name}: ${ship.blocking ? 'BLOCK' : 'PASS'} (errored)`,
        { errored: true },
      );
      return {
        ...brokenShip,
        failureReason: failure.summary,
        ...(failure.retryable
          ? {
              brokenAdjudicated: {
                scope: 'fleet' as const,
                reason:
                  `Workers AI dependency circuit remained open through ` +
                  `${providerAttempt}/${PROVIDER_MAX_DELIVERY_ATTEMPTS} provider attempts`,
              },
            }
          : {}),
      };
    }
    // An unexpected crash is the definition of a broken ship: it surfaces as
    // an errored result under the ship's real blocking flag, which fails the
    // run (broken-ship doctrine, 2026-08-19). The verdict word is never a
    // fabricated judgment — `errored` is the authoritative signal.
    console.error(`[fleet-executor] pd-${ship.name} crashed: ${String(err)}`);
    await transcript.step(
      'ship-verdict',
      ship.name,
      `pd-${ship.name}: ${ship.blocking ? 'BLOCK' : 'PASS'} (errored — broken ship, fails the run)`,
      {
        errored: true,
        error: String(err).slice(0, 300),
      },
    );
    return {
      ship: ship.name,
      blocking: ship.blocking,
      verdict: ship.blocking ? 'BLOCK' : 'PASS',
      errored: true,
      findings: [],
    };
  }
}

/**
 * Render the test PR's body.
 *
 * DESIGN / MOTIVATION: this body is not decoration — it is the thing the
 * reviewed PR now merges through, so it must be BOTH legible to a human and
 * acceptable to the repo's own PR gates. Before the deadlock fix it was only
 * the former: the gates bounced it (`needs-roadmap-link`,
 * `needs-comment-replies`, `mergeable_state: blocked`) and, because the purser
 * retargets the reviewed PR onto this branch, a blocked test PR meant the
 * REVIEWED PR could never merge either. {@link fleetPrBodyTrailers} appends the
 * guards' own audited exemption markers with specific reasons, so the branch is
 * self-clearing without any gate being weakened.
 *
 * @param prCtx The PR under review (supplies its number for the cross-links).
 * @param steel The steel-manned contract these tests grill.
 * @param files The authored test files, listed so a reader can audit the demand.
 * @returns The full markdown body for the stacked test PR.
 */
function buildTestPrBody(
  prCtx: PRContext,
  steel: SteelManContract,
  files: StackedFile[],
): string {
  return [
    `Adversarial tests for #${prCtx.prNumber}, authored by the purser against the ` +
      `steel-manned contract of that PR — its best interpretation, which it must ` +
      `satisfy to merge.`,
    `**Purpose (as steel-manned):** ${steel.purpose}`,
    `**Obligations under test:**\n${renderObligations(steel)}`,
    `**Test files and intent:**\n${files
      .map(f => `- \`${f.path}\` — grills the contract above with adversarial edge cases`)
      .join('\n')}`,
    `#${prCtx.prNumber} is retargeted onto this branch when it lives in this repo, ` +
      `so it merges THROUGH these tests. Dispute a test here, with reasons, if it ` +
      `misreads the contract.`,
    fleetPrBodyTrailers(
      `adversarial test branch for #${prCtx.prNumber}; it advances no roadmap item of its own — ` +
        `the item (if any) belongs to #${prCtx.prNumber}, and claiming it here would double-count the work`,
    ),
  ].join('\n\n');
}
