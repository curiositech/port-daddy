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

import { isCoordinationScopeId } from '../../../lib/coordination-ledger.js';
import type {
  CoordinationGrantServiceContract,
  FleetCoordinationGrant,
} from '../../../lib/coordination-grant-contract.js';
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
  /**
   * Structured interpretation of the runner result. `assertion-failure` is
   * reserved for a Jest JSON result that reports failed test cases; setup,
   * module-load, discovery, and zero-test failures are `harness-failure` and
   * must never be presented as product-code evidence.
   *
   * Optional during the staged rollout so persisted outcomes from the prior
   * executor remain readable. Fresh sandbox runs always set it.
   */
  outcomeKind?:
    | 'not-executed'
    | 'passed'
    | 'assertion-failure'
    | 'harness-failure'
    | 'unclassified-failure';
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
    // \u001b escape rather than a literal ESC byte: the literal is invisible in
    // most editors and is easily eaten by a formatter or a copy-paste.
    const line = rawLine.replace(/\u001b\[[0-9;]*m/g, '');
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

interface SandboxProcessLike {
  waitForPort(port: number, options?: Record<string, unknown>): Promise<unknown>;
  kill(): Promise<unknown>;
}

interface SandboxInstanceLike {
  exec(command: string, options?: Record<string, unknown>): Promise<ExecResultLike>;
  startProcess?(
    command: string,
    options?: Record<string, unknown>,
  ): Promise<SandboxProcessLike>;
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
   * The repo's test runner invocation. Defaults to `npm test -- <authored
   * paths>` after an `npm ci`; repos with another runner can be supported
   * later via config.
   */
  testCommand?: string;
  /**
   * Optional ADR-0092 cloud coordination room. When present, the sandbox
   * builds and boots the repository's real compiled pd daemon before running
   * tests, and that daemon joins the room as an ordinary offline-first peer.
   */
  coordinationEnrollment?: SandboxCoordinationEnrollment;
}

export interface SandboxCoordinationEnrollment {
  /** Relay origin hosting /v1/coordination/:project/sync. */
  url: string;
  /** GitHub-verified owner/repository scope requested from Relay. */
  project: string;
  /** Durable Fleet run identity requested from Relay. */
  actorId: string;
  /** Service-binding capability; never passed into the sandbox. */
  grants: CoordinationGrantServiceContract;
}

export interface SandboxCoordinationPeer {
  url: string;
  project: string;
  actorId: string;
  /** Unique daemon/process replica id, generated for this sandbox grant. */
  replicaId: string;
  /** Scoped ADR-0092 macaroon. Never written into the cloned checkout. */
  macaroon: string;
}

interface SandboxCoordinationEnrollmentEnv {
  PORT_DADDY_COORDINATION_URL?: unknown;
  COORDINATION_GRANTS?: unknown;
}

interface SandboxCoordinationRunIdentity {
  /** GitHub-verified owner/repository name. */
  project: string;
  /** Durable Fleet run id, for example run:<delivery-id>. */
  runId: string;
}

const DEFAULT_INSTALL_COMMAND =
  'npm ci --no-audit --no-fund --onnxruntime-node-install=skip';

const CLOUD_PEER_ROOT = '/work/pd-peer';
const CLOUD_PEER_WITNESS_ROOT = '/work/pd-peer-witness';
const REPOSITORY_ROOT = '/work/repo';
const TEST_STARTED_MARKER = '__PD_PURSER_TEST_STARTED__';
const JEST_SUMMARY_MARKER = '__PD_PURSER_JEST_SUMMARY__:';
const JEST_RESULT_PATH = '/work/pd-purser-jest-result.json';
const COORDINATION_SYNC_VERB = 'coordination-sync';
const COORDINATION_GRANT_TTL_SECONDS = 60 * 60;
const MIN_REMAINING_GRANT_LIFETIME_MS = 30_000;
const MAX_GRANT_CLOCK_SKEW_MS = 60_000;

function newSandboxReplicaId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `fleet-peer-${[...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

interface JestRunSummary {
  numFailedTests: number;
  numFailedTestSuites: number;
  numPassedTests: number;
  numRuntimeErrorTestSuites: number;
  numTotalTests: number;
  success: boolean;
}

function buildDefaultJestInvocation(
  files: ReadonlyArray<Pick<StackedFile, 'path'>>,
): string {
  const authoredPaths = files.map(file => shq(file.path)).join(' ');
  return (
    `npm test -- --runTestsByPath ${authoredPaths} ` +
    `--json --outputFile=${shq(JEST_RESULT_PATH)}`
  );
}

function parseJestSummary(output: string): JestRunSummary | null {
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith(JEST_SUMMARY_MARKER)) continue;
    try {
      const encoded = line.slice(JEST_SUMMARY_MARKER.length);
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<JestRunSummary>;
      const numericKeys: Array<keyof JestRunSummary> = [
        'numFailedTests',
        'numFailedTestSuites',
        'numPassedTests',
        'numRuntimeErrorTestSuites',
        'numTotalTests',
      ];
      if (
        numericKeys.every(key => Number.isInteger(value[key]) && Number(value[key]) >= 0) &&
        typeof value.success === 'boolean'
      ) {
        return value as JestRunSummary;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function withoutProtocolMarkers(output: string): string {
  return output
    .split(/\r?\n/)
    .filter(line => line !== TEST_STARTED_MARKER && !line.startsWith(JEST_SUMMARY_MARKER))
    .join('\n');
}

function summarizeJestResultCommand(): string {
  const program =
    "const fs=require('node:fs');" +
    `const r=JSON.parse(fs.readFileSync('${JEST_RESULT_PATH}','utf8'));` +
    "const s={numFailedTests:r.numFailedTests,numFailedTestSuites:r.numFailedTestSuites," +
    "numPassedTests:r.numPassedTests,numRuntimeErrorTestSuites:r.numRuntimeErrorTestSuites," +
    "numTotalTests:r.numTotalTests,success:r.success};" +
    `process.stdout.write('${JEST_SUMMARY_MARKER}'+Buffer.from(JSON.stringify(s)).toString('base64')+'\\n');`;
  return `node -e ${shq(program)}`;
}

/**
 * Resolve the all-or-nothing cloud-peer enrollment from executor bindings and
 * live run context. Project and actor are never static deployment values.
 */
export function sandboxCoordinationEnrollmentFromEnv(
  env: SandboxCoordinationEnrollmentEnv,
  identity: SandboxCoordinationRunIdentity,
): SandboxCoordinationEnrollment | undefined {
  const rawUrl = typeof env.PORT_DADDY_COORDINATION_URL === 'string'
    ? env.PORT_DADDY_COORDINATION_URL.trim()
    : '';
  const grants = env.COORDINATION_GRANTS;
  const hasGrants = Boolean(
    grants
    && typeof grants === 'object'
    && typeof (grants as Record<string, unknown>).mintCoordinationGrant === 'function',
  );
  if (!rawUrl && !hasGrants) return undefined;
  if (!rawUrl || !hasGrants) {
    throw new Error(
      'cloud coordination enrollment requires URL and COORDINATION_GRANTS together',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('cloud coordination URL must be a valid HTTPS origin');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('cloud coordination URL must be a credential-free HTTPS origin');
  }
  if (!isCoordinationScopeId(identity.project, 200)) {
    throw new Error('cloud coordination project must be a valid owner/repository scope');
  }
  if (!isCoordinationScopeId(identity.runId)) {
    throw new Error('cloud coordination run id must be a valid durable scope');
  }
  const actorId = `fleet:${identity.runId}`;
  if (!isCoordinationScopeId(actorId)) {
    throw new Error('cloud coordination run id cannot form a valid actor scope');
  }

  return {
    url: parsed.origin,
    project: identity.project,
    actorId,
    grants: grants as CoordinationGrantServiceContract,
  };
}

function validateCoordinationGrant(
  grant: FleetCoordinationGrant,
  enrollment: SandboxCoordinationEnrollment,
  nowMs = Date.now(),
): SandboxCoordinationPeer {
  if (!grant || typeof grant !== 'object') {
    throw new Error('Relay returned no coordination grant');
  }
  if (grant.project !== enrollment.project || grant.actorId !== enrollment.actorId) {
    throw new Error('Relay returned a coordination grant for a different scope');
  }
  if (grant.verb !== COORDINATION_SYNC_VERB) {
    throw new Error('Relay returned a coordination grant with the wrong verb');
  }
  if (typeof grant.macaroon !== 'string' || grant.macaroon.trim().length === 0) {
    throw new Error('Relay returned an empty coordination macaroon');
  }
  if (
    !Number.isSafeInteger(grant.expiresAt)
    || grant.expiresAt <= nowMs + MIN_REMAINING_GRANT_LIFETIME_MS
  ) {
    throw new Error('Relay returned an expired coordination grant');
  }
  if (
    grant.expiresAt
    > nowMs + COORDINATION_GRANT_TTL_SECONDS * 1000 + MAX_GRANT_CLOCK_SKEW_MS
  ) {
    throw new Error('Relay returned a coordination grant beyond the requested TTL');
  }
  return {
    url: enrollment.url,
    project: enrollment.project,
    actorId: enrollment.actorId,
    replicaId: newSandboxReplicaId(),
    macaroon: grant.macaroon.trim(),
  };
}

async function mintSandboxCoordinationPeer(
  enrollment: SandboxCoordinationEnrollment,
): Promise<SandboxCoordinationPeer> {
  let grant: FleetCoordinationGrant;
  try {
    grant = await enrollment.grants.mintCoordinationGrant({
      project: enrollment.project,
      actorId: enrollment.actorId,
      ttlSeconds: COORDINATION_GRANT_TTL_SECONDS,
    });
  } catch {
    throw new Error('Relay coordination grant RPC failed');
  }
  return validateCoordinationGrant(grant, enrollment);
}

/**
 * Non-secret repository preparation for the real pd peer. Process launch is
 * deliberately separate: the scoped macaroon is supplied only to
 * `startProcess`, never to an `exec` that runs npm lifecycle or test code.
 */
export function buildSandboxDaemonBootstrap(
  peer?: Pick<SandboxCoordinationPeer, 'macaroon'>,
): string[] {
  void peer;
  return [
    'npm run build:bin',
    `mkdir -p ${shq(CLOUD_PEER_ROOT)}`,
    `mkdir -p ${shq(CLOUD_PEER_WITNESS_ROOT)}`,
  ];
}

function cloudPeerDaemonEnv(
  peer: SandboxCoordinationPeer,
  root = CLOUD_PEER_ROOT,
): Record<string, string> {
  return {
    PORT_DADDY_DB: `${root}/registry.db`,
    PORT_DADDY_PREFIX: root,
    PORT_DADDY_SOCK: `${root}/port-daddy.sock`,
    PORT_DADDY_PORT_FILE: `${root}/daemon.port`,
    PORT_DADDY_BIN_OVERRIDE: `${REPOSITORY_ROOT}/dist/port-daddy`,
    PORT_DADDY_NO_FLEET: '1',
    PORT_DADDY_NO_FLEETBAR: '1',
    PORT_DADDY_SILENT: '1',
    PORT_DADDY_DISABLE_KEYCHAIN: '1',
    PORT_DADDY_COORDINATION_INTERVAL_MS: '250',
    PORT_DADDY_COORDINATION_URL: peer.url,
    PORT_DADDY_COORDINATION_PROJECT: peer.project,
    PORT_DADDY_COORDINATION_ACTOR: peer.actorId,
    PORT_DADDY_COORDINATION_REPLICA: peer.replicaId,
    PORT_DADDY_COORDINATION_MACAROON: peer.macaroon,
  };
}

function cloudPeerClientEnv(
  publishedPort: number,
  root = CLOUD_PEER_ROOT,
): Record<string, string> {
  return {
    PORT_DADDY_URL: `http://127.0.0.1:${publishedPort}`,
    PORT_DADDY_DB: `${root}/registry.db`,
    PORT_DADDY_PREFIX: root,
    PORT_DADDY_SOCK: `${root}/port-daddy.sock`,
    PORT_DADDY_PORT_FILE: `${root}/daemon.port`,
    PORT_DADDY_BIN_OVERRIDE: `${REPOSITORY_ROOT}/dist/port-daddy`,
  };
}

/** Accept one strict daemon-published TCP port and reject mixed stdout. */
export function parseSandboxDaemonPublication(output: string): number | null {
  const value = output.trim();
  if (!/^[0-9]+$/.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Accept one strict positive room cursor and reject mixed stdout. */
export function parseSandboxCoordinationCursor(output: string): number | null {
  const value = output.trim();
  if (!/^[0-9]+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor > 0 ? cursor : null;
}

function cloudPeerPublicationProbeCommand(root: string): string {
  const script = [
    "const fs = require('node:fs');",
    `const path = ${JSON.stringify(`${root}/daemon.port`)};`,
    'let attempts = 0;',
    'const poll = () => {',
    '  try {',
    "    const value = fs.readFileSync(path, 'utf8').trim();",
    "    if (/^[0-9]+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) { process.stdout.write(value + '\\n'); process.exit(0); }",
    '  } catch {}',
    "  if (++attempts >= 120) { console.error('daemon endpoint was not published'); process.exit(1); }",
    '  setTimeout(poll, 250);',
    '};',
    'poll();',
  ].join('\n');
  return `node -e ${shq(script)}`;
}

function cloudPeerConvergenceProbeCommand(
  publishedPort: number,
  minimumCursor = 1,
): string {
  const script = [
    `const url = 'http://127.0.0.1:${publishedPort}/coordination/status';`,
    `const minimumCursor = ${minimumCursor};`,
    'let attempts = 0;',
    'const poll = async () => {',
    '  try {',
    '    const response = await fetch(url);',
    '    const status = await response.json();',
    "    if (response.ok && status.connected === true && status.outbox === 0 && Number.isSafeInteger(status.cursor) && status.cursor >= minimumCursor) { process.stdout.write(String(status.cursor) + '\\n'); process.exit(0); }",
    '  } catch {}',
    "  if (++attempts >= 120) { console.error('coordination peer did not durably converge'); process.exit(1); }",
    '  setTimeout(poll, 250);',
    '};',
    'void poll();',
  ].join('\n');
  return `node -e ${shq(script)}`;
}

function cloudPeerWitnessCommand(
  peer: SandboxCoordinationPeer,
  markerPath: string,
  enrollmentNote: string,
): string {
  const script = [
    "const { execFileSync } = require('node:child_process');",
    `const project = ${JSON.stringify(peer.project)};`,
    `const actorId = ${JSON.stringify(peer.actorId)};`,
    `const markerPath = ${JSON.stringify(markerPath)};`,
    `const enrollmentNote = ${JSON.stringify(enrollmentNote)};`,
    `const purpose = ${JSON.stringify('Cloud sandbox coordination peer')};`,
    'const run = (args) => JSON.parse(execFileSync(\'./dist/port-daddy\', args, { encoding: \'utf8\' }));',
    'const metadata = (value) => {',
    '  if (value && typeof value === \'object\' && !Array.isArray(value)) return value;',
    '  if (typeof value !== \'string\') return {};',
    '  try { const parsed = JSON.parse(value); return parsed && typeof parsed === \'object\' ? parsed : {}; } catch { return {}; }',
    '};',
    'let attempts = 0;',
    'const poll = () => {',
    '  try {',
    "    const sessions = run(['sessions', '--project', project, '--all-worktrees', '--json']);",
    "    const ownership = run(['who-owns', markerPath, '--json']);",
    "    const notes = run(['notes', '--project', project, '--limit', '200', '--json']);",
    '    const session = Array.isArray(sessions.sessions)',
    '      ? sessions.sessions.find((value) => {',
    '          const m = metadata(value.metadata);',
    '          return value.purpose === purpose && (m.semanticIdentity === actorId || m.identity === actorId);',
    '        })',
    '      : null;',
    '    const owned = Boolean(session && Array.isArray(ownership.owners)',
    '      && ownership.owners.some((value) => value.sessionId === session.id));',
    '    const noted = Boolean(session && Array.isArray(notes.notes)',
    '      && notes.notes.some((value) => value.sessionId === session.id && value.content === enrollmentNote));',
    '    if (session && owned && noted) {',
    "      process.stdout.write('CLOUD_PEER_WITNESS_OK ' + session.id + '\\n');",
    '      process.exit(0);',
    '    }',
    '  } catch {}',
    "  if (++attempts >= 120) { console.error('fresh cloud peer did not read the exact session, claim, and note'); process.exit(1); }",
    '  setTimeout(poll, 250);',
    '};',
    'poll();',
  ].join('\n');
  return `node -e ${shq(script)}`;
}

function buildRunnerScript(
  files: ReadonlyArray<Pick<StackedFile, 'path'>>,
  testCommand: string | undefined,
): { script: string; usesDefaultJestRunner: boolean } {
  const usesDefaultJestRunner = testCommand === undefined;
  const invocation = testCommand ?? buildDefaultJestInvocation(files);
  const lines = [
    'set +e',
    `printf '%s\\n' ${shq(TEST_STARTED_MARKER)}`,
    invocation,
    'pd_purser_test_exit=$?',
  ];
  if (usesDefaultJestRunner) {
    lines.push(
      `if [ -f ${shq(JEST_RESULT_PATH)} ]; then ${summarizeJestResultCommand()}; fi`,
    );
  }
  lines.push('exit "$pd_purser_test_exit"');
  return { script: lines.join('\n'), usesDefaultJestRunner };
}

/**
 * Build the default sandbox command around only the contract files the purser
 * authored.
 *
 * Running the repository's unfiltered test script made a four-file unit
 * contract boot unrelated integration infrastructure. A failure in that
 * infrastructure then blocked the reviewed PR without naming a failed
 * contract case. Passing paths after npm's `--` keeps the repository's own
 * runner and configuration while limiting execution to the evidence under
 * review. Every path is shell-quoted because authored filenames cross a trust
 * boundary even after the stacked-file path checks have accepted them.
 */
export function buildDefaultSandboxTestCommand(
  files: ReadonlyArray<Pick<StackedFile, 'path'>>,
): string {
  if (files.length === 0) {
    throw new Error('cannot build a Purser test command without authored files');
  }
  return `${DEFAULT_INSTALL_COMMAND} && ${buildDefaultJestInvocation(files)}`;
}

function execPassed(result: ExecResultLike): boolean {
  return typeof result.exitCode === 'number'
    ? result.exitCode === 0
    : result.success === true;
}

function combinedOutput(result: ExecResultLike): string {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  return `${stdout}${stderr ? `\n${stderr}` : ''}`;
}

function classifyRunnerResult(
  result: ExecResultLike,
  usesDefaultJestRunner: boolean,
): SandboxRunOutcome {
  const combined = combinedOutput(result);
  const runnerStarted = combined.split(/\r?\n/).includes(TEST_STARTED_MARKER);
  const visibleOutput = withoutProtocolMarkers(combined);
  if (!runnerStarted) {
    return {
      executed: false,
      passed: null,
      outputTail: visibleOutput.slice(-OUTPUT_TAIL_BYTES),
      failures: [],
      outcomeKind: 'not-executed',
      reason: 'sandbox setup failed before the test runner started',
    };
  }

  const passed = execPassed(result);
  const jestSummary = usesDefaultJestRunner ? parseJestSummary(combined) : null;
  const outcomeKind: SandboxRunOutcome['outcomeKind'] = passed
    ? 'passed'
    : jestSummary?.numFailedTests
      ? 'assertion-failure'
      : jestSummary
        ? 'harness-failure'
        : 'unclassified-failure';
  return {
    executed: true,
    passed,
    outputTail: visibleOutput.slice(-OUTPUT_TAIL_BYTES),
    failures:
      outcomeKind === 'assertion-failure' ? parseTestFailures(visibleOutput) : [],
    outcomeKind,
    reason: null,
  };
}

function notExecuted(reason: string, output = ''): SandboxRunOutcome {
  return {
    executed: false,
    passed: null,
    outputTail: output.slice(-OUTPUT_TAIL_BYTES),
    failures: [],
    outcomeKind: 'not-executed',
    reason,
  };
}

/**
 * Execute the repo's test runner with the purser's new tests grafted in,
 * against the PR head, inside a Cloudflare Sandbox. Repository authentication,
 * untrusted install/build code, the coordination daemon, and test execution
 * are separate process scopes. The GitHub token reaches only the fetch; the
 * short-lived scoped coordination macaroon is minted only after checkout and
 * setup, then reaches only the daemon `startProcess` call.
 * Never throws: every failure mode returns an honest non-executed outcome.
 */
export async function runTestsInSandbox(params: SandboxRunParams): Promise<SandboxRunOutcome> {
  if (params.testCommand === undefined && params.files.length === 0) {
    return notExecuted(
      'no Purser-authored test files were supplied — nothing was executed',
    );
  }
  const sandbox = resolveSandbox(
    params.sandboxBinding,
    `purser-${params.owner}-${params.repo}-${params.headSha}`,
  );
  if (!sandbox) {
    return notExecuted(
      'SANDBOX binding absent — tests were NOT executed (no fabricated results)',
    );
  }
  const coordinationEnrollment = params.coordinationEnrollment;
  if (coordinationEnrollment && typeof sandbox.startProcess !== 'function') {
    return notExecuted(
      'SANDBOX binding lacks startProcess — refusing to mint a cloud-peer macaroon',
    );
  }

  const publicCloneUrl = `https://github.com/${params.owner}/${params.repo}.git`;
  const cloneUrl = coordinationEnrollment
    ? publicCloneUrl
    : `https://x-access-token:${params.token}@github.com/${params.owner}/${params.repo}.git`;
  const cloneLines: string[] = [
    'set -e',
    // rm -rf first: a retried run (network flake, transient sandbox error)
    // can land in the SAME warm container as its failed predecessor, which
    // already has /work/repo with `origin` set — `git remote add` then dies
    // with "remote origin already exists" before a single test runs. Start
    // from a clean slate every attempt so the script is retry-idempotent.
    'rm -rf /work && mkdir -p /work && cd /work',
    `git init -q repo && cd repo`,
    `git remote add origin ${shq(cloneUrl)}`,
    `git fetch -q --depth 1 origin ${shq(params.headSha)}`,
    `git checkout -q ${shq(params.headSha)}`,
  ];
  const setupLines: string[] = ['set -e'];
  for (const f of params.files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '.';
    setupLines.push(`mkdir -p ${shq(dir)}`);
    setupLines.push(`printf '%s' ${shq(toBase64(f.contents))} | base64 -d > ${shq(f.path)}`);
  }
  // --onnxruntime-node-install=skip: onnxruntime-node's postinstall fetches
  // CUDA/TensorRT binaries on linux-x64 even though this sandbox has no GPU.
  if (params.testCommand === undefined || coordinationEnrollment) {
    setupLines.push(DEFAULT_INSTALL_COMMAND);
  }
  if (coordinationEnrollment) {
    setupLines.push(...buildSandboxDaemonBootstrap());
  }
  const runner = buildRunnerScript(params.files, params.testCommand);

  // Preserve the existing single-command Purser protocol when no cloud peer
  // is configured. The multi-process split below is a security boundary for
  // the daemon macaroon, not a compatibility-breaking runner rewrite.
  if (!coordinationEnrollment) {
    try {
      const result = await sandbox.exec(
        `bash -lc ${shq([...cloneLines, ...setupLines, runner.script].join('\n'))}`,
      );
      return classifyRunnerResult(result, runner.usesDefaultJestRunner);
    } catch (err) {
      return notExecuted(`sandbox execution failed: ${String(err).slice(0, 300)}`);
    }
  }

  let daemonProcess: SandboxProcessLike | null = null;
  try {
    // Scope the installation token to Git alone. npm lifecycle and authored
    // repository code run in later exec calls without this environment.
    const auth = btoa(`x-access-token:${params.token}`);
    const cloneResult = await sandbox.exec(`bash -lc ${shq(cloneLines.join('\n'))}`, {
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraHeader',
        GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
      },
    });
    if (!execPassed(cloneResult)) {
      return notExecuted('sandbox checkout failed before the test runner started', combinedOutput(cloneResult));
    }

    const setupResult = await sandbox.exec(`bash -lc ${shq(setupLines.join('\n'))}`, {
      cwd: REPOSITORY_ROOT,
    });
    if (!execPassed(setupResult)) {
      return notExecuted('sandbox setup failed before the test runner started', combinedOutput(setupResult));
    }

    let coordinationPeer: SandboxCoordinationPeer;
    try {
      coordinationPeer = await mintSandboxCoordinationPeer(
        coordinationEnrollment,
      );
    } catch (err) {
      return notExecuted(
        `cloud coordination grant failed: ${String(err).slice(0, 240)}`,
      );
    }

    daemonProcess = await sandbox.startProcess!(
      './dist/port-daddy __daemon',
      {
        cwd: REPOSITORY_ROOT,
        env: cloudPeerDaemonEnv(coordinationPeer),
      },
    );
    if (
      !daemonProcess ||
      typeof daemonProcess.waitForPort !== 'function' ||
      typeof daemonProcess.kill !== 'function'
    ) {
      return notExecuted(
        'SANDBOX startProcess returned no controllable daemon handle',
      );
    }
    const writerPublication = await sandbox.exec(cloudPeerPublicationProbeCommand(CLOUD_PEER_ROOT), {
      cwd: REPOSITORY_ROOT,
    });
    const writerPort = execPassed(writerPublication)
      ? parseSandboxDaemonPublication(writerPublication.stdout ?? '')
      : null;
    if (!writerPort) {
      return notExecuted(
        'cloud pd daemon started but did not publish a valid TCP endpoint',
        combinedOutput(writerPublication),
      );
    }
    await daemonProcess.waitForPort(writerPort, { path: '/health' });
    const writerClientEnv = cloudPeerClientEnv(writerPort);
    const identity = coordinationPeer.actorId;
    const markerPath = `.portdaddy/cloud-peers/${coordinationPeer.replicaId}.peer`;
    const enrollmentNote = [
      'Fleet cloud coordination peer enrolled',
      `actor=${identity}`,
      `replica=${coordinationPeer.replicaId}`,
      `marker=${markerPath}`,
    ].join(' ');
    const beginCommand = [
      './dist/port-daddy begin',
      shq('Cloud sandbox coordination peer'),
      '--identity',
      shq(identity),
      '--lifecycle durable',
      '--sidequest',
      shq('ADR-0092 cloud coordination peer runtime'),
      '--allow-main-worktree',
      '--files',
      shq(markerPath),
      '&&',
      './dist/port-daddy note',
      shq(enrollmentNote),
      '--type progress',
    ].join(' ');
    const beginResult = await sandbox.exec(beginCommand, {
      cwd: REPOSITORY_ROOT,
      env: writerClientEnv,
    });
    if (!execPassed(beginResult)) {
      return notExecuted(
        'cloud pd daemon started but its coordination session, marker claim, or enrollment note failed',
        combinedOutput(beginResult),
      );
    }
    const convergenceResult = await sandbox.exec(cloudPeerConvergenceProbeCommand(writerPort), {
      cwd: REPOSITORY_ROOT,
      env: writerClientEnv,
    });
    const writerCursor = execPassed(convergenceResult)
      ? parseSandboxCoordinationCursor(convergenceResult.stdout ?? '')
      : null;
    if (!writerCursor) {
      return notExecuted(
        'cloud pd daemon started but its coordination session was not durably acknowledged by the room',
        combinedOutput(convergenceResult),
      );
    }

    // A non-zero room cursor proves only that *something* has existed in this
    // project. Kill the writer and boot a second daemon against a brand-new DB
    // and prefix. The witness must read the writer's exact session, marker
    // claim, and note through ordinary pd commands before authored tests run.
    await daemonProcess.kill();
    daemonProcess = null;
    let witnessPeer: SandboxCoordinationPeer;
    try {
      // A second real peer gets its own actor-scoped capability. Grants are
      // deliberately not treated as replica credentials or replayed across
      // process lifetimes, even though both replicas share the exact actor.
      witnessPeer = await mintSandboxCoordinationPeer(coordinationEnrollment);
    } catch (err) {
      return notExecuted(
        `cloud coordination witness grant failed: ${String(err).slice(0, 240)}`,
      );
    }
    daemonProcess = await sandbox.startProcess!(
      './dist/port-daddy __daemon',
      {
        cwd: REPOSITORY_ROOT,
        env: cloudPeerDaemonEnv(witnessPeer, CLOUD_PEER_WITNESS_ROOT),
      },
    );
    if (
      !daemonProcess
      || typeof daemonProcess.waitForPort !== 'function'
      || typeof daemonProcess.kill !== 'function'
    ) {
      return notExecuted(
        'SANDBOX startProcess returned no controllable witness daemon handle',
      );
    }
    const witnessPublication = await sandbox.exec(cloudPeerPublicationProbeCommand(CLOUD_PEER_WITNESS_ROOT), {
      cwd: REPOSITORY_ROOT,
    });
    const witnessPort = execPassed(witnessPublication)
      ? parseSandboxDaemonPublication(witnessPublication.stdout ?? '')
      : null;
    if (!witnessPort) {
      return notExecuted(
        'fresh cloud pd witness did not publish a valid TCP endpoint',
        combinedOutput(witnessPublication),
      );
    }
    await daemonProcess.waitForPort(witnessPort, { path: '/health' });
    const witnessClientEnv = cloudPeerClientEnv(witnessPort, CLOUD_PEER_WITNESS_ROOT);
    const witnessConvergence = await sandbox.exec(cloudPeerConvergenceProbeCommand(
      witnessPort,
      writerCursor,
    ), {
      cwd: REPOSITORY_ROOT,
      env: witnessClientEnv,
    });
    const witnessCursor = execPassed(witnessConvergence)
      ? parseSandboxCoordinationCursor(witnessConvergence.stdout ?? '')
      : null;
    if (!witnessCursor || witnessCursor < writerCursor) {
      return notExecuted(
        'fresh cloud pd witness did not converge with the coordination room',
        combinedOutput(witnessConvergence),
      );
    }
    const witnessResult = await sandbox.exec(
      cloudPeerWitnessCommand(coordinationPeer, markerPath, enrollmentNote),
      {
        cwd: REPOSITORY_ROOT,
        env: witnessClientEnv,
      },
    );
    const witnessProved = execPassed(witnessResult)
      && (witnessResult.stdout ?? '')
        .split(/\r?\n/)
        .some(line => /^CLOUD_PEER_WITNESS_OK \S+$/.test(line));
    if (!witnessProved) {
      return notExecuted(
        'fresh cloud pd witness could not read the exact session, marker claim, and enrollment note',
        combinedOutput(witnessResult),
      );
    }
    const testResult = await sandbox.exec(`bash -lc ${shq(runner.script)}`, {
      cwd: REPOSITORY_ROOT,
    });
    return classifyRunnerResult(testResult, runner.usesDefaultJestRunner);
  } catch (err) {
    return notExecuted(`sandbox execution failed: ${String(err).slice(0, 300)}`);
  } finally {
    if (daemonProcess && typeof daemonProcess.kill === 'function') {
      try {
        await daemonProcess.kill();
      } catch {
        // The sandbox may already have reaped a failed daemon. Cleanup failure
        // cannot turn an honestly classified run into fabricated evidence.
      }
    }
  }
}
