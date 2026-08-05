/**
 * Optional sandboxed test execution for the purser ship.
 *
 * FEATURE-FLAGGED on the presence of an `env.SANDBOX` binding (Cloudflare
 * Sandboxes / the `@cloudflare/sandbox` SDK, Containers beta — see the
 * commented block in wrangler.toml.example). The dependency is NOT installed;
 * the minimal structural types below cover exactly the surface we call, so the
 * worker builds and tests run with or without the SDK present.
 *
 * NULL-OBJECT FALLBACK: when the binding is absent (the default deploy), the
 * runner returns `executed: false` with an honest reason and NEVER fabricates
 * pass/fail. The purser's verdict logic treats "tests never ran" separately
 * from "tests ran and failed" — see src/purser.ts.
 */

import type { StackedFile } from './stacked-pr.js';

export interface SandboxRunOutcome {
  /** True only when the test command actually ran to completion in a sandbox. */
  executed: boolean;
  /** Exit-code-derived pass/fail. `null` when not executed — never fabricated. */
  passed: boolean | null;
  /** Tail of combined stdout+stderr (capped to 1 KB). Empty when not executed. */
  outputTail: string;
  /**
   * Names of the individual tests that FAILED, extracted from the runner's
   * output.
   *
   * WHY THIS IS CAPTURED HERE and not derived later: {@link outputTail} keeps
   * only the last {@link OUTPUT_TAIL_BYTES} of output, and a failing suite's
   * summary is frequently longer than that — the individual failure lines are
   * usually the FIRST thing printed and the tail is the last. Anything trying
   * to name the failures from the tail alone would silently report a subset,
   * or none, and read as if the suite were fine. So the extraction happens at
   * the one point where the complete output still exists.
   *
   * Empty when the suite passed, when nothing was executed, or when the
   * runner's format was not recognised — an empty list NEVER means "no
   * failures", only "no failures I can name". Callers must key correctness off
   * {@link passed} and treat this as detail.
   */
  failures: string[];
  /** Why execution did not happen (binding absent, sandbox error). Null on success. */
  reason: string | null;
}

/** Cap on the output tail we keep for the transcript / comment. */
export const OUTPUT_TAIL_BYTES = 1024;

/** Most failures we will name individually before saying "and N more". */
export const MAX_NAMED_FAILURES = 25;

/**
 * Pull the individual failing test names out of a runner's combined output.
 *
 * The purser authors tests for whatever the repo under review already uses, so
 * this cannot assume one runner. It recognises the shapes that actually turn up
 * in this fleet's targets:
 *
 *   vitest / jest   `× suite > case`, `✕ suite > case`, `FAIL path/to/spec.ts`
 *   node:test / TAP `not ok 3 - the case name`
 *   pytest          `FAILED tests/test_x.py::test_case - AssertionError`
 *   go test         `--- FAIL: TestThing (0.00s)`
 *
 * Deliberately conservative. A line must look like a runner's own failure
 * record to count; prose that merely contains the word "failed" does not. Over-
 * reporting here would be worse than under-reporting, because these names are
 * shown to a PR author as "this is what you must fix" — inventing one sends
 * them hunting for a test that does not exist.
 *
 * @param output Combined stdout+stderr, complete and untruncated.
 * @returns Deduped failing-test names in first-seen order, capped at
 *          {@link MAX_NAMED_FAILURES}. Empty when none are recognisable.
 */
