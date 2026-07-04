#!/usr/bin/env node
// cli_design_audit.mjs — deterministic audit of a CLI/TUI design spec against
// the beautiful-cli-design Quality Gates. Pure stdlib, no deps.
//
// Usage:
//   node cli_design_audit.mjs --input <cli-spec.json>
//
// Exports:
//   auditCliDesign(spec) -> { pass, score, findings, recommendations }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_BOOLEAN_FIELDS = [
  'respectsNoColorEnv',
  'colorHasNonColorFallback',
  'alignsColumns',
  'respectsTerminalWidth',
  'prefixesLinesForGrep',
  'quietByDefault',
  'hasProgressForLongOps',
  'errorsToStderr',
  'exitCodesMeaningful',
  'honorsPipeNotATty',
];

const SEVERITY_WEIGHT = { critical: 12, high: 8, medium: 4, low: 2 };

function assertShape(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('auditCliDesign: input must be a JSON object');
  }
  for (const field of REQUIRED_BOOLEAN_FIELDS) {
    if (typeof spec[field] !== 'boolean') {
      throw new Error(`auditCliDesign: "${field}" is required and must be a boolean`);
    }
  }
}

function pushFinding(findings, severity, id, message, recommendation, recommendations) {
  findings.push({ severity, id, message });
  if (recommendation) recommendations.push(recommendation);
}

/**
 * Audit a CLI/TUI design spec against the beautiful-cli-design bar: honest
 * color use, TTY/pipe/NO_COLOR compatibility, Unicode-safe layout, meaningful
 * exit codes, and scriptable, quiet-by-default output.
 *
 * FAILS CLOSED: every gate must be explicitly declared `true` to pass. A
 * missing field throws (see assertShape); `false` is scored as a real defect,
 * never treated as "probably fine."
 *
 * @param {object} spec
 * @param {boolean} spec.respectsNoColorEnv - NO_COLOR / TERM=dumb suppress ANSI output.
 * @param {boolean} spec.colorHasNonColorFallback - color never carries meaning alone.
 * @param {boolean} spec.alignsColumns - column alignment uses Unicode display width.
 * @param {boolean} spec.respectsTerminalWidth - output reflows at narrow widths.
 * @param {boolean} spec.prefixesLinesForGrep - log lines carry a stable, greppable prefix.
 * @param {boolean} spec.quietByDefault - default output is concise, verbose is opt-in.
 * @param {boolean} spec.hasProgressForLongOps - spinner/bar+ETA for perceptible-duration work.
 * @param {boolean} spec.errorsToStderr - errors/warnings go to stderr, not stdout.
 * @param {boolean} spec.exitCodesMeaningful - exit codes distinguish failure classes.
 * @param {boolean} spec.honorsPipeNotATty - non-TTY stdout strips interactive/ANSI output.
 * @returns {{pass:boolean, score:number, findings:Array, recommendations:string[]}}
 */
