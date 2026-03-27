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

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_DIR = join(__dirname, '..', '..', 'fleet');
const DOCK_MASTER_PID_FILE = '/tmp/pd-dock-master.pid';
const FLEET_LOG = '/tmp/pd-fleet.log';
const PD_URL = process.env.PD_URL || process.env.PORT_DADDY_URL || 'http://localhost:9876';

function isDockMasterRunning(): { running: boolean; pid: number | null } {
  if (!existsSync(DOCK_MASTER_PID_FILE)) return { running: false, pid: null };
  try {
    const pid = parseInt(readFileSync(DOCK_MASTER_PID_FILE, 'utf-8').trim(), 10);
    process.kill(pid, 0); // throws if not running
    return { running: true, pid };
  } catch {
    // Stale PID file
    try { unlinkSync(DOCK_MASTER_PID_FILE); } catch {}
    return { running: false, pid: null };
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

async function fleetUp(): Promise<void> {
  if (!(await isDaemonUp())) {
    ui.error('Port Daddy daemon not running. Start it first: pd start');
    process.exit(1);
  }

  const { running, pid } = isDockMasterRunning();
  if (running) {
    ui.warn(`Fleet already running (Dock Master PID ${pid})`);
    ui.info('  Status: pd fleet status');
    ui.info('  Stop:   pd fleet down');
    return;
  }

  const dockMasterScript = join(FLEET_DIR, 'dock-master.sh');
  if (!existsSync(dockMasterScript)) {
    ui.error(`Dock Master script not found: ${dockMasterScript}`);
    process.exit(1);
  }

  ui.info('Starting Port Daddy Fleet...');

  const child = spawn('zsh', [dockMasterScript], {
    cwd: join(FLEET_DIR, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...process.env, PD_URL },
  });

  child.unref();

  // Pipe output to log file
  const { createWriteStream } = await import('node:fs');
  const logStream = createWriteStream(FLEET_LOG, { flags: 'a' });
  child.stdout?.pipe(logStream);
  child.stderr?.pipe(logStream);

  if (child.pid) {
    writeFileSync(DOCK_MASTER_PID_FILE, String(child.pid));
  }

  // Wait briefly to verify it started
  await new Promise(r => setTimeout(r, 2000));

  if (child.pid && isDockMasterRunning().running) {
    ui.success(`Fleet started (Dock Master PID ${child.pid})`);
    ui.info(`  Logs:   tail -f ${FLEET_LOG}`);
    ui.info('  Status: pd fleet status');
    ui.info('  Stop:   pd fleet down');
  } else {
    ui.error('Fleet failed to start. Check: tail -20 /tmp/pd-fleet.log');
    try { unlinkSync(DOCK_MASTER_PID_FILE); } catch {}
    process.exit(1);
  }
}

async function fleetDown(): Promise<void> {
  let stopped = false;
  const { running, pid } = isDockMasterRunning();

  if (running && pid) {
    try {
      // Kill process group
      process.kill(-pid, 'SIGTERM');
      stopped = true;
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
        stopped = true;
      } catch {}
    }
    try { unlinkSync(DOCK_MASTER_PID_FILE); } catch {}
  }

  // Also kill stray fleet processes
  try {
    const { execSync } = await import('node:child_process');
    execSync('pkill -f "fleet/spark.sh" 2>/dev/null; pkill -f "fleet/dock-master.sh" 2>/dev/null', { stdio: 'ignore' });
    stopped = true;
  } catch {}

  if (stopped) {
    ui.success('Fleet stopped');
  } else {
    ui.info('No fleet was running');
  }
}

async function fleetStatus(): Promise<void> {
  console.log('');
  ui.info('Port Daddy Fleet');
  console.log('');

  // Dock Master status
  const { running, pid } = isDockMasterRunning();
  if (running) {
    ui.success(`Dock Master: running (PID ${pid})`);
  } else {
    ui.warn('Dock Master: not running');
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

async function runFleetScript(scriptName: string, args: string[] = []): Promise<void> {
  const scriptPath = join(FLEET_DIR, scriptName);
  if (!existsSync(scriptPath)) {
    ui.error(`Fleet script not found: ${scriptPath}`);
    process.exit(1);
  }

  const child = spawn('zsh', [scriptPath, ...args], {
    cwd: join(FLEET_DIR, '..'),
    stdio: 'inherit',
    env: { ...process.env, PD_URL },
  });

  await new Promise<void>((resolve) => {
    child.on('close', (code) => {
      if (code !== 0) process.exitCode = code || 1;
      resolve();
    });
  });
}

async function fleetLog(): Promise<void> {
  if (!existsSync(FLEET_LOG)) {
    ui.info('No fleet log found. Start fleet first: pd fleet up');
    return;
  }
  const content = readFileSync(FLEET_LOG, 'utf-8');
  const lines = content.split('\n');
  const tail = lines.slice(-50).join('\n');
  console.log(tail);
}

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function handleFleet(positional: string[], options: Record<string, unknown>): Promise<void> {
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

    case 'gardener':
      await runFleetScript('git-gardener.sh');
      break;

    case 'qa':
      await runFleetScript('qa-adversary.sh');
      break;

    case 'hunt':
      await runFleetScript('test-gap-hunter.sh');
      break;

    case 'research':
      if (!positional[1]) {
        ui.error('Usage: pd fleet research "topic to research"');
        process.exit(1);
      }
      await runFleetScript('research-scout.sh', positional.slice(1));
      break;

    case 'docs':
      await runFleetScript('documentarian.sh');
      break;

    case 'simplify':
      await runFleetScript('simplifier.sh');
      break;

    case 'spark':
      await runFleetScript('spark.sh', positional.slice(1));
      break;

    case 'ideas':
      await runFleetScript('spark.sh', ['ideas']);
      break;

    case 'log':
      await fleetLog();
      break;

    case 'help':
    case '--help':
    case '-h':
      console.log('');
      ui.info('Port Daddy Fleet — Background Agent Management');
      console.log('');
      console.log('Usage: pd fleet <command>');
      console.log('');
      console.log('Fleet lifecycle:');
      console.log('  up              Start Dock Master + all watchers');
      console.log('  down            Stop everything');
      console.log('  status          Show fleet health and recent events');
      console.log('  log             Show fleet log');
      console.log('');
      console.log('Run agents individually:');
      console.log('  gardener        Auto-commit uncommitted changes');
      console.log('  qa              Adversarial review of latest commit');
      console.log('  hunt            Find and fill test coverage gaps');
      console.log('  docs            Sync documentation to match code');
      console.log('  simplify        Propose simplifications for latest commit');
      console.log('  research "topic"  Deep research on a topic');
      console.log('');
      console.log('The idea engine:');
      console.log('  spark           Run one ideation cycle');
      console.log('  spark --loop    Run Spark continuously');
      console.log('  spark ideas     List all ideas');
      console.log('  ideas           Shortcut for spark ideas');
      break;

    default:
      ui.error(`Unknown fleet command: ${subcommand}`);
      ui.info('Run "pd fleet help" for usage');
      process.exit(1);
  }
}