export function parseTestFailures(output: string): string[] {
  const patterns: RegExp[] = [
    // vitest/jest per-case markers. The leading marker is required, so a
    // summary line like "Tests 3 failed" cannot match.
    /^\s*(?:×|✕|✗)\s+(.{3,200}?)\s*$/,
    // vitest/jest file-level failure.
    /^\s*FAIL\s+(\S.{2,200}?)\s*$/,
    // TAP (node:test, tap, ava). Captures the description after the number.
    /^\s*not ok\s+\d+\s*[-–]\s*(.{3,200}?)\s*$/,
    // pytest.
    /^\s*FAILED\s+(\S.{2,200}?)(?:\s+-\s+.*)?$/,
    // go test.
    /^\s*---\s+FAIL:\s+(\S.{2,200}?)\s*(?:\([\d.]+s\))?\s*$/,
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    // Strip ANSI colour so a coloured `×` still matches.
    const line = rawLine.replace(/\[[0-9;]*m/g, '');
    for (const re of patterns) {
      const m = re.exec(line);
      if (!m) continue;
      const name = m[1].trim();
      // Skip runner chatter that survives the shape check.
      if (!name || /^\d+\s*(tests?|files?)\b/i.test(name)) break;
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
      break; // one pattern per line is enough
    }
    if (out.length >= MAX_NAMED_FAILURES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Minimal structural types for the @cloudflare/sandbox surface we use. We do
// NOT import the SDK: the binding arrives as `unknown` and is duck-typed here.

interface ExecResultLike {
  exitCode?: number;
  success?: boolean;
  stdout?: string;
  stderr?: string;
}

interface SandboxInstanceLike {
  exec(command: string, options?: Record<string, unknown>): Promise<ExecResultLike>;
}

/**
 * Duck-type the binding into something with `.exec()`:
 *   - a direct instance/stub exposing `exec` (tests, future SDK shapes), or
 *   - a Durable Object namespace (`idFromName` + `get`) as `@cloudflare/sandbox`
 *     binds it, resolved to a per-run instance by `instanceId`.
 * Returns null when the binding is absent or unrecognizable.
 */
export function resolveSandbox(binding: unknown, instanceId: string): SandboxInstanceLike | null {
  if (!binding || typeof binding !== 'object') return null;
  const b = binding as Record<string, unknown>;
  if (typeof b.exec === 'function') return b as unknown as SandboxInstanceLike;
  if (typeof b.idFromName === 'function' && typeof b.get === 'function') {
    try {
      const id = (b.idFromName as (name: string) => unknown)(instanceId);
      const stub = (b.get as (id: unknown) => unknown)(id);
      if (stub && typeof (stub as Record<string, unknown>).exec === 'function') {
        return stub as SandboxInstanceLike;
      }
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------

/** UTF-8 → base64 without btoa's latin-1 limitation (contents are model text). */
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** POSIX-quote a string for embedding in a shell script. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export interface SandboxRunParams {
  /** The raw `env.SANDBOX` binding (or undefined when not deployed). */
  sandboxBinding: unknown;
  owner: string;
  repo: string;
  /** The PR head SHA the tests are executed AGAINST. */
  headSha: string;
  /** The purser-authored test files to graft into the checkout. */
  files: StackedFile[];
  /** Installation token used for the authenticated clone. */
  token: string;
  /**
   * The repo's test runner invocation. Defaults to `npm test` after an
   * `npm ci`; repos with another runner can be supported later via config.
   */
  testCommand?: string;
}

/**
 * Execute the repo's test runner with the purser's new tests grafted in,
 * against the PR head, inside a Cloudflare Sandbox. ONE composed script, one
 * `exec` call, exit code = verdict. Never throws: every failure mode returns an
 * honest `executed: false` outcome instead.
 */
export async function runTestsInSandbox(params: SandboxRunParams): Promise<SandboxRunOutcome> {
  const sandbox = resolveSandbox(
    params.sandboxBinding,
    `purser-${params.owner}-${params.repo}-${params.headSha}`,
  );
  if (!sandbox) {
    return {
      executed: false,
      passed: null,
      outputTail: '',
      failures: [],
      reason: 'SANDBOX binding absent — tests were NOT executed (no fabricated results)',
    };
  }

  const testCommand = params.testCommand ?? 'npm ci --no-audit --no-fund && npm test';
  const cloneUrl = `https://x-access-token:${params.token}@github.com/${params.owner}/${params.repo}.git`;

  // Compose ONE script: shallow-fetch the head SHA, graft the test files in
  // (base64 so contents survive quoting), run the test command.
  const lines: string[] = [
    'set -e',
    'mkdir -p /work && cd /work',
    `git init -q repo && cd repo`,
    `git remote add origin ${shq(cloneUrl)}`,
    `git fetch -q --depth 1 origin ${shq(params.headSha)}`,
    `git checkout -q ${shq(params.headSha)}`,
  ];
  for (const f of params.files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    lines.push(`mkdir -p ${shq(dir)}`);
    lines.push(`printf '%s' ${shq(toBase64(f.contents))} | base64 -d > ${shq(f.path)}`);
  }
  lines.push(testCommand);
  const script = lines.join('\n');

  try {
    const res = await sandbox.exec(`bash -lc ${shq(script)}`);
    const stdout = typeof res.stdout === 'string' ? res.stdout : '';
    const stderr = typeof res.stderr === 'string' ? res.stderr : '';
    const combined = `${stdout}${stderr ? `\n${stderr}` : ''}`;
    const passed =
      typeof res.exitCode === 'number' ? res.exitCode === 0 : res.success === true;
    return {
      executed: true,
      passed,
      outputTail: combined.slice(-OUTPUT_TAIL_BYTES),
      // Parsed from the COMPLETE output, before the tail truncation above.
      failures: passed ? [] : parseTestFailures(combined),
      reason: null,
    };
  } catch (err) {
    return {
      executed: false,
      passed: null,
      outputTail: '',
      failures: [],
      reason: `sandbox exec failed: ${String(err).slice(0, 300)}`,
    };
  }
}
