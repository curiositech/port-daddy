/**
 * Fleet CLI — TypeScript port of fleet/pd-fleet.sh
 *
 * Manages background agent fleet: up/down/status + individual agent runs.
 * Uses pd spawn for all agent execution — dogfoods our own primitives.
 */

import { join, basename } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { createIpcClient } from '../../lib/ipc-client.js';
import { IpcAction, Performative } from '../../lib/ipc-types.js';
import * as ui from '../utils/ui.js';
import { pdFetch, isDaemonRunning, getDaemonUrl, PORT_DADDY_URL } from '../utils/fetch.js';
import { isJson, isQuiet, type CLIOptions } from '../types.js';
import {
  findFleetConfigPath,
  loadFleetConfig,
  createFleetRunner,
  getFleetRuntimeDefaults,
  resolveFleetAgentRuntime,
  validateTopology,
} from '../../lib/fleet-engine.js';
import { assessBackendReadiness } from '../../lib/backend-readiness.js';
import { resolveFleetChannel } from '../../lib/fleet-channels.js';
import { ensureStarterFleetProject } from '../../lib/fleet-bootstrap.js';
import { DEFAULT_IPC } from '../../shared/paths.js';
import {
  resolveFleetRunningState,
  describeFleetRunningState,
  type FleetRunningState,
} from '../../lib/fleet-running-state.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { preflightInterruptionsGate } from './interruptions.js';

// ─── Load .env.local / .env for API keys ────────────────────────────────────
// Searches: cwd, parent dir, home directory. Later files overwrite earlier ones,
// so cwd takes precedence over home, and .env.local over .env within each dir.
function loadEnvFiles(): void {
  const searchDirs = [
    process.cwd(),
    join(process.cwd(), '..'),  // parent (in case we're in a subdir)
    process.env.HOME || '',
  ];

  const fileNames = ['.env.local', '.env', '.port-daddy-env'];

  for (const dir of searchDirs) {
    if (!dir) continue;
    for (const name of fileNames) {
      const envPath = join(dir, name);
      if (existsSync(envPath)) {
        const lines = readFileSync(envPath, 'utf-8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx === -1) continue;
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          // Strip surrounding quotes
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          process.env[key] = val;
        }
      }
    }
  }
}

// Load env on module init — before any agent runs
loadEnvFiles();

const PD_URL = process.env.PD_URL || process.env.PORT_DADDY_URL || getDaemonUrl();
const LOCAL_EXECUTION_BACKENDS = new Set(['claude-cli', 'codex', 'ollama', 'aider', 'custom']);

interface FleetModelBackend {
  id: string;
  name?: string;
  models?: string[];
  modelTiers?: Partial<Record<'low' | 'mid' | 'high', string>>;
  supported?: boolean;
  readinessStatus?: string;
  readinessSummary?: string;
  readinessNextStep?: string;
  credentialKeys?: string[];
  credentialAlternates?: string[];
  setupCommand?: string;
  setupFiles?: string[];
  setupLinks?: Array<{ label?: string; url?: string; kind?: string }>;
  restartRequired?: boolean;
}

interface FleetModelsResponse {
  success?: boolean;
  backends?: FleetModelBackend[];
  error?: string;
}

async function getFleetPromptLineViaIpc(project: string, since?: number): Promise<string | null> {
  if (process.env.PD_URL || process.env.PORT_DADDY_URL || process.env.PORT_DADDY_SOCK) return null;
  const socketPath = process.env.PORT_DADDY_IPC || DEFAULT_IPC;
  if (!existsSync(socketPath)) return null;

  const ipc = createIpcClient({
    socketPath,
    agentId: 'pd-cli-fleet-prompt',
    reconnect: false,
    requestTimeout: 1000,
  });

  try {
    await ipc.connect();
    const frame = await ipc.request(
      Performative.QUERY_REF,
      { action: IpcAction.FLEET_PROMPT, project, since },
      1000,
    );
    if (frame.type !== Performative.INFORM_DONE) return null;
    const result = frame.payload.result as { success?: boolean; line?: string } | undefined;
    return result?.success ? (result.line || '') : null;
  } catch {
    return null;
  } finally {
    ipc.destroy();
  }
}

/**
 * Standalone-fork state reader for `resolveFleetRunningState`. Encapsulates
 * the historic .portdaddy/fleet-state.json contract — alive PID = running.
 * Also opportunistically cleans up the state file when its PID is dead, so
 * stale state from a crashed standalone fleet doesn't persist forever.
 */
const STANDALONE_STATE_READER = {
  readState(cwd: string): { pid: number; name?: string } | null {
    const stateFile = join(cwd, '.portdaddy', 'fleet-state.json');
    if (!existsSync(stateFile)) return null;
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      return { pid: state.pid, name: state.name };
    } catch {
      return null;
    }
  },
  isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // throws if not running
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Fetch the daemon's per-project fleet status for `resolveFleetRunningState`.
 * Returns null when the daemon is unreachable so the resolver falls back to
 * the standalone-fork view; never throws.
 */
