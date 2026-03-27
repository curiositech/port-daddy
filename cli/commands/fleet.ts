/**
 * Fleet CLI — TypeScript port of fleet/pd-fleet.sh
 *
 * Manages background agent fleet: up/down/status + individual agent runs.
 * Uses pd spawn for all agent execution — dogfoods our own primitives.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as ui from '../utils/ui.js';
import { loadFleetConfig, createFleetRunner, type FleetConfig } from '../../lib/fleet-engine.js';

// ─── Load .env.local / .env for API keys ────────────────────────────────────
// Searches: cwd, project root, home directory. All found vars are merged.
// Existing env vars take precedence (don't overwrite what's already set).
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
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
  }
}

// Load env on module init — before any agent runs
loadEnvFiles();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = join(__dirname, '..', '..', 'fleet');
const PD_URL = process.env.PD_URL || process.env.PORT_DADDY_URL || 'http://localhost:9876';

function isFleetRunning(): { running: boolean; pid: number | null; name: string | null } {
  const stateFile = join(process.cwd(), '.portdaddy', 'fleet-state.json');
  if (!existsSync(stateFile)) return { running: false, pid: null, name: null };
  try {
    const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
    process.kill(state.pid, 0); // throws if not running
    return { running: true, pid: state.pid, name: state.name };
  } catch {
    try { unlinkSync(stateFile); } catch {}
    return { running: false, pid: null, name: null };
  }
}

async function isDaemonUp(): Promise<boolean> {
  try {
    const res = await fetch(`${PD_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function getFleetAgents(): Promise<Array<{ id: string; purpose: string; status: string }>> {
  try {
    const res = await fetch(`${PD_URL}/agents`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.agents || []).filter((a: any) => a.id?.startsWith('fleet-'));
  } catch {
    return [];
  }
}

// ─── Subcommands ────────────────────────────────────────────────────────────

// Module-level fleet runner (persists for the lifetime of the CLI process)
let activeRunner: ReturnType<typeof createFleetRunner> | null = null;

async function fleetUp(): Promise<void> {
  if (!(await isDaemonUp())) {
    ui.error('Port Daddy daemon not running. Start it first: pd start');
    process.exit(1);
  }

  const { running, pid } = isFleetRunning();
  if (running) {
    ui.warn(`Fleet already running (Dock Master PID ${pid})`);
    ui.info('  Status: pd fleet status');
    ui.info('  Stop:   pd fleet down');
    return;
  }

  const projectDir = process.cwd();
  const config = loadFleetConfig(projectDir);

  if (config) {
    // ─── Declarative mode: pd-fleet.yml found ───────────────────────
    ui.info(`Starting fleet "${config.name}" from pd-fleet.yml`);
    ui.info(`  Agents: ${config.agents.length}`);
    ui.info(`  Watchers: ${config.watchers.length}`);
    ui.info(`  Channels: ${Object.keys(config.channels).length}`);
    console.log('');

    activeRunner = createFleetRunner(config, projectDir);
    activeRunner.startAll();

    // Save state so pd fleet status/stop can find it
    const stateFile = join(projectDir, '.portdaddy', 'fleet-state.json');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(projectDir, '.portdaddy'), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({
      pid: process.pid,
      name: config.name,
      agents: config.agents.map(a => a.name),
      watchers: config.watchers.map(w => w.name),
      startedAt: new Date().toISOString(),
    }));

    for (const agent of config.agents) {
      const mode = agent.schedule ? `schedule: ${agent.schedule}` : `trigger: ${agent.trigger}`;
      ui.success(`  ${agent.name} (${agent.backend}) — ${mode}`);
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

async function fleetDown(): Promise<void> {
  const { running, pid } = isFleetRunning();
  const stateFile = join(process.cwd(), '.portdaddy', 'fleet-state.json');

  if (running && pid) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
    try { unlinkSync(stateFile); } catch {}
    ui.success('Fleet stopped');
  } else {
    ui.info('No fleet running');
  }
}

async function fleetStatus(): Promise<void> {
  console.log('');
  ui.info('Port Daddy Fleet');
  console.log('');

  const { running, pid, name } = isFleetRunning();
  if (running) {
    ui.success(`Fleet "${name || 'unnamed'}": running (PID ${pid})`);
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

  // Fleet agents from PD registry
  console.log('');
  ui.info('Registered fleet agents:');
  const agents = await getFleetAgents();
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
  const channels = [
    'fleet:status', 'fleet:alert', 'git:committed',
    'qa:findings', 'docs:updated', 'tests:gap-filled',
    'spark:idea', 'spark:prototype',
  ];

  let anyEvents = false;
  for (const ch of channels) {
    try {
      const res = await fetch(`${PD_URL}/msg/${ch}?limit=1`);
      if (!res.ok) continue;
      const data = await res.json() as any;
      const msgs = data.messages || [];
      if (msgs.length > 0) {
        const ts = msgs[0].timestamp;
        const time = ts > 1000000000
          ? new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '?';
        const payload = typeof msgs[0].payload === 'string'
          ? msgs[0].payload.slice(0, 80)
          : JSON.stringify(msgs[0].payload).slice(0, 80);
        console.log(`  ${ch}: ${time} — ${payload}`);
        anyEvents = true;
      }
    } catch {}
  }

  if (!anyEvents) {
    console.log('  (no recent events)');
  }
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
async function runAgentByName(agentName: string): Promise<void> {
  const config = loadFleetConfig(process.cwd());
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

  ui.info(`Running ${agent.name} (${agent.backend})...`);

  if (agent.backend === 'claude-cli') {
    // Run locally — claude CLI needs user's auth context
    const args = ['-p', agent.prompt];
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
    const res = await fetch(`${PD_URL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        backend: agent.backend,
        task: agent.prompt,
        identity: agent.identity,
        purpose: `Fleet agent: ${agent.name}`,
        model: agent.model,
        timeout: agent.timeout,
        allowedTools: agent.allowedTools,
      }),
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

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function handleFleet(positional: string[], _options: Record<string, unknown>): Promise<void> {
  const subcommand = positional[0] || 'help';

  switch (subcommand) {
    case 'up':
      await fleetUp();
      break;

    case 'down':
      await fleetDown();
      break;

    case 'status':
      await fleetStatus();
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
      console.log('  up              Start all agents from pd-fleet.yml');
      console.log('  down            Stop all agents');
      console.log('  status          Show fleet health');
      console.log('');
      if (config) {
        console.log(`Agents in pd-fleet.yml (${config.agents.length}):`);
        for (const a of config.agents) {
          const mode = a.schedule ? `schedule: ${a.schedule}` : `trigger: ${a.trigger}`;
          console.log(`  ${a.name.padEnd(16)} ${a.backend.padEnd(12)} ${mode}`);
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
      if (!agentName) {
        const config = loadFleetConfig(process.cwd());
        ui.error('Usage: pd fleet run <agent-name>');
        if (config) {
          ui.info(`Available: ${config.agents.map(a => a.name).join(', ')}`);
        }
        process.exit(1);
      }
      await runAgentByName(agentName);
      break;
    }

    default: {
      // Try running it as an agent name
      const config = loadFleetConfig(process.cwd());
      if (config?.agents.find(a => a.name === subcommand)) {
        await runAgentByName(subcommand);
      } else {
        ui.error(`Unknown: pd fleet ${subcommand}`);
        ui.info('Run "pd fleet help" for usage');
        process.exit(1);
      }
    }
  }
}
