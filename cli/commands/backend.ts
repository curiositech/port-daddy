/**
 * CLI `pd backend` — surface the LLM backend route the fleet is running on.
 *
 * Why this exists: the fleet now supports cli-tube backends
 * (`cli:claude-code`, `cli:codex`) that ride your $200/mo Claude Max or
 * $20/mo ChatGPT Pro subscription at $0 marginal cost. Operators want a
 * one-line way to:
 *
 *   1. See which backends are actually available on this machine.
 *   2. Switch the whole fleet onto a free-via-subscription backend.
 *   3. Read today's / this week's / this month's spend rolled up by backend.
 *
 *   pd backend list                  show all backends + readiness + cost framing
 *   pd backend list --available      only show backends that pass readiness
 *   pd backend list --json           machine-readable (for FleetBar/dashboard)
 *   pd backend use <name>            emit shell export for PD_USE_CLI_BACKEND
 *                                    (only meaningful for cli:claude-code / cli:codex)
 *   pd backend cost [--today|--week|--month]   spend rollup by backend
 *   pd backend adapters [--probe]    N:N portability contract + local discovery
 *
 * `backend use` prints an `export PD_USE_CLI_BACKEND=<value>` line to stdout
 * intended to be evaluated by the shell. It also writes the value to
 * ~/.port-daddy-cli-backend so other tooling can read the persisted choice;
 * clear with `pd backend use none`.
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import { pdFetch, isDaemonRunning } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { CLIOptions, isJson } from '../types.js';
import {
  BACKEND_CATALOG,
  getBackendCatalogEntry,
  detectForcedCliBackend,
  detectForcedCliBackendValue,
  harnessAdapterCapabilityRows,
  renderHarnessAdapterMarkdown,
  type BackendCatalogEntry,
  type HarnessAdapterCapabilities,
} from '../../lib/backend-catalog.js';
import { probeHarnessAdapters, type HarnessProbeStatus } from '../../lib/harness-adapter-probe.js';
import {
  buildHarnessContinuationMatrix,
  renderHarnessContinuationMatrix,
  type HarnessContinuationMatrixReport,
} from '../../lib/harness-conformance.js';

interface FleetModelEntry {
  id: string;
  name: string;
  models?: string[];
  available?: boolean;
  launchable?: boolean;
  recommended?: boolean;
  costModel?: string;
  framing?: string;
  description?: string;
  tagline?: string;
  pdUseCliBackendValue?: string;
  isForcedByEnv?: boolean;
  readinessStatus?: string;
  readinessSummary?: string;
  readinessNextStep?: string;
  adapter?: HarnessAdapterCapabilities;
}

interface FleetModelsResponse {
  success?: boolean;
  forcedCliBackend?: string | null;
  pdUseCliBackend?: string | null;
  backends?: FleetModelEntry[];
  error?: string;
}

const PERSIST_PATH = join(homedir(), '.port-daddy-cli-backend');

function readPersistedSelection(): string | null {
  try {
    if (!existsSync(PERSIST_PATH)) return null;
    const raw = readFileSync(PERSIST_PATH, 'utf-8').trim();
    return raw || null;
  } catch {
    return null;
  }
}

function persistSelection(value: string | null): void {
  try {
    if (value == null) {
      if (existsSync(PERSIST_PATH)) unlinkSync(PERSIST_PATH);
    } else {
      writeFileSync(PERSIST_PATH, `${value}\n`, { mode: 0o600 });
    }
  } catch {
    /* persistence is best-effort */
  }
}

async function fetchBackends(): Promise<FleetModelsResponse | null> {
  try {
    const res = await pdFetch('/fleet/models');
    if (!res.ok) return null;
    return (await res.json()) as FleetModelsResponse;
  } catch {
    return null;
  }
}

function offlineCatalogFallback(): FleetModelsResponse {
  return {
    success: true,
    forcedCliBackend: detectForcedCliBackend(),
    pdUseCliBackend: detectForcedCliBackendValue(),
    backends: BACKEND_CATALOG.map((b) => ({
      id: b.id,
      name: b.name,
      models: [...b.models],
      costModel: b.costModel,
      framing: b.framing,
      description: b.description,
      tagline: b.tagline,
      recommended: b.recommended,
      pdUseCliBackendValue: b.pdUseCliBackendValue,
      adapter: b.adapter,
      isForcedByEnv: detectForcedCliBackend() === b.id,
      readinessStatus: 'unknown',
      readinessSummary: 'daemon unreachable — readiness not probed',
    })),
  };
}

function probeBadge(status: HarnessProbeStatus): string {
  switch (status) {
    case 'discovered': return '◐ discovered';
    case 'unavailable': return '○ unavailable';
    case 'not-supported': return '— handoff';
    case 'unverified': return '? unverified';
  }
}