async function fetchDaemonFleetStatus(): Promise<Parameters<typeof resolveFleetRunningState>[0]['daemonFleetStatus']> {
  try {
    const res = await pdFetch('/fleet');
    if (!res.ok) return null;
    const body = await res.json() as any;
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

async function getFleetRunningState(): Promise<FleetRunningState> {
  const daemonFleetStatus = await fetchDaemonFleetStatus();
  const state = resolveFleetRunningState({
    cwd: process.cwd(),
    standalone: STANDALONE_STATE_READER,
    daemonFleetStatus,
  });
  // Opportunistic cleanup of dead-PID state files. Kept here (not in the
  // pure resolver) so the resolver stays side-effect-free.
  if (!state.running) {
    const stateFile = join(process.cwd(), '.portdaddy', 'fleet-state.json');
    if (existsSync(stateFile)) {
      const standaloneRecord = STANDALONE_STATE_READER.readState(process.cwd());
      if (standaloneRecord && !STANDALONE_STATE_READER.isPidAlive(standaloneRecord.pid)) {
        try { unlinkSync(stateFile); } catch {}
      }
    }
  }
  return state;
}

async function getFleetAgents(config: ReturnType<typeof loadFleetConfig>): Promise<Array<{ id: string; purpose: string; status: string }>> {
  if (!config) return [];
  const harbor = config.harbor || `${config.name}:fleet`;
  try {
    const [harborRes, agentsRes] = await Promise.all([
      pdFetch(`/harbors/${encodeURIComponent(harbor)}/members`),
      pdFetch('/agents'),
    ]);
    if (!harborRes.ok) return [];

    const harborData = await harborRes.json() as any;
    const members = Array.isArray(harborData.members) ? harborData.members : [];

    const liveAgents = agentsRes.ok
      ? (((await agentsRes.json()) as any).agents || []) as Array<{ id: string; purpose?: string; status?: string }>
      : [];
    const liveAgentById = new Map(liveAgents.map((agent) => [agent.id, agent]));

    return members.map((member: any) => {
      const live = liveAgentById.get(member.agentId);
      return {
        id: member.agentId,
        purpose: live?.purpose || member.identity || `Fleet member in ${harbor}`,
        status: live?.status || 'registered',
      };
    });
  } catch {
    return [];
  }
}

// ─── fleet init ─────────────────────────────────────────────────────────────

async function fleetInit(): Promise<void> {
  const cwd = process.cwd();
  const fleetPath = join(cwd, 'pd-fleet.yml');

  // Check if already initialized
  if (existsSync(fleetPath)) {
    ui.warn('pd-fleet.yml already exists in this directory');
    ui.info('Edit it to customize your fleet, then run: pd fleet up');
    return;
  }
  const bootstrap = ensureStarterFleetProject(cwd);
  ui.success('Created pd-fleet.yml with 5 agents: QA, documentarian, cartographer, spark, spider');

  switch (bootstrap.hookStatus) {
    case 'created':
      ui.success('Installed .git/hooks/post-commit (publishes to the project-scoped git:committed channel)');
      break;
    case 'upgraded':
      ui.success('Upgraded legacy .git/hooks/post-commit to the project-scoped git:committed channel');
      break;
    case 'merged':
      ui.success('Added fleet trigger to existing .git/hooks/post-commit');
      break;
    case 'already_current':
      ui.info('Git post-commit hook already publishes to the project-scoped git:committed channel');
      break;
    case 'skipped_no_git':
      ui.warn('No .git directory found — skipping post-commit hook');
      ui.info('Run this inside a git repo to get automatic fleet triggers on commit');
      break;
    case 'missing_template':
      ui.warn('Port Daddy could not load its post-commit hook template');
      break;
  }

  if (bootstrap.addedGitignoreEntries.length > 0) {
    ui.info(`Added ${bootstrap.addedGitignoreEntries.join(', ')} to .gitignore`);
  }
  for (const warning of bootstrap.warnings) {
    ui.warn(warning);
  }

  console.log('');
  ui.info('Next steps:');
  console.log('  1. Pin a backend + model for each agent, or set PD_FLEET_DEFAULT_BACKEND / PD_FLEET_DEFAULT_MODEL');
  console.log('  2. Edit pd-fleet.yml to customize agent prompts');
  console.log('  3. Run: pd fleet up');
  console.log('  4. Commit something — watch the agents fire');
  console.log('');
}

// ─── Subcommands ────────────────────────────────────────────────────────────

// Module-level fleet runner (persists for the lifetime of the CLI process)
let activeRunner: ReturnType<typeof createFleetRunner> | null = null;

function compactSetupCommand(command: string | undefined): string | null {
  const trimmed = command?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' && ');
}

function formatModelTierLine(tier: 'low' | 'mid' | 'high', model?: string): string {
  return `  ${tier.padEnd(4)} ${model || '-'}`;
}

function printFleetModelBackend(backend: FleetModelBackend, detailed: boolean): void {
  const label = backend.name ? `${backend.id} — ${backend.name}` : backend.id;
  const status = backend.readinessStatus || 'unknown';
  console.log(`${label} [${status}]`);

  if (backend.modelTiers) {
    console.log(formatModelTierLine('low', backend.modelTiers.low));
    console.log(formatModelTierLine('mid', backend.modelTiers.mid));
    console.log(formatModelTierLine('high', backend.modelTiers.high));
  } else if (backend.models?.length) {
    console.log(`  models ${backend.models.join(', ')}`);
  } else {
    console.log('  models -');
  }

  if (backend.readinessSummary) {
    console.log(`  readiness: ${backend.readinessSummary}`);
  }

  if (detailed) {
    if (backend.readinessNextStep) {
      console.log(`  next: ${backend.readinessNextStep}`);
    }
    if (backend.credentialKeys?.length) {
      console.log(`  credentials: ${backend.credentialKeys.join(', ')}`);
    }
    if (backend.credentialAlternates?.length) {
      console.log(`  alternates: ${backend.credentialAlternates.join(', ')}`);
    }
    if (backend.setupLinks?.length) {
      for (const link of backend.setupLinks) {
        const label = link.label || link.kind || 'link';
        const url = link.url || '';
        console.log(`  link: ${label}${url ? ` - ${url}` : ''}`);
      }
    }
    const setup = compactSetupCommand(backend.setupCommand);
    if (setup) {
      console.log(`  setup: ${setup}`);
    }
  }

  console.log('');
}

async function fleetModels(options: CLIOptions, positionalBackend?: string): Promise<void> {
  const backendFilter = (
    positionalBackend
    || (typeof options.backend === 'string' ? options.backend : undefined)
  )?.trim();

  const res = await pdFetch('/fleet/models');
  const data = await res.json() as FleetModelsResponse;
  if (!res.ok || data.success === false) {
    ui.error(data.error || `Failed to load fleet models: HTTP ${'status' in res ? res.status : 'unknown'}`);
    process.exit(1);
    return;
  }

  const backends = Array.isArray(data.backends) ? data.backends : [];
  const selected = backendFilter
    ? backends.filter((backend) => backend.id === backendFilter)
    : backends;

  if (backendFilter && selected.length === 0) {
    ui.error(`Unknown backend: ${backendFilter}`);
    if (backends.length > 0) {
      ui.info(`Available: ${backends.map((backend) => backend.id).join(', ')}`);
    }
    process.exit(1);
    return;
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, backends: selected }, null, 2));
    return;
  }

  ui.info(backendFilter
    ? `Fleet backend model tiers: ${backendFilter}`
    : 'Fleet backend model tiers');
  console.log('');

  const detailed = Boolean(backendFilter || options.verbose || options.details);
  for (const backend of selected) {
    printFleetModelBackend(backend, detailed);
  }
}

/**
 * Split a fleet config's agents into enabled vs paused for a partial
 * `pd fleet up <ship...>`. No ships requested = everything enabled.
 */
