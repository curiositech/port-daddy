/**
 * CLI `pd continuation` — witnessed N:N continuation coverage.
 *
 *   pd continuation witness-sweep [--max-pairs N] [--budget-usd X]
 *                                 [--include src:tgt,...] [--mode auto|handoff|native]
 *                                 [--dry-run] [--json]
 *   pd continuation matrix [--json]
 *
 * The sweep is a daemon client: it causes REAL continuations through the live
 * POST /spawn → POST /memory/handoffs → POST /memory/handoffs/:id/continue
 * paths, then re-reads GET /harness-adapters/continuation-matrix so every
 * "witnessed" cell in its output is the daemon's own read, never self-report.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pdFetch, isDaemonRunning } from '../utils/fetch.js';
import { detectColorLevel } from '../utils/output.js';
import * as ui from '../utils/ui.js';
import { CLIOptions, isJson } from '../types.js';
import {
  collectSweepReadiness,
  enumerateSweepPairs,
  fetchDaemonContinuationMatrix,
  newSweepId,
  runWitnessSweep,
  WITNESS_SWEEP_SCHEMA,
  type SweepPair,
  type SweepPairResult,
  type WitnessSweepReport,
} from '../../lib/continuation-witness-sweep.js';
import {
  renderHarnessContinuationMatrix,
  type HarnessContinuationMatrixReport,
} from '../../lib/harness-conformance.js';

const RESET = '\x1b[0m';

function paint(value: string, code: string): string {
  if (detectColorLevel('stdout') === 'none') return value;
  return `${code}${value}${RESET}`;
}

const green = (value: string): string => paint(value, '\x1b[32m');
const yellow = (value: string): string => paint(value, '\x1b[33m');
const red = (value: string): string => paint(value, '\x1b[31m');
const dim = (value: string): string => paint(value, '\x1b[2m');

function cellGlyph(result: SweepPairResult): string {
  const modeGlyph = result.pair.mode === 'native' ? 'N' : 'H';
  switch (result.outcome) {
    case 'witnessed-carried':
      return green(modeGlyph);
    case 'witnessed-uncarried':
      return yellow('h?');
    case 'failed':
    case 'source-run-failed':
      return red('✗');
    case 'budget-aborted':
      return dim('~');
    case 'not-attempted':
      return dim('·');
    case 'skipped':
    default:
      return result.pair.skipReason === 'vendor-refuses' ? '—' : dim('·');
  }
}

function visibleLength(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function padCell(value: string, width: number): string {
  const pad = Math.max(0, width - visibleLength(value).length);
  return `${' '.repeat(pad)}${value}`;
}

/** 17×17 grid in the family index-header style of renderHarnessContinuationMatrix. */
export function renderWitnessSweepGrid(report: WitnessSweepReport): string {
  const families: string[] = [];
  for (const result of report.results) {
    if (!families.includes(result.pair.sourceFamily)) families.push(result.pair.sourceFamily);
  }
  const byPair = new Map(report.results.map((result) => [
    `${result.pair.sourceFamily}\0${result.pair.targetFamily}`,
    result,
  ]));
  const labelWidth = Math.max(...families.map((family) => family.length), 6);
  const lines = [
    `${'Source'.padEnd(labelWidth + 4)}${families.map((_, index) => String(index + 1).padStart(2, '0')).join(' ')}`,
  ];
  for (const [sourceIndex, sourceFamily] of families.entries()) {
    const cells = families.map((targetFamily) => {
      const result = byPair.get(`${sourceFamily}\0${targetFamily}`);
      return padCell(result ? cellGlyph(result) : dim('·'), 2);
    }).join(' ');
    lines.push(`${String(sourceIndex + 1).padStart(2, '0')} ${sourceFamily.padEnd(labelWidth)} ${cells}`);
  }
  lines.push('');
  lines.push(`${green('N')}/${green('H')} = witnessed this sweep (daemon receipt + daemon transcript carriage); ${yellow('h?')} = receipt completed but the successor did not restate the fact;`);
  lines.push(`${red('✗')} = attempted and failed; ${dim('·')} = skipped (see reasons below); ${dim('~')} = budget-aborted; — = vendor-refuses.`);
  return `${lines.join('\n')}\n`;
}

