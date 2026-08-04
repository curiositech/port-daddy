/**
 * The PURSER — an adversarial, obstreperous gatekeeper ship.
 *
 * Where the reviewer ships critique the diff as written, the purser holds the
 * PR to the STRONGEST interpretation of what it claims to do:
 *
 *   a. STEEL-MAN — one AI call over the PR title/body/diff produces the
 *      best-interpretation contract: purpose + testable obligations[] +
 *      testTargets[]. Malformed output ⇒ transcript error, advisory PASS, stop
 *      (the purser never bluffs).
 *   b. AUTHOR TESTS — a second AI call authors adversarial unit + integration
 *      test files that grill the contract's edge cases. Files are validated by
 *      the stacked-pr path whitelist + size caps (model output is untrusted).
 *   c. SANDBOX (feature-flagged) — when env.SANDBOX exists, the repo's test
 *      runner executes the new tests against the PR head in a Cloudflare
 *      Sandbox. Absent binding ⇒ executed:false, NEVER fabricated results.
 *   d. STACK — branch `purser/pr-<n>-tests` is cut from the PR's BASE sha, a
 *      test PR is opened for it, and the reviewed PR is RETARGETED onto the
 *      test branch so it sits stacked on top of the tests and must satisfy
 *      them. Fork PRs get the test PR + a comment but NO retarget. A 403
 *      (App lacks `contents: write`) degrades honestly: tests are posted
 *      inline in a comment, the missing permission is named, and the verdict
 *      stays advisory.
 *   e. VERDICT — blocking iff pd-fleet.yml says `blocking: true`. BLOCK while
 *      sandbox-executed tests fail on the PR head. Sandbox unavailable ⇒ the
 *      `blockWithoutSandbox` flag decides (default false ⇒ advisory): the
 *      purser never blocks on tests that were never run unless the operator
 *      explicitly opted into fail-closed.
 *
 * Comment tone: firm, adversarial, professional. Demands, with reasons.
 * Never abusive.
 */

import type { ExecutorEnv } from './env.js';
import type { ShipConfig } from './fleet.js';
import type { ShipResult, Verdict } from './verdict.js';
import { postShipComment, type PRContext } from './github.js';
import { extractAiText, describeResponseShape } from './ai-response.js';
import { extractWorkersAiUsage } from './telemetry.js';
import { stripThinkSpans } from './xo.js';
import {
  createOrUpdateBranch,
  openStackedPr,
  retargetPrBase,
  validateStackedFiles,
  GitHubApiError,
  type StackedFile,
  type StackedPrResult,
} from './stacked-pr.js';
import { runTestsInSandbox, type SandboxRunOutcome } from './sandbox-runner.js';
import { fleetPrBodyTrailers } from './fleet-pr-body.js';
import { emitSquidEvent } from './squid-events.js';
import { emitInterruption } from './interruptions.js';

// ---------------------------------------------------------------------------

/** Output cap for the steel-man call (a contract is small). */
const STEELMAN_MAX_TOKENS = 2048;
/** Output cap for the test-authoring call (test files are not small). */
const TESTS_MAX_TOKENS = 4096;
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
 * When nothing parses, the purser still degrades honestly to an advisory PASS.
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
 * a malformed steel-man means the purser stops (advisory PASS), it never
 * improvises a contract the author will then be held to.
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

function steelManSystemPrompt(ship: ShipConfig, graftText: string): string {
  return (
    graftText +
    `${ship.prompt}\n\n` +
    `You are pd-${ship.name}, running the STEEL-MAN phase. Read the PR title, ` +
    `description, and diff, and construct the STRONGEST, most complete ` +
    `interpretation of what this change is obligated to do — the contract its ` +
    `author would claim if pressed. Not its laziest reading: its best one.\n\n` +
    `Output EXACTLY one fenced JSON object and nothing else:\n\n` +
    '```json\n' +
    '{\n' +
    '  "purpose": "<one-sentence statement of what this PR is for>",\n' +
    '  "contract": { "obligations": ["<testable obligation>", "..."] },\n' +
    '  "testTargets": ["<file/module/behavior the tests should target>", "..."]\n' +
    '}\n' +
    '```\n\n' +
    `Each obligation must be TESTABLE — a concrete behavior a unit or ` +
    `integration test can verify, including the edge cases the diff implies ` +
    `but may not handle.`
  );
}