export function partitionFleetShips(
  config: { agents: Array<{ name: string }> },
  ships: string[],
): { ok: true; enabled: string[]; paused: string[] } | { ok: false; error: string } {
  const known = config.agents.map((agent) => agent.name);
  if (ships.length === 0) {
    return { ok: true, enabled: known, paused: [] };
  }
  const knownSet = new Set(known);
  const unknown = ships.filter((name) => !knownSet.has(name));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Unknown ship(s): ${unknown.join(', ')}. Available: ${known.join(', ')}`,
    };
  }
  const requested = new Set(ships);
  return {
    ok: true,
    enabled: ships,
    paused: known.filter((name) => !requested.has(name)),
  };
}

async function fleetUp(ships: string[] = []): Promise<void> {
  if (!(await isDaemonRunning())) {
    ui.error('Port Daddy daemon not running. Start it first: pd start');
    process.exit(1);
  }

  const projectDir = process.cwd();
  const config = loadFleetConfig(projectDir);

  let selection: { enabled: string[]; paused: string[] } = { enabled: [], paused: [] };
  if (ships.length > 0) {
    if (!config) {
      ui.error('No pd-fleet.yml found — cannot select ships.');
      process.exit(1);
      return;
    }
    const partition = partitionFleetShips(config, ships);
    if (!partition.ok) {
      ui.error(partition.error);
      process.exit(1);
      return;
    }
    selection = partition;
  }

  const state = await getFleetRunningState();
  if (state.running) {
    if (state.source === 'daemon-supervised' && ships.length > 0) {
      // Daemon supervises this fleet: apply the subset in place.
      const res = await pdFetch('/fleet/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, enabledAgents: selection.enabled }),
      });
      const body = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!res.ok || body.success === false) {
        ui.error(`Could not apply ship selection: ${body.error ?? 'daemon error'}`);
        process.exit(1);
        return;
      }
      ui.success(`Fleet "${state.name ?? config?.name ?? ''}" now sailing a partial fleet:`);
      for (const name of selection.enabled) ui.success(`  ${name} — enabled`);
      for (const name of selection.paused) ui.info(`  ${name} — paused`);
      ui.info('  Watch them go: pd fleet status');
      return;
    }
    if (state.source === 'daemon-supervised') {
      ui.warn(`Fleet "${state.name}" already supervised by the daemon (${describeFleetRunningState(state)})`);
      ui.info('  Status: pd fleet status');
      ui.info('  Stop:   pd fleet down');
      ui.info('  Partial fleet: pd fleet up <ship...> to enable only some ships');
    } else {
      ui.warn(`Fleet already running (Dock Master PID ${state.pid})`);
      ui.info('  Status: pd fleet status');
      ui.info('  Stop:   pd fleet down');
      if (ships.length > 0) {
        ui.info('  Ship selection needs the fleet restarted: pd fleet down, then pd fleet up ' + ships.join(' '));
      }
    }
    return;
  }

  if (config) {
    // ─── Declarative mode: pd-fleet.yml found ───────────────────────
    const partial = selection.paused.length > 0;
    ui.info(`Starting fleet "${config.name}" from pd-fleet.yml`);
    ui.info(`  Agents: ${partial ? `${selection.enabled.length} of ${config.agents.length} (partial fleet)` : config.agents.length}`);
    ui.info(`  Watchers: ${config.watchers.length}`);
    ui.info(`  Channels: ${Object.keys(config.channels).length}`);
    console.log('');

    activeRunner = createFleetRunner(
      config,
      projectDir,
      partial ? { initiallyPausedAgents: selection.paused } : undefined,
    );
    activeRunner.startAll();

    // Save state so pd fleet status/stop can find it
    const stateFile = join(projectDir, '.portdaddy', 'fleet-state.json');
    const pausedSet = new Set(selection.paused);
    const enabledAgents = config.agents.filter(a => !pausedSet.has(a.name));
    try {
      mkdirSync(join(projectDir, '.portdaddy'), { recursive: true });
      writeFileSync(stateFile, JSON.stringify({
        pid: process.pid,
        name: config.name,
        agents: enabledAgents.map(a => a.name),
        pausedAgents: selection.paused,
        watchers: config.watchers.map(w => w.name),
        startedAt: new Date().toISOString(),
      }));
    } catch {
      // Non-fatal: status/stop fall back to daemon discovery.
    }

    for (const agent of enabledAgents) {
      const mode = agent.schedule ? `schedule: ${agent.schedule}` : `trigger: ${agent.trigger}`;
      ui.success(`  ${agent.name} (${agent.backend}) — ${mode}`);
    }
    for (const name of selection.paused) {
      ui.info(`  ${name} — paused (not selected)`);
    }
    for (const watcher of config.watchers) {
      ui.success(`  ${watcher.name} (watcher) — trigger: ${watcher.trigger}`);
    }

    console.log('');
    ui.info('Fleet running. Press Ctrl+C to stop, or: pd fleet down');

    // Keep the process alive (fleet runs in this process)
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => {
        ui.info('Stopping fleet...');
        activeRunner?.stopAll();
        try { unlinkSync(stateFile); } catch {}
        resolve();
      });
      process.on('SIGTERM', () => {
        activeRunner?.stopAll();
        try { unlinkSync(stateFile); } catch {}
        resolve();
      });
    });

  } else {
    ui.error('No pd-fleet.yml found.');
    ui.info('Create a pd-fleet.yml in your project root to define your agent fleet.');
    ui.info('See: pd fleet help');
    process.exit(1);
  }
}

async function fleetDown(options: CLIOptions = {}): Promise<void> {
  const state = await getFleetRunningState();
  const stateFile = join(process.cwd(), '.portdaddy', 'fleet-state.json');

  if (state.source === 'daemon-supervised') {
    const ok = await requireConfirmation({
      summary: `Fleet down will stop the daemon-supervised fleet${state.name ? ` "${state.name}"` : ''}. All scheduled and trigger-driven agents stop until you run pd fleet up again.`,
      args: options as Record<string, unknown>,
    });
    if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

    try {
      const res = await pdFetch('/fleet/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir: process.cwd() }),
      } as any);
      if (res.ok) {
        ui.success(`Fleet "${state.name}" stopped (daemon-supervised)`);
        return;
      }
      const body = await res.json() as any;
      ui.error(`Could not stop daemon-supervised fleet: ${body?.error ?? `HTTP ${res.status}`}`);
      return;
    } catch (err) {
      ui.error(`Could not reach daemon to stop fleet: ${(err as Error).message}`);
      return;
    }
  }

  if (!state.running || !state.pid) {
    ui.info('No fleet running');
    return;
  }

  const ok = await requireConfirmation({
    summary: `Fleet down will SIGTERM the running fleet${state.name ? ` "${state.name}"` : ''} (PID ${state.pid}). All scheduled and trigger-driven agents stop until you run pd fleet up again.`,
    args: options as Record<string, unknown>,
  });
  if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);

  try { process.kill(state.pid, 'SIGTERM'); } catch {}
  try { unlinkSync(stateFile); } catch {}
  ui.success('Fleet stopped');
}

async function fleetStatus(): Promise<void> {
  console.log('');
  ui.info('Port Daddy Fleet');
  console.log('');
  const defaults = getFleetRuntimeDefaults();

  const state = await getFleetRunningState();
  if (state.running) {
    ui.success(`Fleet "${state.name || 'unnamed'}": ${describeFleetRunningState(state)}`);
  } else {
    // Check for pd-fleet.yml
    const config = loadFleetConfig(process.cwd());
    if (config) {
      ui.warn(`Fleet "${config.name}" defined in pd-fleet.yml but not running`);
      ui.info(`  Start with: pd fleet up`);
    } else {
      ui.warn('No fleet running, no pd-fleet.yml found');
    }
  }

  const config = loadFleetConfig(process.cwd());

  console.log('');
  ui.info('Configured agents:');
  if (!config) {
    console.log('  (no pd-fleet.yml)');
  } else if (config.agents.length === 0) {
    console.log('  (none)');
  } else {
    for (const agent of config.agents) {
      const runtime = resolveFleetAgentRuntime(agent);
      const mode = agent.schedule ? `schedule ${agent.schedule}` : `trigger ${agent.trigger}`;
      const backend = runtime.backend || 'MISSING';
      const model = runtime.model || (backend === 'claude-cli' ? 'CLI default' : runtime.modelTier ? `${runtime.modelTier} tier (unmapped)` : 'backend default');
      const fallbacks = (agent.fallbacks || []).map((fallback) => {
        const fallbackRuntime = resolveFleetAgentRuntime({
          backend: fallback.backend || agent.backend,
          model: fallback.model,
          modelTier: fallback.modelTier,
        });
        const fallbackBackend = fallbackRuntime.backend || 'MISSING';
        const fallbackModel = fallbackRuntime.model
          || (fallbackRuntime.modelTier ? `${fallbackRuntime.modelTier} tier` : (fallbackBackend === 'claude-cli' ? 'CLI default' : 'backend default'));
        return `${fallbackBackend}/${fallbackModel}`;
      });
      const warnings = runtime.warnings.length > 0 ? ` [${runtime.warnings.join('; ')}]` : '';
      const fallbackText = fallbacks.length > 0 ? ` / fallbacks: ${fallbacks.join(' -> ')}` : '';
      console.log(`  ${agent.name} — ${backend} / ${model} / ${mode}${fallbackText}${warnings}`);
    }
  }

  console.log('');
  ui.info('Fleet runtime defaults:');
  console.log(`  backend: ${defaults.backend || '(unset)'}`);
  console.log(`  model:   ${defaults.model || '(unset)'}`);

  console.log('');
  ui.info('Backend readiness:');
  if (!config) {
    console.log('  (no pd-fleet.yml)');
  } else {
    const configuredBackends = new Set<string>();
    if (defaults.backend) configuredBackends.add(defaults.backend);

    for (const agent of config.agents) {
      const runtime = resolveFleetAgentRuntime(agent);
      if (runtime.backend) configuredBackends.add(runtime.backend);
      for (const fallback of agent.fallbacks || []) {
        const fallbackRuntime = resolveFleetAgentRuntime({
          backend: fallback.backend || agent.backend,
          model: fallback.model,
          modelTier: fallback.modelTier,
        });
        if (fallbackRuntime.backend) configuredBackends.add(fallbackRuntime.backend);
      }
    }

    if (configuredBackends.size === 0) {
      console.log('  (no backends resolved)');
    } else {
      const readinessChecks = await Promise.all(
        [...configuredBackends].sort().map((backend) => assessBackendReadiness(backend))
      );
      for (const readiness of readinessChecks) {
        const statusIcon = readiness.status === 'ready'
          ? '+'
          : readiness.status === 'manual_check'
            ? '~'
            : '!';
        console.log(`  [${statusIcon}] ${readiness.backend} — ${readiness.summary}`);
        if (readiness.nextStep) {
          console.log(`      next: ${readiness.nextStep}`);
        }
      }

      if (readinessChecks.some((entry) => LOCAL_EXECUTION_BACKENDS.has(entry.backend))) {
        console.log('  [~] local execution note — local CLI backends and Port Daddy socket/IPC operations may need unsandboxed approval in restricted runners');
        console.log('      next: If you hit EPERM/EACCES/ENOENT while claiming ports or opening Port Daddy sockets, rerun the Port Daddy command with unsandboxed approval.');
      }
    }
  }

  // Fleet agents from PD registry
  console.log('');
  ui.info('Registered fleet agents:');
  const agents = await getFleetAgents(config);
  if (agents.length === 0) {
    console.log('  (none)');
  } else {
    for (const a of agents) {
      const statusIcon = a.status === 'ready' ? '+' : '~';
      console.log(`  [${statusIcon}] ${a.id} — ${a.purpose || '?'}`);
    }
  }

  // Recent fleet events
  console.log('');
  ui.info('Recent fleet events:');
  const currentProjectDir = process.cwd();
  const currentProjectName = basename(currentProjectDir);
  const channels = [
    'fleet:status', 'fleet:alert', 'git:committed',
    'qa:findings', 'docs:updated', 'tests:gap-filled',
    'spark:idea', 'spark:prototype',
  ].map((channel) => ({
    logical: channel,
    physical: resolveFleetChannel(channel, currentProjectDir, currentProjectName),
  }));

  const channelResults = await Promise.all(
    channels.map(async ({ logical, physical }) => {
      try {
        const res = await pdFetch(`/msg/${encodeURIComponent(physical)}?limit=1`);
        if (!res.ok) return null;
        const data = await res.json() as any;
        const msgs = data.messages || [];
        if (msgs.length === 0) return null;
        const ts = msgs[0].timestamp;
        const time = ts > 1000000000
          ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '?';
        const payload = typeof msgs[0].payload === 'string'
          ? msgs[0].payload.slice(0, 80)
          : JSON.stringify(msgs[0].payload).slice(0, 80);
        return `  ${logical}: ${time} — ${payload}`;
      } catch { return null; }
    })
  );

  const eventLines = channelResults.filter(Boolean) as string[];
  if (eventLines.length > 0) {
    eventLines.forEach(line => console.log(line));
  } else {
    console.log('  (no recent events)');
  }
}

function fleetValidate(): void {
  const configPath = findFleetConfigPath(process.cwd());
  if (!configPath) {
    ui.error('No pd-fleet.yml found');
    ui.info('Run "pd fleet init" to create a starter fleet.');
    process.exit(1);
  }

  console.log('');
  ui.info(`Validating ${configPath}`);
  console.log('');

  const raw = readFileSync(configPath, 'utf-8');
  if (!raw.trim()) {
    ui.error('Fleet config is empty');
    process.exit(1);
  }

  try {
    parseYaml(raw);
  } catch (err) {
    ui.error(`YAML parse failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const config = loadFleetConfig(process.cwd());
  if (!config) {
    ui.error('Fleet config could not be resolved after template expansion.');
    process.exit(1);
  }

  const topology = validateTopology(config);
  ui.success(`Fleet "${config.name}" parsed successfully`);
  console.log(`  agents:   ${config.agents.length}`);
  console.log(`  watchers: ${config.watchers.length}`);
  console.log(`  channels: ${Object.keys(config.channels).length}`);
  console.log(`  budget:   ${config.limits?.budgetUsdPerDay ?? '(missing)'}`);

  if (!topology.valid) {
    console.log('');
    ui.error('Topology invalid: trigger cycle(s) detected');
    for (const cycle of topology.cycles) {
      console.log(`  cycle: ${cycle.join(' -> ')}`);
    }
    process.exit(1);
  }

  console.log('');
  if (topology.warnings.length === 0) {
    ui.success('No topology warnings');
  } else {
    ui.warn(`Topology warnings (${topology.warnings.length}):`);
    for (const warning of topology.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  console.log('');
  ui.info('Dry-run checklist:');
  console.log('  - YAML syntax parsed');
  console.log('  - templates resolved');
  console.log('  - trigger graph checked for cycles');
  console.log('  - no agents were spawned');
}

/**
 * Run a single agent from the fleet config by name.
 *
 * For backends that need user auth (claude-cli), run locally via
 * child process — not through the daemon API. The daemon doesn't
 * have the user's Claude auth context.
 *
 * For simple backends (custom, ollama), use the daemon's spawn API.
 */
async function runAgentByName(agentName: string, preloadedConfig?: ReturnType<typeof loadFleetConfig>): Promise<void> {
  const config = preloadedConfig ?? loadFleetConfig(process.cwd());
  if (!config) {
    ui.error('No pd-fleet.yml found');
    process.exit(1);
  }

  const agent = config.agents.find(a => a.name === agentName);
  if (!agent) {
    ui.error(`Agent "${agentName}" not found in pd-fleet.yml`);
    ui.info(`Available: ${config.agents.map(a => a.name).join(', ')}`);
    process.exit(1);
  }

  const runtime = resolveFleetAgentRuntime(agent);
  if (!runtime.backend) {
    ui.error(`Agent "${agent.name}" has no backend configured`);
    ui.info('Set agent.backend in pd-fleet.yml or export PD_FLEET_DEFAULT_BACKEND');
    process.exit(1);
  }

  const budgetUsd = config.limits?.budgetUsdPerDay;
  if (budgetUsd == null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    ui.error(`Fleet agent "${agent.name}" cannot run without limits.budget_usd_per_day (or budgetUsdPerDay) in pd-fleet.yml`);
    process.exit(1);
  }

  ui.info(`Running ${agent.name} (${runtime.backend}${runtime.model ? ` / ${runtime.model}` : ''})...`);

  if (runtime.backend === 'claude-cli') {
    // Run locally — claude CLI needs user's auth context
    const args = ['-p', agent.prompt];
    if (runtime.model) args.push('--model', runtime.model);
    if (agent.allowedTools) args.push('--allowedTools', agent.allowedTools);

    // Ensure API keys are in the env for the child process
    // loadEnvFiles() already set process.env, so spread it
    const childEnv = { ...process.env, PD_URL };

    const child = spawn('claude', args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    await new Promise<void>((resolve) => {
      child.on('close', (code) => {
        if (code === 0) {
          ui.success(`${agent.name} completed`);
          if (stdout.trim()) console.log(stdout.trim());
        } else {
          ui.error(`${agent.name} failed (exit ${code})`);
          if (stderr.trim()) console.log(stderr.trim());
          if (stdout.trim()) console.log(stdout.trim());
          process.exitCode = 1;
        }
        resolve();
      });
    });

  } else {
    // Use daemon's spawn API for simple backends
    const res = await pdFetch('/spawn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: runtime.model,
        name: agent.name,
        task: agent.prompt,
        identity: agent.identity,
        purpose: `Fleet agent: ${agent.name}`,
        backend: runtime.backend,
        budgetUsd,
        timeout: agent.timeout,
        allowedTools: agent.allowedTools,
      }),
      timeout: (agent.timeout ?? 300000) + 10000,
    });

    const data = await res.json() as any;

    if (data.status === 'completed') {
      ui.success(`${agent.name} completed`);
      if (data.output) console.log(data.output);
    } else {
      ui.error(`${agent.name} failed: ${data.error || 'unknown'}`);
      if (data.output) console.log(data.output);
      process.exitCode = 1;
    }
  }
}