function outcomeLabel(result: SweepPairResult): string {
  switch (result.outcome) {
    case 'witnessed-carried': return green('witnessed-carried');
    case 'witnessed-uncarried': return yellow('witnessed-uncarried');
    case 'failed': return red('failed');
    case 'source-run-failed': return red('source-run-failed');
    case 'budget-aborted': return dim('budget-aborted');
    case 'not-attempted': return dim('not-attempted');
    default: return dim(`skipped(${result.pair.skipReason ?? 'unknown'})`);
  }
}

function renderPairTable(report: WitnessSweepReport): string {
  const attempted = report.results.filter((result) => (
    result.outcome !== 'skipped' && result.outcome !== 'not-attempted' && result.outcome !== 'budget-aborted'
  ));
  const lines: string[] = [];
  if (attempted.length > 0) {
    lines.push('Attempted pairs:');
    for (const result of attempted) {
      const evidence = result.receiptId
        ? `receipt ${result.receiptId}`
        : result.sourceAgentId
          ? `source run ${result.sourceAgentId}`
          : 'no daemon evidence';
      lines.push(`  ${result.pair.sourceFamily} -> ${result.pair.targetFamily} [${result.pair.mode}] ${outcomeLabel(result)} (${evidence})`);
      if (result.error) lines.push(`    ${dim(result.error.slice(0, 200))}`);
    }
  }
  const skipCounts = new Map<string, number>();
  for (const result of report.results) {
    if (result.outcome === 'skipped' || result.outcome === 'not-attempted' || result.outcome === 'budget-aborted') {
      const key = result.outcome === 'skipped' ? (result.pair.skipReason ?? 'skipped') : result.outcome;
      skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1);
    }
  }
  if (skipCounts.size > 0) {
    lines.push('');
    lines.push('Unattempted cells (honest reasons, one line per reason):');
    for (const [reason, count] of [...skipCounts.entries()].sort((a, b) => b[1] - a[1])) {
      const example = report.results.find((result) => (
        (result.outcome === 'skipped' && (result.pair.skipReason ?? 'skipped') === reason)
        || result.outcome === reason
      ));
      lines.push(`  ${dim(`${reason} × ${count}`)} — e.g. ${example?.pair.sourceFamily} -> ${example?.pair.targetFamily}: ${example?.detail}`);
    }
  }
  return lines.join('\n');
}

function parseIncludeOption(options: CLIOptions): string[] {
  const raw = options.include;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  return raw.split(',').map((pair) => pair.trim()).filter(Boolean);
}

function parseModeOption(options: CLIOptions): 'auto' | 'handoff' | 'native' {
  const raw = typeof options.mode === 'string' ? options.mode : 'auto';
  if (raw === 'auto' || raw === 'handoff' || raw === 'native') return raw;
  ui.error('--mode must be auto, handoff, or native');
  process.exit(1);
}

function numberOption(options: CLIOptions, key: string, fallback: number): number {
  const raw = options[key];
  if (raw === undefined || raw === true) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    ui.error(`--${key} must be a positive number`);
    process.exit(1);
  }
  return parsed;
}

async function requireDaemon(): Promise<void> {
  if (await isDaemonRunning()) return;
  ui.error('The Port Daddy daemon is required — a witness sweep only reports what the daemon itself recorded. Start it with `pd start`.');
  process.exit(1);
}

function renderDryRun(pairs: SweepPair[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ schema: WITNESS_SWEEP_SCHEMA, dryRun: true, pairs }, null, 2));
    return;
  }
  const runnable = pairs.filter((pair) => pair.runnable);
  console.log('');
  ui.info(`Dry run — ${pairs.length} ordered pairs enumerated, ${runnable.length} runnable on this machine, zero spawns executed.`);
  console.log('');
  for (const pair of runnable) {
    console.log(`  ${pair.sourceFamily} -> ${pair.targetFamily} [${pair.mode}] via ${pair.sourceBackendId} -> ${pair.targetBackendId}`);
  }
  const reasons = new Map<string, number>();
  for (const pair of pairs) {
    if (!pair.runnable) reasons.set(pair.skipReason ?? 'unknown', (reasons.get(pair.skipReason ?? 'unknown') ?? 0) + 1);
  }
  console.log('');
  for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    const example = pairs.find((pair) => !pair.runnable && (pair.skipReason ?? 'unknown') === reason);
    console.log(`  ${dim(`${reason} × ${count}`)} — e.g. ${example?.sourceFamily} -> ${example?.targetFamily}: ${example?.skipDetail}`);
  }
  console.log('');
}