async function fetchDaemonMatrix(): Promise<HarnessContinuationMatrixReport | null> {
  try {
    const res = await pdFetch('/harness-adapters/continuation-matrix');
    if (!res.ok) return null;
    const body = await res.json();
    return (body.data as HarnessContinuationMatrixReport | undefined) ?? null;
  } catch {
    return null;
  }
}

async function adaptersCommand(options: CLIOptions): Promise<void> {
  const rows = harnessAdapterCapabilityRows();
  const probe = options.probe ? probeHarnessAdapters() : null;
  // Prefer the daemon's matrix: it carries durable witnesses (spawn transcripts,
  // continuation receipts). The local build is a mechanics-only fallback that can
  // never show a witnessed cell — rendering it while a daemon is up would keep
  // the CLI lying "0 witnessed" forever.
  const daemonMatrix = (await isDaemonRunning()) ? await fetchDaemonMatrix() : null;
  const matrix = daemonMatrix ?? buildHarnessContinuationMatrix({ discovery: probe });
  const matrixSource: 'daemon' | 'local-mechanics-only' = daemonMatrix ? 'daemon' : 'local-mechanics-only';
  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, adapters: rows, probe, matrixSource, matrix }, null, 2));
    return;
  }

  console.log('');
  ui.info('Harness adapter contract — N adapters, never N² bridges');
  console.log('');
  process.stdout.write(renderHarnessAdapterMarkdown(rows));
  console.log('');
  ui.info(
    `${matrix.summary.adapterFamilies} adapter families × ${matrix.summary.adapterFamilies} targets = ${matrix.summary.paths} paths: `
    + `${matrix.summary.nativePaths} native, ${matrix.summary.handoffPaths} sanitized handoff, `
    + `${matrix.summary.unsupportedPaths} unsupported.`,
  );
  if (matrixSource === 'daemon') {
    ui.info(
      `Daemon-witnessed evidence: ${matrix.summary.witnessedPaths} witnessed path(s), `
      + `${matrix.summary.witnessedPredicates} witnessed predicate(s). `
      + 'Run `pd continuation matrix` for per-cell witness ids.',
    );
  } else {
    ui.info('Daemon unreachable — mechanics-only local matrix; witnessed cells cannot be shown offline.');
  }

  if (options.matrix) {
    console.log('');
    process.stdout.write(renderHarnessContinuationMatrix(matrix));
  } else {
    ui.info('Run `pd backend adapters --matrix` for the indexed N×N compatibility grid.');
  }

  if (!probe) {
    console.log('');
    ui.info('Run `pd backend adapters --probe` to discover local binaries, advertised flags, and declared transcript roots.');
    console.log('');
    return;
  }

  console.log('');
  ui.info('Discovery only — this does not prove spawn, resume, or transcript conformance');
  console.log('');
  for (const adapter of probe.adapters) {
    console.log(`  ${adapter.family}`);
    console.log(`    spawn       ${probeBadge(adapter.spawn.status)} — ${adapter.spawn.detail}`);
    console.log(`    resume      ${probeBadge(adapter.resume.status)} — ${adapter.resume.detail}`);
    console.log(`    transcript  ${probeBadge(adapter.transcript.status)} — ${adapter.transcript.detail}`);
  }
  console.log('');
}

function rankBackends(entries: FleetModelEntry[]): FleetModelEntry[] {
  // Recommended (subscription) first, then ready+available, then by id.
  return [...entries].sort((a, b) => {
    const aSub = a.costModel === 'subscription' ? 1 : 0;
    const bSub = b.costModel === 'subscription' ? 1 : 0;
    if (aSub !== bSub) return bSub - aSub;
    const aAvail = a.available || a.launchable ? 1 : 0;
    const bAvail = b.available || b.launchable ? 1 : 0;
    if (aAvail !== bAvail) return bAvail - aAvail;
    return a.id.localeCompare(b.id);
  });
}

function statusBadge(entry: FleetModelEntry): string {
  if (entry.isForcedByEnv) return '◉ ACTIVE';
  if (entry.available || entry.launchable) return '● ready';
  if (entry.readinessStatus === 'manual_check') return '◌ check';
  if (entry.readinessStatus === 'needs_setup') return '○ setup';
  if (entry.readinessStatus === 'unknown') return '? unknown';
  return '○ —';
}

function costModelBadge(costModel: string | undefined): string {
  switch (costModel) {
    case 'subscription':
      return '[FREE/sub]';
    case 'local':
      return '[FREE/local]';
    case 'metered':
      return '[metered]';
    case 'cli':
      return '[cli]';
    default:
      return '';
  }
}