// ─── fleet panic / unpanic ─────────────────────────────────────────────────

interface PanicStatus {
  armed?: boolean;
  reason?: string | null;
  pendingConfirmation?: boolean;
}

async function fleetPanic(options: CLIOptions): Promise<void> {
  const reason = options.reason ? String(options.reason).trim() : '';
  if (!reason) {
    ui.error('Usage: pd fleet panic --reason "<text>" [--yes]');
    process.exit(1);
  }

  // Audit-trail emission for the destructive-confirm tier registry. The
  // verbatim "type YES" gate below is stronger than the standard helper, so
  // we record the impact summary and bypass-detection here, then keep the
  // existing stricter flow for the actual approval.
  const audited = await requireConfirmation({
    summary: `Fleet panic will SIGTERM every running fleet agent across all projects. Reason: ${reason}`,
    args: { ...options, yes: true } as Record<string, unknown>,
  });
  // audited is always true (we forced yes:true above) — its real purpose is
  // the stderr audit line. The actual gate is the "type YES" step below.
  void audited;

  const firstRes = await pdFetch(`${PORT_DADDY_URL}/fleet/panic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, confirm: false }),
  });
  const firstData = (await firstRes.json()) as PanicStatus & { error?: string };

  if (!firstRes.ok) {
    ui.error(firstData.error || `HTTP ${firstRes.status}`);
    process.exit(1);
  }

  const pending = firstData.pendingConfirmation;

  if (pending && !options.yes) {
    console.log('');
    ui.warn('PANIC will SIGTERM every running fleet agent across all projects.');
    ui.warn('Reason: ' + reason);
    console.log('');
    if (!ui.canPrompt()) {
      ui.error('Non-interactive session: pass --yes to confirm panic.');
      process.exit(DESTRUCTIVE_EXIT_CODE);
    }
    const typed = await ui.text({ label: 'Type YES to confirm (anything else cancels):', required: false });
    if ((typed || '').trim() !== 'YES') {
      ui.warn('Cancelled.');
      process.exit(DESTRUCTIVE_EXIT_CODE);
    }
  }

  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/panic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, confirm: true }),
  });
  const data = (await res.json()) as PanicStatus & { error?: string };

  if (!res.ok) {
    ui.error(data.error || `HTTP ${res.status}`);
    process.exit(1);
  }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('armed'); return; }
  ui.success(`Fleet PANIC armed — reason: ${reason}`);
}

async function fleetUnpanic(options: CLIOptions): Promise<void> {
  const reason = options.reason ? String(options.reason).trim() : '';
  if (!reason) {
    ui.error('Usage: pd fleet unpanic --reason "<text>"');
    process.exit(1);
  }

  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/unpanic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  const data = (await res.json()) as PanicStatus & { error?: string };

  if (!res.ok) {
    ui.error(data.error || `HTTP ${res.status}`);
    process.exit(1);
  }

  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('disarmed'); return; }
  ui.success(`Fleet PANIC disarmed — reason: ${reason}`);
}

// ─── fleet conductor control: halt / pause / resume / inspect / tree ─────────
// Operator control surface for the Daemon Fleet Conductor (ADR-0060). Each verb
// calls the conductor methods that already exist in the daemon:
//   halt   → POST /fleet/halt    (total: SIGTERM→SIGKILL the scope, refund bonds)
//   pause  → POST /fleet/pause   (soft: stop admitting, leave running agents)
//   resume → POST /fleet/resume  (reopen a halted/paused scope)
//   inspect/tree → GET /fleet/tree/:rootId (render the lineage tree)
// A bare verb targets the WHOLE fleet (global scope); `--root <id>` (or a
// positional rootId) targets one lineage subtree.

interface ConductorScopeResult {
  success?: boolean;
  scope?: string;
  halted?: string[];
  count?: number;
  paused?: boolean;
  resumed?: boolean;
  error?: string;
}

interface ConductorTreeResult {
  success?: boolean;
  rootId?: string;
  count?: number;
  tree?: Array<{
    id: string;
    parentId: string;
    depth: number;
    state: string;
    goal: string;
    source: string;
    bondUsd: number | null;
    lineageCeilingUsd: number | null;
    costUsd: number | null;
    agentId: string | null;
  }>;
  error?: string;
}

function resolveScopeRootId(options: CLIOptions, positional?: string): string | undefined {
  if (typeof options.root === 'string' && options.root.trim()) return options.root.trim();
  if (positional && positional.trim()) return positional.trim();
  return undefined;
}

async function fleetHalt(options: CLIOptions, positionalRootId?: string): Promise<void> {
  const rootId = resolveScopeRootId(options, positionalRootId);
  const scopeLabel = rootId ? `lineage ${rootId}` : 'the ENTIRE fleet (global)';
  // Halt is destructive (it SIGKILLs running agents) → confirm unless --yes.
  const confirmed = await requireConfirmation({
    summary: `Fleet halt will SIGTERM→SIGKILL every running launch in ${scopeLabel} and refund (never slash) their bonds.`,
    args: options as Record<string, unknown>,
  });
  if (!confirmed) {
    ui.warn('Cancelled.');
    process.exit(DESTRUCTIVE_EXIT_CODE);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/halt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rootId ? { rootId } : {}),
  });
  const data = (await res.json()) as ConductorScopeResult;
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }
  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log(`halted ${data.count ?? 0}`); return; }
  ui.success(`Fleet HALT (${data.scope ?? (rootId ?? 'global')}) — ${data.count ?? 0} launch(es) halted, bonds refunded.`);
}

async function fleetPauseConductor(options: CLIOptions, positionalRootId?: string): Promise<void> {
  const rootId = resolveScopeRootId(options, positionalRootId);
  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rootId ? { rootId } : {}),
  });
  const data = (await res.json()) as ConductorScopeResult;
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }
  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('paused'); return; }
  ui.success(`Fleet PAUSE (${data.scope ?? (rootId ?? 'global')}) — admission stopped; running agents left alive.`);
}

async function fleetResume(options: CLIOptions, positionalRootId?: string): Promise<void> {
  const rootId = resolveScopeRootId(options, positionalRootId);
  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(rootId ? { rootId } : {}),
  });
  const data = (await res.json()) as ConductorScopeResult;
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }
  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  if (isQuiet(options)) { console.log('resumed'); return; }
  ui.success(`Fleet RESUME (${data.scope ?? (rootId ?? 'global')}) — admission reopened.`);
}

async function fleetInspect(options: CLIOptions, positionalRootId?: string): Promise<void> {
  const rootId = resolveScopeRootId(options, positionalRootId);
  if (!rootId) {
    ui.error('Usage: pd fleet inspect <rootId>   (or: pd fleet tree <rootId>)');
    process.exit(1);
  }
  const res = await pdFetch(`${PORT_DADDY_URL}/fleet/tree/${encodeURIComponent(rootId)}`);
  const data = (await res.json()) as ConductorTreeResult;
  if (!res.ok) { ui.error(data.error || `HTTP ${res.status}`); process.exit(1); }
  if (isJson(options)) { console.log(JSON.stringify(data, null, 2)); return; }
  const nodes = data.tree ?? [];
  if (nodes.length === 0) {
    ui.warn(`No launches found for root ${rootId}.`);
    return;
  }
  // Render the lineage as an indented tree (depth-based indentation).
  console.log('');
  ui.info(`Fleet lineage — root ${rootId} (${nodes.length} launch${nodes.length === 1 ? '' : 'es'})`);
  console.log('');
  for (const n of nodes) {
    const indent = '  '.repeat(Math.max(0, n.depth));
    const cost = n.costUsd != null ? `$${n.costUsd.toFixed(4)}` : (n.bondUsd != null ? `~$${n.bondUsd.toFixed(4)}` : '$—');
    const ceiling = n.lineageCeilingUsd != null ? `cap $${n.lineageCeilingUsd}` : 'cap ∞';
    console.log(`${indent}• [${n.state}] ${n.source}  d${n.depth}  ${cost}  ${ceiling}`);
    console.log(`${indent}  ${n.goal.slice(0, 80)}${n.agentId ? `  (agent ${n.agentId})` : ''}`);
  }
  console.log('');
}

// ─── fleet prompt ───────────────────────────────────────────────────────────

async function fleetPrompt(): Promise<void> {
  // Prefer the declarative fleet name from pd-fleet.yml.
  // Fall back to git root basename so the prompt still works in undeclared repos.
  const config = loadFleetConfig(process.cwd());

  let projectName = config?.name || '';
  if (!projectName) {
    try {
      const { execFileSync } = await import('node:child_process');
      const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      projectName = root.split('/').pop() || '';
    } catch {
      projectName = process.cwd().split('/').pop() || '';
    }
  }

  if (!projectName) return; // silent exit — no project detected

  // Read last-check timestamp to avoid repeating old events
  const stateDir = join(process.cwd(), '.portdaddy');
  const promptStateFile = join(stateDir, 'prompt-last-check');
  let since: number | undefined;
  try {
    since = parseInt(readFileSync(promptStateFile, 'utf-8').trim(), 10);
  } catch {
    // No state file — show events from last 60s
  }

  try {
    const ipcLine = await getFleetPromptLineViaIpc(projectName, since);
    if (ipcLine !== null) {
      if (ipcLine) {
        process.stdout.write(ipcLine + '\n');
      }
      try {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(promptStateFile, String(Date.now()));
      } catch {
        // Non-critical
      }
      return;
    }

    const url = new URL(`${PD_URL}/fleet/prompt`);
    url.searchParams.set('project', projectName);
    if (since) url.searchParams.set('since', String(since));

    const res = await fetch(url.toString());
    if (!res.ok) return; // silent — daemon might be down

    const data = await res.json() as { success: boolean; line: string };
    if (data.line) {
      process.stdout.write(data.line + '\n');
    }

    // Update last-check timestamp
    try {
      const { mkdirSync, writeFileSync: fsWrite } = await import('node:fs');
      mkdirSync(stateDir, { recursive: true });
      fsWrite(promptStateFile, String(Date.now()));
    } catch {
      // Non-critical
    }
  } catch {
    // Silent — daemon not running, network error, etc.
    // The prompt hook must NEVER slow down or error the shell.
  }
}

// ─── Sources health board (I/O wiring Phase 2) ──────────────────────────────

/**
 * `pd fleet sources` — the I/O channel health board. Shows every trigger
 * source and output sink with its honest availability: REAL channels read
 * `ready`, STUB channels show their `{reason, requires}` instead of
 * pretending. Prefers the daemon's live view (which includes armed webhook
 * channel slugs); falls back to a local registry probe when the daemon is
 * down.
 */
async function fleetSources(options: CLIOptions): Promise<void> {
  interface ChannelHealth {
    kind: string;
    direction: 'trigger' | 'output';
    ready: boolean;
    reason?: string;
    requires?: string[];
  }

  let channels: ChannelHealth[] = [];
  let webhookChannels: string[] = [];
  let source = 'daemon';

  try {
    const res = await pdFetch('/fleet/sources');
    if (res.ok) {
      const body = await res.json();
      channels = (body.channels as ChannelHealth[]) ?? [];
      webhookChannels = (body.webhookChannels as string[]) ?? [];
    } else {
      throw new Error(`daemon responded ${res.status}`);
    }
  } catch {
    // Daemon down: probe the local registry directly. Honest difference:
    // no armed webhook channels can exist without the daemon receiver.
    const { IoDispatch } = await import('../../lib/fleet/io-dispatch.js');
    channels = await new IoDispatch().health();
    source = 'local probe (daemon not reachable — webhook receiver not armed)';
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ source, channels, webhookChannels }, null, 2));
    return;
  }

  console.log('');
  ui.info('Fleet I/O Sources — channel health board');
  console.log(`  (${source})`);
  console.log('');
  const pad = (s: string, n: number) => s.padEnd(n);
  console.log(`  ${pad('CHANNEL', 12)}${pad('DIRECTION', 11)}${pad('STATUS', 9)}DETAIL`);
  for (const ch of channels) {
    const status = ch.ready ? 'ready' : 'stub';
    const detail = ch.ready
      ? ''
      : [ch.reason, ch.requires?.length ? `requires: ${ch.requires.join(', ')}` : '']
          .filter(Boolean)
          .join(' — ');
    console.log(`  ${pad(ch.kind, 12)}${pad(ch.direction, 11)}${pad(status, 9)}${detail}`);
  }
  if (webhookChannels.length > 0) {
    console.log('');
    ui.info(`Armed webhook channels: ${webhookChannels.join(', ')}`);
    console.log('  POST /webhooks/fleet/<channel> to fire (trust-gated: ADR-0093)');
  }
  console.log('');
}

// ─── Calendar access (EventKit, io-wiring Phase 5) ──────────────────────────

/**
 * `pd fleet calendar grant|status` — compile the EventKit helper if needed
 * and run (or report) the one-time macOS calendar consent. The trigger and
 * sink refuse to arm until this grant exists (fail-closed).
 */
async function fleetCalendar(options: CLIOptions, action?: string): Promise<void> {
  const { getSharedEventKitClient } = await import('../../lib/fleet/calendar-eventkit.js');
  const client = getSharedEventKitClient();
  const verb = action ?? 'status';

  if (verb === 'grant') {
    ui.info('Requesting macOS calendar access (watch for the system prompt)…');
    const result = await client.requestAccess();
    if (isJson(options)) { console.log(JSON.stringify(result)); return; }
    if (result.authorized) {
      ui.success('Calendar access granted. calendar: triggers/outputs are now armable.');
    } else {
      ui.error(`Calendar access NOT granted: ${result.reason ?? 'unknown'}`);
      ui.info('System Settings → Privacy & Security → Calendars, or re-run: pd fleet calendar grant');
    }
    return;
  }

  const status = await client.status();
  if (isJson(options)) { console.log(JSON.stringify(status)); return; }
  if (!status.available) {
    ui.warn(`EventKit helper unavailable: ${status.reason ?? 'unknown'}`);
  } else if (!status.authorized) {
    ui.warn(`Helper ready, access not granted: ${status.reason ?? ''}`);
    ui.info('Run: pd fleet calendar grant');
  } else {
    ui.success('EventKit ready: helper compiled and calendar access granted.');
  }
}

// ─── Trust-gate approvals (ADR-0093 L2) ──────────────────────────────────────

/** `pd fleet approvals` — spawns the trust gate is holding for a decision. */
async function fleetApprovals(options: CLIOptions): Promise<void> {
  const res = await pdFetch('/fleet/approvals');
  if (!res.ok) {
    ui.error(`daemon responded ${res.status}`);
    process.exit(1);
  }
  const body = await res.json();
  const proposals = (body.proposals as Array<{
    id: string; project: string; agent: string; trigger: string; tier: string;
    safeTools: string[]; timestamp: number;
  }>) ?? [];
  if (isJson(options)) { console.log(JSON.stringify(proposals, null, 2)); return; }
  if (proposals.length === 0) { ui.info('No spawns waiting for approval.'); return; }
  console.log('');
  ui.info(`${proposals.length} spawn(s) held by the trust gate:`);
  for (const p of proposals) {
    const ageMin = Math.floor((Date.now() - p.timestamp) / 60_000);
    console.log(`  ${p.id}`);
    console.log(`    ${p.agent} ← ${p.trigger}  (${p.tier}, ${p.project}, ${ageMin}m ago)`);
    console.log(`    tools if approved: ${p.safeTools.join(', ') || 'none'}`);
  }
  console.log('');
  console.log('Decide with: pd fleet approve <id> | pd fleet reject <id> --feedback "<why>"');
}

/** `pd fleet approve|reject <id>` — resolve a held spawn. */
async function fleetApprovalDecision(options: CLIOptions, decision: string, id?: string): Promise<void> {
  if (!id) {
    ui.error(`Usage: pd fleet ${decision} <proposal-id>`);
    process.exit(1);
  }
  const feedback = typeof options.feedback === 'string' ? options.feedback : undefined;
  const res = await pdFetch(`/fleet/approvals/${encodeURIComponent(id)}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision, feedback }),
  });
  const body = await res.json().catch(() => ({}));
  if (isJson(options)) { console.log(JSON.stringify(body)); return; }
  if (!res.ok) {
    ui.error(`${decision} failed: ${(body as { error?: string }).error ?? `HTTP ${res.status}`}`);
    process.exit(1);
  }
  ui.success(decision === 'approve' ? `Approved ${id} — agent hailed with the stored context.` : `Rejected ${id}.`);
}