async function witnessSweepCommand(options: CLIOptions): Promise<void> {
  const include = parseIncludeOption(options);
  const modeOverride = parseModeOption(options);
  const maxPairs = Math.floor(numberOption(options, 'max-pairs', 8));
  const budgetUsd = numberOption(options, 'budget-usd', 0.25);

  const readiness = await collectSweepReadiness();
  const pairs = enumerateSweepPairs({ readiness, include, modeOverride });

  if (options['dry-run']) {
    renderDryRun(pairs, isJson(options));
    return;
  }

  await requireDaemon();
  const workdir = mkdtempSync(join(tmpdir(), 'pd-witness-sweep-'));
  const sweepId = newSweepId();
  if (!isJson(options)) {
    ui.info(`Witness sweep ${sweepId}: ${pairs.filter((pair) => pair.runnable).length} runnable pairs (max ${maxPairs}, budget $${budgetUsd}), scratch workspace ${workdir}`);
  }

  const report = await runWitnessSweep({
    pairs,
    fetch: pdFetch,
    workdir,
    sweepId,
    maxPairs,
    budgetUsd,
  });
  // Always the daemon's own read — never the sweep's local tally.
  report.matrix = await fetchDaemonContinuationMatrix(pdFetch);

  if (isJson(options)) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('');
  process.stdout.write(renderWitnessSweepGrid(report));
  console.log('');
  console.log(renderPairTable(report));
  console.log('');
  const matrix = report.matrix as HarnessContinuationMatrixReport | null;
  if (matrix) {
    ui.info(
      `Daemon matrix after sweep: ${matrix.summary.witnessedPaths} witnessed path(s) of ${matrix.summary.paths} `
      + `(${matrix.summary.witnessedPredicates} witnessed predicate(s)). Witnessed cells come only from daemon receipts.`,
    );
  } else {
    ui.warn('Could not re-fetch the daemon continuation matrix; witnessed-cell truth is unavailable.');
  }
  if (report.spentUsd !== null) {
    ui.info(`Metered spend recorded by the daemon during this sweep: $${report.spentUsd.toFixed(4)}`);
  }
}

async function matrixCommand(options: CLIOptions): Promise<void> {
  await requireDaemon();
  const matrix = await fetchDaemonContinuationMatrix(pdFetch) as HarnessContinuationMatrixReport | null;
  if (!matrix) {
    ui.error('Daemon did not return a continuation matrix.');
    process.exit(1);
  }
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, matrix }, null, 2));
    return;
  }
  console.log('');
  process.stdout.write(renderHarnessContinuationMatrix(matrix));
  console.log('');
  const witnessed = matrix.compatibility.filter((cell) => cell.witness !== null);
  if (witnessed.length === 0) {
    ui.info('0 witnessed paths. Mechanics above are declarations; run `pd continuation witness-sweep` to earn daemon-witnessed cells.');
  } else {
    ui.info(`${witnessed.length} daemon-witnessed path(s):`);
    for (const cell of witnessed) {
      const freshness = cell.witness?.freshness === 'fresh' ? green('fresh') : yellow(cell.witness?.freshness ?? 'unknown');
      console.log(`  ${cell.sourceFamily} -> ${cell.targetFamily} [${cell.autoMode}] ${freshness} witness ${cell.witness?.witnessId} at ${cell.witness?.observedAt}`);
    }
  }
  console.log('');
}

function printHelp(): void {
  console.log(`
pd continuation — witnessed N:N continuation coverage

  pd continuation witness-sweep [--max-pairs N] [--budget-usd X]
                                [--include src:tgt,...] [--mode auto|handoff|native]
                                [--dry-run] [--json]
      Run real source-spawn -> capsule -> continue probes through the live
      daemon and report which matrix cells the DAEMON now witnesses.

  pd continuation matrix [--json]
      Print the daemon's continuation matrix including witnessed cells.
`);
}

export async function handleContinuation(
  positional: string[],
  options: CLIOptions,
): Promise<void> {
  const sub = (positional[0] || 'help').toLowerCase();
  switch (sub) {
    case 'witness-sweep':
    case 'sweep':
      await witnessSweepCommand(options);
      return;
    case 'matrix':
      await matrixCommand(options);
      return;
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      return;
    default:
      ui.error(`Unknown subcommand: ${sub}`);
      printHelp();
      process.exitCode = 1;
  }
}