function testAuthorSystemPrompt(ship: ShipConfig, steel: SteelManContract, graftText: string): string {
  const pathNote =
    ship.testPaths.length > 0
      ? `Every file path MUST live under one of these prefixes: ${ship.testPaths.join(', ')}.\n`
      : '';
  return (
    graftText +
    `You are pd-${ship.name}, running the ADVERSARIAL TEST AUTHORING phase. ` +
    `You hold this contract for the PR (its best interpretation):\n\n` +
    `Purpose: ${steel.purpose}\n` +
    `Obligations:\n${steel.obligations.map(o => `- ${o}`).join('\n')}\n` +
    (steel.testTargets.length ? `Test targets:\n${steel.testTargets.map(t => `- ${t}`).join('\n')}\n` : '') +
    `\nWrite adversarial unit + integration tests that GRILL this contract: ` +
    `edge cases, boundary values, error paths, concurrency and idempotency ` +
    `where relevant. The PR must satisfy its best interpretation, not its ` +
    `laziest. Use the repo's existing test framework and idioms as evident ` +
    `from the diff.\n\n` +
    pathNote +
    `Paths must be relative (no leading '/', no '..'), at most 10 files, each ` +
    `under 48KB.\n\n` +
    `Output EXACTLY one fenced JSON object and nothing else:\n\n` +
    '```json\n' +
    '{ "files": [ { "path": "<repo-relative test file path>", "contents": "<full file contents>" } ] }\n' +
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
): Promise<{ text: string; res: unknown }> {
  const request = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    ...(ship.temperature === null ? {} : { temperature: ship.temperature }),
  };
  const res = await env.AI.run(
    ship.cfModel as Parameters<typeof env.AI.run>[0],
    request,
    aiOptions(env, ship.name),
  );
  const { text } = extractAiText(res);
  accumulate(metrics, res, text);
  return { text, res };
}

// ---------------------------------------------------------------------------
// Comment rendering — firm, adversarial, professional. Demands, with reasons.

function renderObligations(steel: SteelManContract): string {
  return steel.obligations.map((o, i) => `${i + 1}. ${o}`).join('\n');
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
  return (
    `**Execution: RAN — FAILED.** The PR head does NOT satisfy its own ` +
    `best-interpretation contract. Failing output (tail):\n\n` +
    '```\n' +
    sandbox.outputTail.slice(-FAILURE_TAIL_BYTES) +
    '\n```'
  );
}

function renderTestList(files: StackedFile[]): string {
  return files.map(f => `- \`${f.path}\``).join('\n');
}