/** `pd fleet push <status|test>` — Web Push devices for approval alerts. */
async function fleetPush(options: CLIOptions, action?: string): Promise<void> {
  if (action === 'test') {
    const res = await pdFetch('/fleet/push/test', { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (isJson(options)) { console.log(JSON.stringify(body)); return; }
    if (!res.ok) { ui.error(`test push failed (HTTP ${res.status})`); process.exit(1); }
    const r = body as { sent?: number; pruned?: number; failed?: number };
    ui.success(`Test push: ${r.sent ?? 0} sent, ${r.pruned ?? 0} dead pruned, ${r.failed ?? 0} failed.`);
    return;
  }
  const res = await pdFetch('/fleet/push/subscriptions');
  const body = await res.json().catch(() => ({}));
  if (isJson(options)) { console.log(JSON.stringify(body)); return; }
  if (!res.ok) { ui.error(`daemon responded ${res.status}`); process.exit(1); }
  const r = body as { count?: number; subscriptions?: Array<{ endpoint: string; userAgent?: string }> };
  if (!r.count) {
    ui.info('No devices registered. Open fleet-ui → Operator → "Notify me on this device".');
    return;
  }
  ui.info(`${r.count} device(s) registered for approval pushes:`);
  for (const s of r.subscriptions ?? []) {
    console.log(`  ${s.endpoint}  ${s.userAgent ? `(${s.userAgent.slice(0, 60)})` : ''}`);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function handleFleet(positional: string[], _options: Record<string, unknown>): Promise<void> {
  const subcommand = positional[0] || 'help';

  // HITL contract §4.3 (docs/hitl-interruptions.md): the subcommands that
  // START new agent work must refuse while a critical operator ask is open.
  // Read-only subcommands (status, validate, inspect, …) stay ungated.
  const startsNewWork =
    subcommand === 'up' || subcommand === 'run' || subcommand === 'approve';
  if (startsNewWork && !(await preflightInterruptionsGate(`pd fleet ${subcommand}`))) {
    process.exit(1);
  }

  switch (subcommand) {
    case 'up':
      await fleetUp(positional.slice(1));
      break;

    case 'down':
      await fleetDown(_options as CLIOptions);
      break;

    case 'status':
      await fleetStatus();
      break;

    case 'validate':
      fleetValidate();
      break;

    case 'models':
      await fleetModels(_options as CLIOptions, positional[1]);
      break;

    case 'init':
      await fleetInit();
      break;

    case 'prompt':
      await fleetPrompt();
      break;

    case 'panic':
      await fleetPanic(_options as CLIOptions);
      break;

    case 'unpanic':
      await fleetUnpanic(_options as CLIOptions);
      break;

    case 'halt':
      await fleetHalt(_options as CLIOptions, positional[1]);
      break;

    case 'pause':
      await fleetPauseConductor(_options as CLIOptions, positional[1]);
      break;

    case 'resume':
      await fleetResume(_options as CLIOptions, positional[1]);
      break;

    case 'inspect':
    case 'tree':
      await fleetInspect(_options as CLIOptions, positional[1]);
      break;

    case 'sources':
      await fleetSources(_options as CLIOptions);
      break;

    case 'calendar':
      await fleetCalendar(_options as CLIOptions, positional[1]);
      break;

    case 'approvals':
      await fleetApprovals(_options as CLIOptions);
      break;

    case 'approve':
    case 'reject':
      await fleetApprovalDecision(_options as CLIOptions, subcommand, positional[1]);
      break;

    case 'push':
      await fleetPush(_options as CLIOptions, positional[1]);
      break;

    case 'help':
    case '--help':
    case '-h': {
      const config = loadFleetConfig(process.cwd());
      console.log('');
      ui.info('Port Daddy Fleet — Declarative Agent Management');
      console.log('');
      console.log('Usage: pd fleet <command>');
      console.log('');
      console.log('Lifecycle:');
      console.log('  init            Create pd-fleet.yml + git hook in current project');
      console.log('  up [ship...]    Start agents from pd-fleet.yml (name ships for a partial fleet)');
      console.log('  down            Stop all agents');
      console.log('  status          Show fleet health');
      console.log('  validate        Parse pd-fleet.yml, resolve templates, and check topology');
      console.log('  models          Show backend model ladders and readiness');
      console.log('  sources         I/O channel health board (triggers/outputs: ready vs stub)');
      console.log('  calendar grant  Run the one-time macOS calendar consent prompt (EventKit)');
      console.log('  approvals       List spawns held by the trust gate (ADR-0093)');
      console.log('  approve <id>    Release a held spawn (hails the agent with its context)');
      console.log('  reject <id>     Refuse a held spawn (--feedback "<why>")');
      console.log('  push <status|test>  Web Push devices for approval alerts');
      console.log('');
      console.log('Conductor control (ADR-0060 — operate the live fleet):');
      console.log('  halt [rootId]   Total stop: SIGKILL the scope, refund bonds (--root <id> or global)');
      console.log('  pause [rootId]  Soft stop: stop admitting; leave running agents alive');
      console.log('  resume [rootId] Reopen a halted/paused scope');
      console.log('  inspect <rootId> | tree <rootId>   Render a lineage tree');
      console.log('');
      if (config) {
        console.log(`Agents in pd-fleet.yml (${config.agents.length}):`);
        for (const a of config.agents) {
          const mode = a.schedule ? `schedule: ${a.schedule}` : `trigger: ${a.trigger}`;
          const runtime = resolveFleetAgentRuntime(a);
          const backend = runtime.backend || 'MISSING';
          const model = runtime.model || (backend === 'claude-cli' ? 'CLI default' : runtime.modelTier ? `${runtime.modelTier} tier` : 'backend default');
          console.log(`  ${a.name.padEnd(16)} ${backend.padEnd(12)} ${model.padEnd(16)} ${mode}`);
        }
        console.log('');
        console.log('Run an agent once:');
        console.log(`  pd fleet run <name>     Run a specific agent from pd-fleet.yml`);
      } else {
        console.log('No pd-fleet.yml found in current directory.');
        console.log('Create one to define your agent fleet.');
      }
      break;
    }

    case 'run': {
      const agentName = positional[1];
      const config = loadFleetConfig(process.cwd());
      if (!agentName) {
        ui.error('Usage: pd fleet run <agent-name>');
        if (config) {
          ui.info(`Available: ${config.agents.map(a => a.name).join(', ')}`);
        }
        process.exit(1);
      }
      await runAgentByName(agentName, config);
      break;
    }

    default: {
      // Try running it as an agent name
      const config = loadFleetConfig(process.cwd());
      if (config?.agents.find(a => a.name === subcommand)) {
        // Same §4.3 gate as `pd fleet run` — this path also starts new work.
        if (!(await preflightInterruptionsGate(`pd fleet ${subcommand}`))) {
          process.exit(1);
        }
        await runAgentByName(subcommand, config);
      } else {
        ui.error(`Unknown: pd fleet ${subcommand}`);
        ui.info('Run "pd fleet help" for usage');
        process.exit(1);
      }
    }
  }
}
