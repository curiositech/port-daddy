#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_TRANSPORTS = ['stdio', 'http'];
const VALID_STARTUP_STRATEGIES = ['lazy', 'eager'];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Audit an MCP server design plan against this skill's rules: stdout is
 * reserved for JSON-RPC frames, heavy work belongs behind the first tool call,
 * file tools must guard path traversal, errors are typed (isError) and
 * sanitized, secrets fail fast at startup, and telemetry never blocks.
 * Rules operate on structured/enum/boolean/number fields only.
 *
 * @param {unknown} plan - parsed JSON plan, see schemas/mcp-server-plan.schema.json
 * @returns {{pass: boolean, score: number, findings: Array<{rule: string, severity: string, message: string}>, recommendations: string[]}}
 */
export function auditMcpServerDesign(plan) {
  if (!isPlainObject(plan)) {
    throw new TypeError('plan must be a non-null, non-array JSON object');
  }
  if (!VALID_TRANSPORTS.includes(plan.transport)) {
    throw new TypeError(`plan.transport must be one of: ${VALID_TRANSPORTS.join(', ')}`);
  }
  if (!VALID_STARTUP_STRATEGIES.includes(plan.startupStrategy)) {
    throw new TypeError(`plan.startupStrategy must be one of: ${VALID_STARTUP_STRATEGIES.join(', ')}`);
  }
  if (typeof plan.logsToStdout !== 'boolean') {
    throw new TypeError('plan.logsToStdout must be a boolean');
  }

  const findings = [];
  const recommendations = [];
  let score = 100;
  let criticalHit = false;

  function fail(rule, severity, message, recommendation) {
    findings.push({ rule, severity, message });
    if (recommendation) recommendations.push(recommendation);
    if (severity === 'critical') criticalHit = true;
    score -= { critical: 30, high: 15, medium: 8, low: 3 }[severity] ?? 5;
  }

  // --- Gate 1: stdout is reserved for JSON-RPC frames ---
  if (plan.transport === 'stdio' && plan.logsToStdout === true) {
    fail(
      'stdout-corruption',
      'critical',
      'transport is stdio and logsToStdout is true: any non-protocol byte on stdout corrupts the JSON-RPC frame stream ("invalid JSON-RPC frame" in the client).',
      'Route all logging to stderr; audit console.log and any logger defaulting to stdout.'
    );
  }

  // --- Gate 2: this skill covers the stdio surface ---
  if (plan.transport === 'http') {
    fail(
      'http-transport-out-of-scope',
      'high',
      'transport is http: same protocol, different framing concerns — this skill\'s stdio-hygiene guarantees (and this audit) do not cover HTTP session/framing design.',
      'Use an MCP-HTTP-transport skill for the framing layer; keep this skill for the tool-surface design.'
    );
  }

  // --- Gate 3: fast startup — heavy work behind the first tool call ---
  if (plan.startupStrategy === 'eager') {
    fail(
      'eager-startup',
      'high',
      'startupStrategy is eager: loading indexes/models at boot risks the client timing out the handshake, so the tool list never appears.',
      'Lazy-load behind the first tool call; print a one-line status to stderr at boot and do real work later.'
    );
  } else if (typeof plan.startupBudgetMs === 'number' && plan.startupBudgetMs > 100) {
    fail(
      'startup-over-budget',
      'medium',
      `startupBudgetMs is ${plan.startupBudgetMs}: over the 100ms budget this skill's Quality Gates set for reaching connect().`,
      'Move whatever is consuming boot time behind ensureCatalog()-style lazy initialization.'
    );
  }

  // --- Gate 4: file tools must guard path traversal (the #1 vulnerability) ---
  if (plan.exposesFileTools === true && plan.pathTraversalGuard !== true) {
    fail(
      'unguarded-file-tool',
      'critical',
      'exposesFileTools is true but pathTraversalGuard is not: a skill_id + file_path tool without a resolve+startsWith check lets callers escape the root (../../../../etc/passwd).',
      'path.resolve both root and requested path, reject unless requested.startsWith(root + path.sep), and add the traversal test to CI.'
    );
  }

  // --- Gate 5: errors are typed and sanitized at the tool boundary ---
  if (plan.errorsReturnIsError !== true) {
    fail(
      'thrown-errors',
      'medium',
      'errorsReturnIsError is not true: throwing from a handler denies the client a typed error it can act on.',
      'Return { content, isError: true } from tool handlers instead of throwing.'
    );
  }
  if (plan.errorsSanitized !== true) {
    fail(
      'unsanitized-errors',
      'high',
      'errorsSanitized is not true: verbatim error formatting is how "invalid auth: Bearer sk_live_..." reaches the client.',
      'Sanitize at the tool boundary — generic message to the client, detailed error to stderr, never the secret value even truncated.'
    );
  }

  // --- Gate 6: required secrets fail fast at startup, not on the first tool call ---
  if (plan.requiresSecrets === true && plan.requiredEnvValidatedAtStartup !== true) {
    fail(
      'secrets-checked-late',
      'high',
      'requiresSecrets is true but requiredEnvValidatedAtStartup is not: a missing env var surfaces as a confusing first-tool-call failure instead of an actionable startup error.',
      'Validate required env vars at boot and exit(2) with a message naming the variable and where to set it.'
    );
  }

  // --- Gate 7: telemetry never blocks a tool response ---
  if (plan.telemetryBlocking === true) {
    fail(
      'blocking-telemetry',
      'high',
      'telemetryBlocking is true: analytics latency is now on the critical path of every tool call.',
      'Fire-and-forget at the top of the handler, wrapped in a short AbortController (~1.5s); document the opt-out env var.'
    );
  }

  // --- Gate 8: focused tools — a 12-optional-arg tool wastes model turns ---
  if (typeof plan.maxOptionalArgsPerTool === 'number' && plan.maxOptionalArgsPerTool > 8) {
    fail(
      'tool-does-too-much',
      'medium',
      `maxOptionalArgsPerTool is ${plan.maxOptionalArgsPerTool}: one tool with that many optional args is covering multiple capabilities, and the model wastes turns guessing which to fill.`,
      'Split into focused tools with small schemas that cross-reference each other in their descriptions.'
    );
  }

  // --- Gate 9: descriptions are the discovery surface ---
  if (plan.descriptionsIncludeWhenNotToUse !== true) {
    fail(
      'descriptions-missing-boundaries',
      'medium',
      'descriptionsIncludeWhenNotToUse is not true: a description without a when-NOT-to-use clause leaves the model guessing between adjacent tools.',
      'Every description: capability first, return shape, when to use vs the adjacent tool, cost hints.'
    );
  }

  // --- Gate 10: constrained inputs + handshake test in CI ---
  if (plan.inputsValidatedWithConstraints !== true) {
    fail(
      'unconstrained-inputs',
      'medium',
      'inputsValidatedWithConstraints is not true: without min/max/enum constraints the client surfaces no argument metadata and the server trusts raw input.',
      'Validate every tool input with zod including min/max/enum constraints.'
    );
  }
  if (plan.handshakeTestInCi !== true) {
    fail(
      'no-handshake-test',
      'medium',
      'handshakeTestInCi is not true: startup regressions (a stray stdout write, a hung boot) reach users before anyone notices.',
      'Run the initialize → tools/list handshake script in CI on every commit.'
    );
  }

  const clampedScore = Math.max(0, Math.min(100, Math.round(score)));
  const pass = !criticalHit && clampedScore >= 60;

  if (findings.length === 0) {
    recommendations.push('Design clears every gate this skill checks. Still test the full distribution path (install + register + handshake) on a clean machine before release.');
  }

  return { pass, score: clampedScore, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: mcp_server_design_audit.mjs --input <file>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    const report = auditMcpServerDesign(data);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.pass) process.exit(1);
  } catch (e) {
    process.stderr.write(`mcp_server_design_audit: ${e.message}\n`);
    process.exit(1);
  }
}