function renderInlineTests(files: StackedFile[]): string {
  return files
    .map(f => `#### \`${f.path}\`\n\n\`\`\`\n${f.contents}\n\`\`\``)
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
 * Run the purser against one PR. Never throws — every failure mode resolves to
 * an honest ShipResult + transcript trail. See the module doc for the phases.
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
): Promise<ShipResult> {
  const advisoryPass: ShipResult = {
    ship: ship.name,
    blocking: false,
    verdict: 'PASS',
    errored: false,
    findings: [],
  };

  try {
    // --- a. STEEL-MAN -------------------------------------------------------
    const steelCall = await purserAiCall(
      ship,
      env,
      steelManSystemPrompt(ship, graftText),
      prBlock(prCtx),
      STEELMAN_MAX_TOKENS,
      metrics,
    );
    const steel = parseSteelMan(steelCall.text);
    if (!steel) {
      await transcript.step('purser-steelman', ship.name, `pd-${ship.name}: steel-man MALFORMED`, {
        error: 'steel-man output was not the required fenced JSON contract',
        responseShape: steelCall.text ? undefined : describeResponseShape(steelCall.res),
        outputLength: steelCall.text.length,
      });
      return advisoryPass;
    }
    await transcript.step(
      'purser-steelman',
      ship.name,
      `pd-${ship.name}: steel-manned contract (${steel.obligations.length} obligation(s))`,
      {
        purpose: steel.purpose,
        obligationCount: steel.obligations.length,
        testTargets: steel.testTargets,
      },
    );

    // --- b. AUTHOR TESTS ----------------------------------------------------
    const testsCall = await purserAiCall(
      ship,
      env,
      testAuthorSystemPrompt(ship, steel, graftText),
      prBlock(prCtx),
      TESTS_MAX_TOKENS,
      metrics,
    );
    const files = parseAuthoredFiles(testsCall.text);
    if (!files) {
      await transcript.step('purser-tests', ship.name, `pd-${ship.name}: test authoring MALFORMED`, {
        error: 'test-author output was not the required fenced JSON files block',
        outputLength: testsCall.text.length,
      });
      return advisoryPass;
    }
    const validation = validateStackedFiles(files);
    if (!validation.ok) {
      await transcript.step('purser-tests', ship.name, `pd-${ship.name}: authored tests REJECTED`, {
        error: validation.reason,
        fileCount: files.length,
      });
      return advisoryPass;
    }
    if (ship.testPaths.length > 0) {
      const stray = files.find(f => !ship.testPaths.some(g => f.path === g || f.path.startsWith(`${g}/`)));
      if (stray) {
        await transcript.step('purser-tests', ship.name, `pd-${ship.name}: authored tests REJECTED`, {
          error: `path outside testPaths prefixes (${ship.testPaths.join(', ')}): ${stray.path}`,
        });
        return advisoryPass;
      }
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
      },
    );

    // --- c. SANDBOX (feature-flagged; honest when absent) -------------------
    const sandbox = await runTestsInSandbox({
      sandboxBinding: env.SANDBOX,
      owner: prCtx.owner,
      repo: prCtx.repo,
      headSha: prCtx.headSha,
      files,
      token,
    });
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
    const branchName = `purser/pr-${prCtx.prNumber}-tests`;
    const baseBranch = prCtx.baseRef || env.DEFAULT_BRANCH || 'main';
    let stackedPr: StackedPrResult | null = null;
    let retargeted = false;
    let degradedReason: string | null = null;

    try {
      await createOrUpdateBranch(
        prCtx.owner,
        prCtx.repo,
        branchName,
        prCtx.baseSha,
        files,
        `purser: adversarial tests for #${prCtx.prNumber}`,
        token,
      );
      stackedPr = await openStackedPr(
        prCtx.owner,
        prCtx.repo,
        branchName,
        baseBranch,
        `purser: adversarial tests for #${prCtx.prNumber}`,
        buildTestPrBody(prCtx, steel, files),
        ['purser', 'adversarial-tests'],
        token,
      );
      // Cloud squid: announce the stacked test PR (fire-and-forget, never blocks).
      emitSquidEvent(env, 'pr-stacked', {
        repo: `${prCtx.owner}/${prCtx.repo}`,
        pr: prCtx.prNumber,
        runId,
        ship: ship.name,
        url: stackedPr.url,
      }, squidConsent);
      // GUARD: only same-repo (non-fork) PRs are retargeted onto the tests.
      if (!prCtx.isFork) {
        try {
          await retargetPrBase(prCtx.owner, prCtx.repo, prCtx.prNumber, branchName, token);
          retargeted = true;
        } catch (err) {
          console.error(
            `[fleet-executor] pd-${ship.name} retarget #${prCtx.prNumber} failed: ${String(err)}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 403) {
        // Honest degradation: the App lacks `contents: write`. Tests go inline
        // in the comment; the verdict stays advisory.
        degradedReason =
          'the GitHub App lacks the `contents: write` permission, so I could ' +
          'not push the test branch or open the stacked PR.';
        // HITL: only an operator can grant the permission — escalate a real
        // human ask (fire-and-forget; never blocks or changes this run).
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
        ...(degradedReason ? { degraded: degradedReason } : {}),
      },
    );

    // --- Comment (always posted: the demands are the product) ---------------
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
      }),
      token,
    );

    // --- e. VERDICT ---------------------------------------------------------
    // 403 degradation ⇒ verdict stays advisory regardless of flags.
    if (degradedReason && !stackedPr) {
      const verdict: Verdict =
        sandbox.executed && sandbox.passed === false ? 'BLOCK' : 'PASS';
      return { ship: ship.name, blocking: false, verdict, errored: false, findings: [] };
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
    // The purser's philosophy: it never blocks on work it could not do. An
    // unexpected crash surfaces as an advisory errored result (⇒ neutral
    // conclusion at worst), never a fabricated BLOCK.
    console.error(`[fleet-executor] pd-${ship.name} crashed: ${String(err)}`);
    await transcript.step('ship-verdict', ship.name, `pd-${ship.name}: PASS (errored)`, {
      errored: true,
      error: String(err).slice(0, 300),
    });
    return { ship: ship.name, blocking: false, verdict: 'PASS', errored: true, findings: [] };
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
