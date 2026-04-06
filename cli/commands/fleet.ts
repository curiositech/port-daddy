/**
 * Fleet CLI — TypeScript port of fleet/pd-fleet.sh
 *
 * Manages background agent fleet: up/down/status + individual agent runs.
 * Uses pd spawn for all agent execution — dogfoods our own primitives.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import * as ui from '../utils/ui.js';
import { pdFetch, isDaemonRunning } from '../utils/fetch.js';
import {
  loadFleetConfig,
  createFleetRunner,
  getFleetRuntimeDefaults,
  resolveFleetAgentRuntime,
} from '../../lib/fleet-engine.js';
import { assessBackendReadiness } from '../../lib/backend-readiness.js';

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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PD_URL = process.env.PD_URL || process.env.PORT_DADDY_URL || 'http://localhost:9876';
const LOCAL_EXECUTION_BACKENDS = new Set(['claude-cli', 'ollama', 'aider', 'custom']);

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

async function getFleetAgents(): Promise<Array<{ id: string; purpose: string; status: string }>> {
  try {
    const res = await pdFetch('/agents');
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.agents || []).filter((a: any) => a.id?.startsWith('fleet-'));
  } catch {
    return [];
  }
}

// ─── Template paths ─────────────────────────────────────────────────────────

function getTemplatePath(name: string): string {
  // Templates are at <project-root>/templates/ relative to this file (cli/commands/)
  return join(__dirname, '..', '..', 'templates', name);
}

// ─── fleet init ─────────────────────────────────────────────────────────────

async function fleetInit(): Promise<void> {
  const cwd = process.cwd();
  const fleetPath = join(cwd, 'pd-fleet.yml');
  const hookDir = join(cwd, '.git', 'hooks');
  const hookPath = join(hookDir, 'post-commit');

  // Check if already initialized
  if (existsSync(fleetPath)) {
    ui.warn('pd-fleet.yml already exists in this directory');
    ui.info('Edit it to customize your fleet, then run: pd fleet up');
    return;
  }

  // Copy fleet template
  const templateSrc = getTemplatePath('pd-fleet-starter.yml');
  if (!existsSync(templateSrc)) {
    ui.error('Fleet template not found. Is Port Daddy installed correctly?');
    process.exit(1);
  }

  writeFileSync(fleetPath, readFileSync(templateSrc, 'utf-8'));
  ui.success('Created pd-fleet.yml with 5 agents: QA, documentarian, cartographer, spark, spider');

  // Install git hook if .git exists
  if (existsSync(join(cwd, '.git'))) {
    const hookSrc = getTemplatePath('post-commit-hook');
    if (existsSync(hookSrc)) {
      if (existsSync(hookPath)) {
        // Append to existing hook instead of overwriting
        const existing = readFileSync(hookPath, 'utf-8');
        if (existing.includes('git:committed')) {
          ui.info('Git post-commit hook already publishes to git:committed');
        } else {
          const hookContent = readFileSync(hookSrc, 'utf-8');
          // Strip the shebang from the appended content
          const withoutShebang = hookContent.replace(/^#!.*\n/, '');
          writeFileSync(hookPath, existing.trimEnd() + '\n\n# --- Port Daddy fleet trigger ---\n' + withoutShebang);
          const { chmodSync } = await import('node:fs');
          chmodSync(hookPath, 0o755);
          ui.success('Added fleet trigger to existing .git/hooks/post-commit');
        }
      } else {
        mkdirSync(hookDir, { recursive: true });
        writeFileSync(hookPath, readFileSync(hookSrc, 'utf-8'));
        const { chmodSync } = await import('node:fs');
        chmodSync(hookPath, 0o755);
        ui.success('Installed .git/hooks/post-commit (publishes to git:committed)');
      }
    }
  } else {
    ui.warn('No .git directory found — skipping post-commit hook');
    ui.info('Run this inside a git repo to get automatic fleet triggers on commit');
  }

  // Create output directories
  mkdirSync(join(cwd, '.spark', 'ideas'), { recursive: true });
  mkdirSync(join(cwd, '.spider', 'connections'), { recursive: true });
  mkdirSync(join(cwd, '.cartographer'), { recursive: true });

  // Add to .gitignore if it exists
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    const additions: string[] = [];
    if (!gitignore.includes('.spark/')) additions.push('.spark/');
    if (!gitignore.includes('.spider/')) additions.push('.spider/');
    if (!gitignore.includes('.cartographer/')) additions.push('.cartographer/');
    if (additions.length > 0) {
      writeFileSync(gitignorePath, gitignore.trimEnd() + '\n\n# Port Daddy fleet output\n' + additions.join('\n') + '\n');
      ui.info(`Added ${additions.join(', ')} to .gitignore`);
    }
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

async function fleetUp(): Promise<void> {
  if (!(await isDaemonRunning())) {
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

function fleetDown(): void {
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
  const defaults = getFleetRuntimeDefaults();

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

  const channelResults = await Promise.all(
    channels.map(async (ch) => {
      try {
        const res = await pdFetch(`/msg/${ch}?limit=1`);
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
        return `  ${ch}: ${time} — ${payload}`;
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
        task: agent.prompt,
        identity: agent.identity,
        purpose: `Fleet agent: ${agent.name}`,
        backend: runtime.backend,
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

// ─── Entry Point ────────────────────────────────────────────────────────────

export async function handleFleet(positional: string[], _options: Record<string, unknown>): Promise<void> {
  const subcommand = positional[0] || 'help';

  switch (subcommand) {
    case 'up':
      await fleetUp();
      break;

    case 'down':
      fleetDown();
      break;

    case 'status':
      await fleetStatus();
      break;

    case 'init':
      await fleetInit();
      break;

    case 'prompt':
      await fleetPrompt();
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
      console.log('  up              Start all agents from pd-fleet.yml');
      console.log('  down            Stop all agents');
      console.log('  status          Show fleet health');
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
        await runAgentByName(subcommand, config);
      } else {
        ui.error(`Unknown: pd fleet ${subcommand}`);
        ui.info('Run "pd fleet help" for usage');
        process.exit(1);
      }
    }
  }
}