async function listCommand(options: CLIOptions): Promise<void> {
  const availableOnly = Boolean(options.available || options['available-only']);
  const persisted = readPersistedSelection();
  const data = (await fetchBackends()) || offlineCatalogFallback();

  let backends = data.backends || [];
  if (availableOnly) {
    backends = backends.filter((b) => b.available || b.launchable);
  }
  backends = rankBackends(backends);

  if (isJson(options)) {
    console.log(
      JSON.stringify(
        {
          success: true,
          forcedCliBackend: data.forcedCliBackend ?? null,
          pdUseCliBackend: data.pdUseCliBackend ?? null,
          persistedSelection: persisted,
          backends,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('');
  ui.info('Fleet backend catalog');
  console.log('');

  if (data.forcedCliBackend) {
    const entry = backends.find((b) => b.id === data.forcedCliBackend);
    ui.success(`Forced via PD_USE_CLI_BACKEND=${data.pdUseCliBackend}`);
    if (entry) console.log(`    ${entry.name} — ${entry.framing || ''}`);
    console.log('');
  } else if (persisted) {
    ui.info(`Persisted selection: ${persisted} (~/.port-daddy-cli-backend)`);
    ui.info('  Activate in shell:  eval "$(pd backend use ' + persisted + ')"');
    console.log('');
  }

  for (const b of backends) {
    const cost = costModelBadge(b.costModel);
    const badge = statusBadge(b);
    const head = `${badge.padEnd(10)}  ${b.id.padEnd(18)} ${cost.padEnd(13)} ${b.name}`;
    console.log(head);
    if (b.framing) console.log(`              ${b.framing}`);
    if (b.tagline) console.log(`              ${b.tagline}`);
    if (b.pdUseCliBackendValue) {
      console.log(`              Switch:  pd backend use ${b.pdUseCliBackendValue}`);
    }
    if (!b.available && !b.launchable && b.readinessNextStep) {
      console.log(`              Setup:   ${b.readinessNextStep}`);
    }
    console.log('');
  }

  if (!data.forcedCliBackend) {
    ui.info('Pick a free-via-subscription backend (recommended):');
    const recs = backends.filter(
      (b) => b.costModel === 'subscription' && (b.available || b.launchable),
    );
    if (recs.length === 0) {
      console.log('  (none ready — install `claude` or `codex` to unlock)');
    } else {
      for (const r of recs) {
        if (!r.pdUseCliBackendValue) continue;
        console.log(`  pd backend use ${r.pdUseCliBackendValue}    # ${r.framing}`);
      }
    }
    console.log('');
  }
}

async function useCommand(target: string | undefined, options: CLIOptions): Promise<void> {
  const raw = (target || '').trim().toLowerCase();
  if (!raw || raw === 'none' || raw === 'off' || raw === 'clear') {
    persistSelection(null);
    if (isJson(options)) {
      console.log(JSON.stringify({ success: true, cleared: true }));
      return;
    }
    console.log('unset PD_USE_CLI_BACKEND');
    ui.info('Cleared PD_USE_CLI_BACKEND. Spawns fall back to pd-fleet.yml defaults.');
    return;
  }

  // Accept either the catalog id (`cli:claude-code`) or the short env value
  // (`claude-code`, `codex`).
  let entry: BackendCatalogEntry | undefined =
    BACKEND_CATALOG.find((b) => b.pdUseCliBackendValue === raw) ||
    getBackendCatalogEntry(raw);

  if (!entry || !entry.pdUseCliBackendValue) {
    ui.error(`No CLI-routable backend matches "${target}".`);
    ui.info('Valid choices: claude-code, codex, none');
    process.exitCode = 1;
    return;
  }

  persistSelection(entry.pdUseCliBackendValue);
  const exportLine = `export PD_USE_CLI_BACKEND=${entry.pdUseCliBackendValue}`;

  if (isJson(options)) {
    console.log(
      JSON.stringify(
        {
          success: true,
          backend: entry.id,
          pdUseCliBackend: entry.pdUseCliBackendValue,
          exportLine,
          persisted: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  // First line is meant to be eval'd. Everything else goes to stderr/info so
  // shells evaluating the output don't choke on it.
  console.log(exportLine);
  ui.info(`Persisted choice → ~/.port-daddy-cli-backend (${entry.pdUseCliBackendValue})`);
  ui.info(`Framing: ${entry.framing}`);
  if (entry.tagline) ui.info(entry.tagline);
  ui.info('To activate in the current shell: eval "$(pd backend use ' + entry.pdUseCliBackendValue + ')"');
}

function parseSinceSpec(spec: string | undefined): number {
  if (!spec) return 86_400;
  const m = /^(\d+)\s*([smhd])?$/i.exec(spec.trim());
  if (!m) {
    const n = parseInt(spec, 10);
    if (Number.isFinite(n) && n > 0) return n;
    return 86_400;
  }
  const value = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  const mult = unit === 'd' ? 86_400 : unit === 'h' ? 3_600 : unit === 'm' ? 60 : 1;
  return value * mult;
}

interface CostByBackendRow {
  backend: string;
  totalUsd?: number;
  total_usd?: number;
  spawnCount?: number;
  spawn_count?: number;
}

interface CostMetricsResponse {
  since?: number;
  totals?: { totalUsd?: number; spawnCount?: number; estimatedCount?: number };
  byBackend?: CostByBackendRow[];
}

async function costCommand(options: CLIOptions): Promise<void> {
  let sinceSecs: number;
  let windowLabel: string;
  if (options.today) {
    sinceSecs = 86_400;
    windowLabel = 'today';
  } else if (options.week) {
    sinceSecs = 7 * 86_400;
    windowLabel = 'this week';
  } else if (options.month) {
    sinceSecs = 30 * 86_400;
    windowLabel = 'this month';
  } else if (typeof options.since === 'string') {
    sinceSecs = parseSinceSpec(options.since);
    windowLabel = options.since;
  } else {
    sinceSecs = 86_400;
    windowLabel = 'today';
  }

  try {
    const res = await pdFetch(`/metrics/cost?since=${sinceSecs}`);
    if (!res.ok) {
      ui.error(`Failed to fetch cost metrics: HTTP ${res.status}`);
      process.exitCode = 1;
      return;
    }
    const data = (await res.json()) as CostMetricsResponse;
    const rows = (data.byBackend || []).map((row) => ({
      backend: row.backend,
      totalUsd: row.totalUsd ?? row.total_usd ?? 0,
      spawnCount: row.spawnCount ?? row.spawn_count ?? 0,
    }));
    rows.sort((a, b) => b.totalUsd - a.totalUsd);

    if (isJson(options)) {
      console.log(
        JSON.stringify(
          {
            window: windowLabel,
            sinceSecs,
            totalUsd: data.totals?.totalUsd ?? 0,
            byBackend: rows,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log('');
    ui.info(`Fleet backend spend — ${windowLabel}`);
    console.log('');

    if (rows.length === 0) {
      console.log('  (no spawns recorded in this window)');
      console.log('');
      return;
    }

    const totalLabel = `Total: $${(data.totals?.totalUsd ?? 0).toFixed(4)}  (${data.totals?.spawnCount ?? 0} spawn${data.totals?.spawnCount === 1 ? '' : 's'})`;
    console.log('  ' + totalLabel);
    console.log('');

    for (const row of rows) {
      const entry = getBackendCatalogEntry(row.backend);
      const framing = entry?.framing || '';
      const cost = costModelBadge(entry?.costModel);
      const usdStr = `$${row.totalUsd.toFixed(4)}`.padStart(10);
      console.log(`  ${row.backend.padEnd(20)} ${usdStr}  ${row.spawnCount.toString().padStart(4)} spawns  ${cost} ${framing}`);
    }
    console.log('');
  } catch (err) {
    ui.error(`Failed to fetch cost metrics: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function printHelp(): void {
  console.log('');
  ui.info('pd backend — fleet backend selection + cost surface');
  console.log('');
  console.log('Usage:');
  console.log('  pd backend list                Show all backends + readiness');
  console.log('  pd backend list --available    Only backends ready to launch right now');
  console.log('  pd backend list --json         Machine-readable (FleetBar/dashboard)');
  console.log('');
  console.log('  pd backend use claude-code     Use Claude Code (FREE — Claude Max subscription)');
  console.log('  pd backend use codex           Use Codex CLI (FREE — ChatGPT Pro subscription)');
  console.log('  pd backend use none            Clear forced backend (fall back to pd-fleet.yml)');
  console.log('');
  console.log('  pd backend cost --today        Spend rollup by backend, last 24h');
  console.log('  pd backend cost --week         Last 7 days');
  console.log('  pd backend cost --month        Last 30 days');
  console.log('  pd backend cost --since 12h    Custom window');
  console.log('');
  console.log('  pd backend adapters            Show the generated N:N harness contract');
  console.log('  pd backend adapters --probe    Discover local adapter advertisements without a model call');
  console.log('  pd backend adapters --matrix   Print the indexed N×N native/handoff compatibility grid');
  console.log('  pd backend adapters --json     Machine-readable contract, matrix, and probe report');
  console.log('');
  console.log('Activate a choice in your shell:');
  console.log('  eval "$(pd backend use claude-code)"');
  console.log('');
}

export async function handleBackend(
  positional: string[],
  options: CLIOptions,
): Promise<void> {
  const sub = (positional[0] || 'list').toLowerCase();
  switch (sub) {
    case 'list':
    case 'ls':
      await listCommand(options);
      return;
    case 'use':
    case 'set':
      await useCommand(positional[1], options);
      return;
    case 'cost':
      await costCommand(options);
      return;
    case 'adapters':
    case 'capabilities':
      await adaptersCommand(options);
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