export function auditCliDesign(spec) {
  assertShape(spec);

  const findings = [];
  const recommendations = [];

  // --- Accessibility: color must never be the only signal --------------------
  if (spec.colorHasNonColorFallback !== true) {
    pushFinding(
      findings, 'critical', 'color-only-signal',
      'Meaning is conveyed by color alone somewhere in the output — an accessibility failure for colorblind users and anyone in a monochrome/reduced-color terminal.',
      'Pair every semantic color with a symbol or label (e.g. "✗ error", not just red text) so meaning survives without color.',
      recommendations,
    );
  }

  // --- NO_COLOR / TERM=dumb -----------------------------------------------
  if (spec.respectsNoColorEnv !== true) {
    pushFinding(
      findings, 'critical', 'ignores-no-color-env',
      'Output does not honor NO_COLOR / TERM=dumb — ANSI styling leaks into environments that explicitly opted out.',
      'Check NO_COLOR and TERM=dumb (or an equivalent capability probe) and strip styling when either is set.',
      recommendations,
    );
  }

  // --- Pipe / non-TTY detection --------------------------------------------
  if (spec.honorsPipeNotATty !== true) {
    pushFinding(
      findings, 'critical', 'ignores-pipe-not-tty',
      'Output does not detect a non-TTY stdout — raw ANSI escape codes and live-redraw control sequences can be dumped into pipes, files, and CI logs.',
      'Detect isTTY (or equivalent) on stdout and fall back to plain, linear output — cursor control and live redraw are TTY-only features.',
      recommendations,
    );
  }

  // --- Exit codes ------------------------------------------------------------
  if (spec.exitCodesMeaningful !== true) {
    pushFinding(
      findings, 'critical', 'exit-codes-not-meaningful',
      'Exit codes do not distinguish failure classes — scripts and CI cannot branch on why the command failed.',
      'Reserve 0 for success and assign distinct, documented non-zero codes to meaningful failure classes (e.g. usage error vs. runtime error vs. not-found).',
      recommendations,
    );
  }

  // --- Errors on stderr --------------------------------------------------------
  if (spec.errorsToStderr !== true) {
    pushFinding(
      findings, 'critical', 'errors-on-stdout',
      'Errors/warnings are written to stdout instead of stderr — they corrupt piped stdout and vanish when stdout is redirected to a file.',
      'Route every error and warning through stderr; keep stdout reserved for the command\'s actual output/result.',
      recommendations,
    );
  }

  // --- Progress on long operations --------------------------------------------
  if (spec.hasProgressForLongOps !== true) {
    pushFinding(
      findings, 'critical', 'no-progress-for-long-ops',
      'Operations that can take a perceptible amount of time give no feedback — the tool looks hung.',
      'Show a spinner when the duration is unknown, or a bar with ETA when the denominator is real; never sit silent.',
      recommendations,
    );
  }

  // --- Unicode-safe column alignment ------------------------------------------
  if (spec.alignsColumns !== true) {
    pushFinding(
      findings, 'high', 'misaligned-columns',
      'Column/box alignment does not account for Unicode display width — CJK characters or emoji in data will break table layout.',
      'Compute column widths with a Unicode-aware display-width function, not raw string length.',
      recommendations,
    );
  }

  // --- Terminal width responsiveness -------------------------------------------
  if (spec.respectsTerminalWidth !== true) {
    pushFinding(
      findings, 'high', 'ignores-terminal-width',
      'Output does not adapt to terminal width — it can wrap unpredictably or overflow at narrow widths.',
      'Reflow or truncate output sanely at common widths (e.g. 40/80/120 columns) instead of assuming a fixed wide terminal.',
      recommendations,
    );
  }

  // --- Greppable, prefixed log lines -------------------------------------------
  if (spec.prefixesLinesForGrep !== true) {
    pushFinding(
      findings, 'medium', 'unprefixed-log-lines',
      'Streamed/log-style lines carry no stable prefix (level/component/timestamp), making them harder to grep or triage in CI logs.',
      'Prefix each log line with a stable, parseable marker (e.g. "[build] " or a level tag) independent of any color styling.',
      recommendations,
    );
  }

  // --- Quiet by default -----------------------------------------------------
  if (spec.quietByDefault !== true) {
    pushFinding(
      findings, 'medium', 'noisy-by-default',
      'Default output is verbose/noisy rather than concise, drowning the signal a user or CI log actually needs.',
      'Make default output concise and add an explicit --verbose/-v (or --debug) opt-in for the noisy path.',
      recommendations,
    );
  }

  const totalWeight = findings.reduce((sum, f) => sum + ((SEVERITY_WEIGHT[f.severity] ?? (() => { throw new Error(`unknown finding severity: ${f.severity}`); })())), 0);
  const score = Math.max(0, 100 - totalWeight);
  const hasCritical = findings.some((f) => f.severity === 'critical');
  const pass = !hasCritical && score >= 75;

  if (pass) {
    recommendations.push('CLI design meets the readiness bar: accessible color, TTY/pipe/NO_COLOR-safe, Unicode-safe layout, meaningful exit codes, scriptable and quiet by default.');
  }

  return { pass, score, findings, recommendations };
}

function parseArgs(argv) {
  const i = argv.indexOf('--input');
  if (i === -1 || !argv[i + 1]) throw new Error('usage: cli_design_audit.mjs --input <cli-spec>.json');
  return { input: argv[i + 1] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { input } = parseArgs(process.argv.slice(2));
    const data = JSON.parse(readFileSync(input, 'utf8'));
    process.stdout.write(`${JSON.stringify(auditCliDesign(data), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`cli_design_audit: ${error.message}\n`);
    process.exit(1);
  }
}
