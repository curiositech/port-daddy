/**
 * `pd squid` - local Giant Squid compatibility surfaces.
 */

import { spawn as spawnChild, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SQUID_MAX_REQUEST_BYTES,
  listenClaudeCodexBridge,
} from '../../lib/squid/claude-codex-bridge.js';
import {
  SQUID_HOOK_METADATA,
  SQUID_HOOK_PRIVACY_NOTICE,
  squidAdapters,
} from '../../lib/squid/adapter.js';
import { normalizeCodexConfigOverrides } from '../../lib/spawner/backends/cli-tube.js';
import {
  installSlashCommand,
  installStatusline,
  readIdentityStatus,
  readMatrixSnapshot,
  stageStatusline,
  uninstallSlashCommand,
  uninstallStatusline,
} from '../../lib/squid/identity.js';
import {
  installPilotSessionStartHook,
  uninstallPilotSessionStartHook,
} from '../../lib/pilot-sessionstart-hook.js';
import { PD_HOOK_MARKER } from '../../lib/squid/hook-shape.js';
import { ensureSquidClaudeHome } from '../../lib/squid/bridge-client-home.js';
import { squidTokens } from '../../lib/squid/terminal.js';
import type { CLIOptions } from '../types.js';
import * as ui from '../utils/ui.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQUID_PROJECT_ROOT = join(__dirname, '..', '..');

const LEGACY_SQUID_TOKEN = 'squid-local';
const GENERATED_TOKEN_BYTES = 24;
const MAX_MODEL_ALIASES = 64;
const MAX_MODEL_ALIAS_LENGTH = 160;
const MODEL_ALIAS_ID = /^[A-Za-z0-9_:@./+-][A-Za-z0-9_:@./+-]*$/;
const DEFAULT_HOOK_PROVIDERS = ['claude-code', 'codex', 'gemini', 'antigravity'] as const;
const SQUID_TIER_PRESETS = {
  fast: { effort: 'low', label: 'fast' },
  mid: { effort: 'medium', label: 'mid' },
  strong: { effort: 'high', label: 'strong' },
} as const;
type SquidTier = keyof typeof SQUID_TIER_PRESETS;

export interface SquidHookInstallResult {
  providerName: string;
  binaryName: string;
  verified: boolean;
}

export interface SquidBridgeConfig {
  host: string;
  port: number;
  cwd: string;
  timeoutMs: number;
  maxRequestBytes: number;
  authToken: string | null;
  authTokenSource: 'generated' | 'explicit' | 'disabled';
  codexModel?: string;
  capabilityTier?: SquidTier;
  modelAliases: Record<string, string>;
  codexConfig: string[];
}

export interface ClientLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export async function handleSquid(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0] || 'help';
  const rest = args.slice(1);
  switch (sub) {
    case 'codex':
    case 'claude':
    case 'pro':
    case 'bridge':
    case 'codex-bridge':
      await handleCodexBridge(rest, options, { serveOnly: Boolean(options['serve-only']) });
      return;
    case 'serve':
      await handleCodexBridge(rest, options, { serveOnly: true });
      return;
    case 'hooks':
    case 'install-hooks':
      await handleInstallHooks(rest, options);
      return;
    case 'on':
    case 'arm':
      await handleSquidOn(options);
      return;
    case 'off':
    case 'disarm':
      await handleSquidOff(options);
      return;
    case 'status':
      await handleSquidStatus(options);
      return;
    case 'tap':
      handleSquidTap(options);
      return;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      return;
  }
}

/**
 * Normalize CLI options into the bridge server's runtime config. There are two
 * model layers: `--codex-model` controls the actual Codex CLI backend; a model
 * passed to Claude Code stays client-facing and arrives inside the request body.
 */
export function resolveSquidBridgeConfig(options: CLIOptions, cwdDefault = process.cwd()): SquidBridgeConfig {
  const codexConfig = normalizeStringArray(options['codex-config']);
  const capabilityTier = resolveSquidTier(options);
  const codexEffort = typeof options['codex-effort'] === 'string'
    ? options['codex-effort']
    : capabilityTier
      ? SQUID_TIER_PRESETS[capabilityTier].effort
      : undefined;
  if (codexEffort) {
    codexConfig.push(`model_reasoning_effort="${codexEffort}"`);
  }
  const modelAliases = parseModelAliases([
    ...normalizeStringArray(process.env.PD_SQUID_MODEL_ALIASES),
    ...normalizeStringArray(options['codex-model-alias']),
  ]);
  const uniqueCodexConfig = [...new Set(codexConfig)];
  const auth = resolveSquidAuthToken(options);
  return {
    port: parseInt(String(options.port ?? process.env.PD_SQUID_BRIDGE_PORT ?? '8765'), 10),
    host: String(options.host ?? process.env.PD_SQUID_BRIDGE_HOST ?? '127.0.0.1'),
    cwd: String(options.cwd ?? options.workdir ?? cwdDefault),
    timeoutMs: parseInt(String(options.timeout ?? options['timeout-ms'] ?? 10 * 60 * 1000), 10),
    maxRequestBytes: parseInt(String(
      options['max-request-bytes']
        ?? process.env.PD_SQUID_MAX_REQUEST_BYTES
        ?? DEFAULT_SQUID_MAX_REQUEST_BYTES,
    ), 10),
    authToken: auth.token,
    authTokenSource: auth.source,
    codexModel: typeof options['codex-model'] === 'string'
      ? options['codex-model']
      : typeof options.model === 'string'
        ? options.model
        : undefined,
    capabilityTier,
    modelAliases,
    codexConfig: uniqueCodexConfig,
  };
}

/** Fail closed when the bridge is exposed beyond loopback with weak local auth. */
export function validateSquidBridgeConfig(config: SquidBridgeConfig): string | null {
  if (!Number.isFinite(config.maxRequestBytes) || config.maxRequestBytes <= 0) {
    return 'Refusing to start the Squid bridge with an invalid --max-request-bytes value.';
  }
  try {
    normalizeCodexConfigOverrides(config.codexConfig);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  if (config.authToken && !isUsableLocalToken(config.authToken)) {
    return 'Refusing to start the Squid bridge with a blank or control-character auth token.';
  }
  if (isLoopbackHost(config.host)) return null;
  if (!config.authToken || config.authTokenSource === 'disabled') {
    return 'Refusing to bind the Squid bridge off loopback with auth disabled; pass --host 127.0.0.1 or set a strong --token.';
  }
  if (config.authTokenSource !== 'explicit') {
    return 'Refusing to bind the Squid bridge off loopback with generated local auth; set a strong --token or PD_SQUID_BRIDGE_TOKEN.';
  }
  if (config.authToken.trim() === LEGACY_SQUID_TOKEN || config.authToken.trim().length < 16) {
    return 'Refusing to bind the Squid bridge off loopback with a weak token; set a random token with at least 16 characters.';
  }
  return null;
}

/** Human-readable label for the model REALLY answering behind the bridge. */
export function squidBackendLabel(config: Pick<SquidBridgeConfig, 'codexModel' | 'capabilityTier'>): string {
  if (config.codexModel) return `codex ${config.codexModel}`;
  if (config.capabilityTier) return `codex (${SQUID_TIER_PRESETS[config.capabilityTier].label})`;
  return 'codex';
}

export interface BridgeClientEnvOptions {
  backendLabel?: string;
  /**
   * Isolated CLAUDE_CONFIG_DIR for a bridged Claude Code session. When set, the
   * client authenticates with the bridge bearer token ONLY (no ANTHROPIC_API_KEY,
   * and any inherited one is stripped), so Claude Code does not see both the
   * token and the operator's stored claude.ai login — no "Auth conflict" warning.
   */
  claudeConfigDir?: string;
}

/** Build the child-process environment for a Claude-compatible client. */
export function bridgeClientEnv(
  baseUrl: string,
  authToken: string | null,
  baseEnv: NodeJS.ProcessEnv = process.env,
  options: BridgeClientEnvOptions = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ANTHROPIC_BASE_URL: baseUrl,
    // Visual identity: pd-statusline renders the magenta ◆ PD⇄CODEX badge when
    // it sees this, so a bridged session can never be mistaken for a direct seat.
    PD_SQUID_PILOT: 'codex',
    // Honest model provenance: the statusline shows the model actually
    // answering (the Codex backend), not the client-facing Anthropic model id.
    PD_SQUID_BACKEND: options.backendLabel || 'codex',
  };
  const cleanClaude = Boolean(options.claudeConfigDir);
  if (cleanClaude) {
    // Isolated config home → no stored login → the bearer token is the sole
    // credential. Bearer only: setting ANTHROPIC_API_KEY here (or inheriting one)
    // is what triggers Claude Code's auth-conflict warning, so strip it.
    env.CLAUDE_CONFIG_DIR = options.claudeConfigDir!;
    delete env.ANTHROPIC_API_KEY;
    if (authToken) env.ANTHROPIC_AUTH_TOKEN = authToken;
    else delete env.ANTHROPIC_AUTH_TOKEN;
  } else if (authToken) {
    env.ANTHROPIC_AUTH_TOKEN = authToken;
    env.ANTHROPIC_API_KEY = authToken;
  } else {
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
}

/** Basename of the client command, for deciding whether to apply clean-Claude launch. */
function isClaudeClient(command: string): boolean {
  const base = command.split('/').pop() || command;
  return base === 'claude';
}

/**
 * Resolve the launched client. Positional args after `--` win:
 * `pd squid bridge -- claude -p hi`. Without them, default to `claude` plus any
 * repeatable `--client-arg` values.
 */
export function resolveClientLaunch(
  baseUrl: string,
  authToken: string | null,
  passthrough: string[],
  options: CLIOptions,
  baseEnv: NodeJS.ProcessEnv = process.env,
  extra: { backendLabel?: string; cwd?: string } = {},
): ClientLaunch {
  const command = passthrough[0] || String(options.client ?? 'claude');
  const args = passthrough.length > 0 ? passthrough.slice(1) : normalizeStringArray(options['client-arg']);
  // Sugar: when the client is Claude Code, seed an isolated, pre-trusted config
  // home so the one command boots clean — no auth-conflict warning, no folder
  // trust prompt, no onboarding. --no-isolate opts out (shares the operator's
  // config, at the cost of the login/token conflict warning).
  let claudeConfigDir: string | undefined;
  if (isClaudeClient(command) && !options['no-isolate']) {
    claudeConfigDir = ensureSquidClaudeHome(extra.cwd ?? process.cwd()) ?? undefined;
  }
  return {
    command,
    args,
    env: bridgeClientEnv(baseUrl, authToken, baseEnv, { backendLabel: extra.backendLabel, claudeConfigDir }),
  };
}

/**
 * Install the existing Giant Squid hook tentacles into each supported agent's
 * native hook config. This is the project-level harness arm switch: Claude Code
 * gets .claude/settings.json, Codex gets .codex/config.toml, Gemini gets
 * .gemini/settings.json, and Antigravity gets GeminiDir/hooks.json.
 */
export async function installSquidHooks(
  workspaceRoot: string,
  providerNames: string[] = [...DEFAULT_HOOK_PROVIDERS],
): Promise<SquidHookInstallResult[]> {
  const adapters = squidAdapters();
  const wanted = resolveHookProviders(providerNames);
  const selected = adapters.filter((adapter) => wanted.has(adapter.providerName));
  const missing = [...wanted].filter((name) => !adapters.some((adapter) => adapter.providerName === name));
  if (missing.length > 0) {
    throw new Error(`Unsupported Squid hook provider(s): ${missing.join(', ')}`);
  }

  const results: SquidHookInstallResult[] = [];
  for (const adapter of selected) {
    await adapter.injectHooks(workspaceRoot);
    results.push({
      providerName: adapter.providerName,
      binaryName: adapter.binaryName,
      verified: adapter.verified,
    });
  }
  return results;
}

function resolveHookProviders(values: string[]): Set<string> {
  const names = values.length > 0 ? values : [...DEFAULT_HOOK_PROVIDERS];
  const resolved = new Set<string>();
  for (const raw of names.flatMap((value) => value.split(','))) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    if (name === 'all') {
      for (const provider of DEFAULT_HOOK_PROVIDERS) resolved.add(provider);
      continue;
    }
    if (name === 'claude') resolved.add('claude-code');
    else if (name === 'claude-code') resolved.add('claude-code');
    else if (name === 'codex') resolved.add('codex');
    else if (name === 'gemini') resolved.add('gemini');
    else if (name === 'agy' || name === 'antigravity') resolved.add('antigravity');
    else resolved.add(name);
  }
  return resolved;
}

async function handleInstallHooks(args: string[], options: CLIOptions): Promise<void> {
  const workspaceRoot = String(options.cwd ?? options.workdir ?? process.cwd());
  const providers = [
    ...normalizeStringArray(options.provider),
    ...normalizeStringArray(options.providers),
    ...args.filter((arg) => !arg.startsWith('-')),
  ];
  const results = await installSquidHooks(workspaceRoot, providers);

  ui.success('Giant Squid hooks installed');
  console.log(`  workspace: ${workspaceRoot}`);
  for (const result of results) {
    const proof = result.verified ? 'verified live' : 'contract installed';
    console.log(`  ${result.providerName.padEnd(13)} ${result.binaryName.padEnd(8)} ${proof}`);
  }
  console.log('');
  console.log('Installed local tentacles:');
  for (const meta of Object.values(SQUID_HOOK_METADATA)) {
    console.log(`  - ${meta.displayName}: ${meta.description} ${meta.privacy}`);
  }
  console.log(`Privacy: ${SQUID_HOOK_PRIVACY_NOTICE}`);
  console.log('Repair check: pd doctor');
  console.log('Use pd squid codex --tier strong when you also want Anthropic-compatible traffic bridged to Codex CLI.');
}

async function handleCodexBridge(clientPassthrough: string[], options: CLIOptions, mode: { serveOnly: boolean }): Promise<void> {
  const config = resolveSquidBridgeConfig(options);
  const securityIssue = validateSquidBridgeConfig(config);
  if (securityIssue) {
    throw new Error(securityIssue);
  }

  const server = await listenClaudeCodexBridge({
    port: config.port,
    host: config.host,
    cwd: config.cwd,
    timeoutMs: config.timeoutMs,
    maxRequestBytes: config.maxRequestBytes,
    authToken: config.authToken,
    codexModel: config.codexModel,
    modelAliases: config.modelAliases,
    codexConfig: config.codexConfig,
  });
  const info = server.address() as AddressInfo;
  const displayHost = info.address === '::' ? '127.0.0.1' : info.address;
  const baseUrl = `http://${displayHost}:${info.port}`;

  ui.success('Giant Squid Claude-to-Codex bridge is listening');
  console.log(`  base URL:  ${baseUrl}`);
  console.log(`  backend:   codex exec`);
  if (config.codexModel) console.log(`  codex:    --model ${config.codexModel}`);
  if (config.capabilityTier) console.log(`  tier:     ${config.capabilityTier}`);
  if (Object.keys(config.modelAliases).length > 0) console.log(`  aliases:  ${formatModelAliases(config.modelAliases)}`);
  if (config.codexConfig.length > 0) console.log(`  config:   ${config.codexConfig.join(', ')}`);
  console.log(`  official:  no - compatibility bridge only`);
  console.log('');
  printBridgeCard({
    baseUrl,
    token: config.authToken,
    tokenSource: config.authTokenSource,
    serveOnly: mode.serveOnly,
    codexModel: config.codexModel,
    capabilityTier: config.capabilityTier,
    aliases: config.modelAliases,
  });

  if (!mode.serveOnly) {
    const launch = resolveClientLaunch(baseUrl, config.authToken, clientPassthrough, options, process.env, {
      backendLabel: squidBackendLabel(config),
      cwd: config.cwd,
    });
    console.log('');
    console.log(`Launching: ${[launch.command, ...launch.args].join(' ') || launch.command}`);
    const child = spawnChild(launch.command, launch.args, {
      cwd: config.cwd,
      env: launch.env,
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      ui.error(`Failed to launch ${launch.command}: ${err.message}`);
      server.close(() => process.exit(127));
    });
    child.on('exit', (code, signal) => {
      server.close(() => {
        if (signal) process.kill(process.pid, signal);
        process.exit(code ?? 0);
      });
    });
    return;
  }

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

// ─── Toggle + status (the harness arm switch) ────────────────────────────────

/**
 * `pd squid on` — arm the FULL harness for this project in one shot:
 * tentacle hooks (all detected CLIs), the pd-statusline identity, the Pilot
 * SessionStart steering hook, and the /squid slash command.
 */
async function handleSquidOn(options: CLIOptions): Promise<void> {
  const cwd = String(options.cwd ?? options.workdir ?? process.cwd());
  const t = squidTokens('stdout');

  const { stageTentacles, silentHooksInstall } = await import('./hooks-install.js');
  const stage = stageTentacles();
  const problems: string[] = [];
  if (stage.missing.length > 0) {
    problems.push(`tentacles missing on this build (${stage.missing.join(', ')}) — hooks skipped`);
  }
  const hooks = stage.missing.length === 0 ? silentHooksInstall(undefined, { cwd }) : null;

  const stagedStatusline = stageStatusline();
  const statusline = stagedStatusline ? installStatusline(cwd) : null;
  if (!stagedStatusline) {
    problems.push('statusline script missing on this build — no ◆ PD badge will render');
  } else if (statusline && !statusline.ok) {
    problems.push(`statusline: ${statusline.reason}`);
  }

  const sessionStart = installPilotSessionStartHook({ projectDir: cwd, projectRoot: SQUID_PROJECT_ROOT });
  if (!sessionStart.ok) problems.push(`steering hook: ${sessionStart.reason}`);

  const slash = installSlashCommand(cwd);
  if (!slash.ok) problems.push(`/squid command: ${slash.reason}`);

  // This is the honest-reporting contract for `pd squid on`: a packaged build
  // missing tentacle/statusline/hook assets must NEVER print the same success
  // banner as a fully wired one (the pd-adr-0091 dogfood defect — 3.25.2
  // reported ARMED while Claude/Gemini stayed unwired). A real problem here
  // always downgrades the banner and the exit code, never just a log line.
  const armed = problems.length === 0;
  if (armed) {
    ui.success('Giant Squid harness ARMED for this project');
  } else {
    ui.warn(`Giant Squid harness PARTIALLY ARMED for this project — ${problems.length} asset(s) missing`);
    process.exitCode = 1;
  }
  console.log(`  workspace:   ${cwd}`);
  if (hooks) {
    console.log(`  hooks:       ${hooks.detected.length > 0 ? hooks.detected.join(', ') : 'no agent CLIs detected'} (daemon-gated)`);
  } else {
    console.log(`  hooks:       ${t.bad('skipped — tentacles missing on this build')}`);
  }
  const statuslineLabel = !stagedStatusline
    ? t.bad('script missing on this build')
    : statusline
      ? `${statusline.ok ? t.ok(statusline.reason) : t.bad(statusline.reason)} — ◆ PD badge in Claude Code`
      : t.bad('not wired');
  console.log(`  statusline:  ${statuslineLabel}`);
  console.log(`  steering:    SessionStart pilot hook ${sessionStart.ok ? t.ok(sessionStart.reason) : t.bad(sessionStart.reason)}`);
  console.log(`  /squid:      slash command ${slash.ok ? t.ok(slash.reason) : t.bad(slash.reason)}`);
  console.log('');
  if (armed) {
    console.log('  New Claude Code sessions in this project are visibly Port-Daddy-harnessed.');
    console.log('  Inspect the background machinery any time: pd squid status · pd squid tap');
    console.log('  Disarm: pd squid off');
  } else {
    console.log(`  ${t.warn('This build is missing packaged assets — the harness is NOT fully wired:')}`);
    for (const problem of problems) console.log(`    ${t.bad('✗')} ${problem}`);
    console.log('  Repair: pd doctor, or reinstall/rebuild the pd binary — see pd squid status for live detail.');
  }
}

/**
 * `pd squid off` — disarm this project: remove pd hooks, statusline, steering
 * hook, and slash command. `--all` also clears user-level configs (codex/agy
 * live there; without --all they stay wired but runtime-gated inert).
 */
async function handleSquidOff(options: CLIOptions): Promise<void> {
  const cwd = String(options.cwd ?? options.workdir ?? process.cwd());
  const { buildTargets, uninstallTarget } = await import('./hooks-install.js');
  const home = process.env.HOME || process.env.USERPROFILE || '';

  const cleared: string[] = [];
  for (const target of buildTargets(home)) {
    const scopes: Array<'project' | 'user'> = options.all || options.user ? ['project', 'user'] : ['project'];
    for (const scope of scopes) {
      const r = uninstallTarget(target, { scope, cwd });
      if (r.success && !r.skipped) cleared.push(`${target.slug} (${scope})`);
    }
  }
  const statusline = uninstallStatusline(cwd);
  const sessionStart = uninstallPilotSessionStartHook(cwd);
  const slash = uninstallSlashCommand(cwd);

  ui.success('Giant Squid harness DISARMED for this project');
  console.log(`  hooks:       ${cleared.length > 0 ? `cleared ${cleared.join(', ')}` : 'none found'}`);
  console.log(`  statusline:  ${statusline.reason}`);
  console.log(`  steering:    ${sessionStart.reason}`);
  console.log(`  /squid:      ${slash.reason}`);
  if (!options.all && !options.user) {
    console.log('');
    console.log('  User-level codex/agy configs were left in place (runtime gate keeps them');
    console.log('  inert outside pd projects). Clear those too: pd squid off --all');
  }
  console.log('  Re-arm any time: pd squid on');
}

/** `pd squid status` — the non-diegetic readout: every background surface, live. */
async function handleSquidStatus(options: CLIOptions): Promise<void> {
  const cwd = String(options.cwd ?? options.workdir ?? process.cwd());
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const { buildTargets, tentacleBinDir } = await import('./hooks-install.js');
  const identity = readIdentityStatus(cwd, home);
  const matrix = readMatrixSnapshot();
  const c = squidTokens('stdout');
  const yes = (v: boolean, on = 'armed', off = 'not armed'): string => (v ? c.ok(`✓ ${on}`) : c.dim(`✗ ${off}`));

  console.log('');
  ui.info('Giant Squid harness — background machinery (non-diegetic readout)');
  console.log('');
  console.log(`  Daemon        ${identity.daemonAlive ? c.ok('✓ alive') : c.bad('✗ down — every hook no-ops (gate fails open)')}`);
  console.log(`  Tentacles     ${yes(existsSync(join(tentacleBinDir(), 'pd-hook-prompt')), `staged at ${tentacleBinDir()}`, 'not staged — pd squid on')}`);
  console.log('');
  console.log('  Interactive hook wiring (config carries the pd-hook- marker):');
  for (const target of buildTargets(home)) {
    const wiredAt = (path: string): boolean => {
      try { return existsSync(path) && readFileSync(path, 'utf8').includes(PD_HOOK_MARKER); } catch { return false; }
    };
    const user = wiredAt(target.userConfigPath);
    const project = target.projectConfigPath ? wiredAt(target.projectConfigPath(cwd)) : false;
    const marks = [project ? c.ok('project') : null, user ? c.ok('user') : null].filter(Boolean).join(' + ');
    console.log(`    ${target.name.padEnd(20)} ${target.detect() ? (marks || c.dim('detected, not wired')) : c.dim('not installed')}`);
  }
  console.log('');
  console.log('  Visual identity:');
  console.log(`    statusline        ${yes(identity.statuslineProject, 'project ◆ PD badge', 'not wired')}${identity.statuslineUser ? ` ${c.dim('(+user)')}` : ''}`);
  console.log(`    /squid command    ${yes(identity.slashCommand, 'installed', 'not installed')}`);
  console.log('');
  console.log(`  Ink Cloud matrix ${c.dim(`(${matrix.path})`)}:`);
  if (!matrix.exists) {
    console.log(`    ${c.dim('no matrix yet — nothing is being injected')}`);
  } else {
    console.log(`    steering alerts   ${matrix.alerts.length}${matrix.alerts.map((a) => `\n      ${c.bad('!')} ${a}`).join('')}`);
    console.log(`    pheromone traces  ${matrix.pheromones.length}${matrix.pheromones.slice(0, 5).map((p) => `\n      ${c.dim(`· ${p}`)}`).join('')}${matrix.pheromones.length > 5 ? `\n      ${c.dim(`… ${matrix.pheromones.length - 5} more`)}` : ''}`);
    console.log(`    locks             ${matrix.locks.length}${matrix.locks.map((l) => `\n      ${c.dim(`⊘ ${l}`)}`).join('')}`);
  }
  console.log('');
  await printBridgeProbe(options);
  console.log('');
  console.log(`  ${c.dim('Next-turn injection preview: pd squid tap')}`);
  console.log('');
}

/** Probe the local Claude⇄Codex bridge so status shows whether a pilot is live. */
async function printBridgeProbe(options: CLIOptions): Promise<void> {
  const port = parseInt(String(options.port ?? process.env.PD_SQUID_BRIDGE_PORT ?? '8765'), 10);
  const c = squidTokens('stdout');
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    if (res.ok) {
      console.log(`  Codex bridge   ${c.ok('✓ listening')} ${c.pilot('◆ PD⇄CODEX')} on 127.0.0.1:${port} — sessions launched by pd squid codex are piloted by Codex`);
      return;
    }
    console.log(`  Codex bridge   ${c.dim(`port ${port} answered ${res.status} — not the squid bridge`)}`);
  } catch {
    console.log(`  Codex bridge   ${c.dim('not running (pd squid codex --tier strong to start one)')}`);
  }
}

/**
 * `pd squid tap` — print EXACTLY what the UserPromptSubmit tentacle would
 * inject into the next turn from this cwd (the Suggestibility Envelope), by
 * running the real staged tentacle.
 */
function handleSquidTap(options: CLIOptions): void {
  const cwd = String(options.cwd ?? options.workdir ?? process.cwd());
  const home = process.env.HOME || process.env.USERPROFILE || '';
  // Honor a PD_HOME override the same way the tentacles themselves do.
  const pdHome = process.env.PD_HOME || join(home, '.port-daddy');
  const candidates = [
    join(pdHome, 'bin', 'squid', 'pd-hook-prompt'),
    join(SQUID_PROJECT_ROOT, 'bin', 'pd-hook-prompt'),
  ];
  const tentacle = candidates.find((p) => existsSync(p));
  if (!tentacle) {
    ui.warn('pd-hook-prompt not found (neither staged nor on this build).');
    return;
  }
  let out = '';
  try {
    out = execFileSync(tentacle, [], {
      input: JSON.stringify({ cwd }),
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
  } catch (err) {
    ui.warn(`Tentacle failed (fails open in-session): ${(err as Error).message}`);
    return;
  }
  const D = '\x1b[2m', Z = '\x1b[0m';
  console.log('');
  ui.info('Suggestibility Envelope — what the next turn would receive');
  console.log(`  ${D}source: ${tentacle}${Z}`);
  console.log(`  ${D}cwd:    ${cwd}${Z}`);
  console.log('');
  if (out.trim().length === 0) {
    console.log(`  ${D}(empty — no steering alerts, no pheromone traces near this directory)${Z}`);
  } else {
    for (const line of out.trimEnd().split('\n')) console.log(`  ${line}`);
  }
  console.log('');
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === '[::1]';
}

function resolveSquidAuthToken(options: CLIOptions): { token: string | null; source: SquidBridgeConfig['authTokenSource'] } {
  if (options.token === false || options['no-token'] === true) return { token: null, source: 'disabled' };
  if (typeof options.token === 'string') return { token: options.token, source: 'explicit' };
  if (typeof process.env.PD_SQUID_BRIDGE_TOKEN === 'string' && process.env.PD_SQUID_BRIDGE_TOKEN.length > 0) {
    return { token: process.env.PD_SQUID_BRIDGE_TOKEN, source: 'explicit' };
  }
  return { token: `squid-${randomBytes(GENERATED_TOKEN_BYTES).toString('base64url')}`, source: 'generated' };
}

function isUsableLocalToken(token: string): boolean {
  return token.trim().length > 0 && !/[\0\r\n]/.test(token);
}

function resolveSquidTier(options: CLIOptions): SquidTier | undefined {
  const raw = typeof options.tier === 'string'
    ? options.tier
    : typeof options['model-tier'] === 'string'
      ? options['model-tier']
      : typeof options.thinking === 'string'
        ? options.thinking
        : undefined;
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'low') return 'fast';
  if (normalized === 'medium' || normalized === 'balanced') return 'mid';
  if (normalized === 'high' || normalized === 'pro') return 'strong';
  if (normalized in SQUID_TIER_PRESETS) return normalized as SquidTier;
  throw new Error(`Unknown Squid tier "${raw}". Use fast, mid, or strong.`);
}

/** Normalize parser output for repeatable flags. */
export function normalizeStringArray(value: CLIOptions[string]): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function parseModelAliases(values: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const value of values.flatMap((entry) => entry.split(','))) {
    if (Object.keys(aliases).length >= MAX_MODEL_ALIASES) {
      throw new Error(`Too many Squid model aliases; maximum is ${MAX_MODEL_ALIASES}`);
    }
    if (value.length > MAX_MODEL_ALIAS_LENGTH || /[\0\r\n]/.test(value)) {
      throw new Error(`Invalid Squid model alias "${value}": alias is too long or contains a control character`);
    }
    const separator = value.indexOf('=');
    if (separator <= 0) continue;
    const from = value.slice(0, separator).trim();
    const to = value.slice(separator + 1).trim();
    if ((from && !MODEL_ALIAS_ID.test(from)) || (to && !MODEL_ALIAS_ID.test(to))) {
      throw new Error(`Invalid Squid model alias "${value}": expected model=backend-model with simple model ids`);
    }
    if (from && to) aliases[from] = to;
  }
  return aliases;
}

function formatModelAliases(aliases: Record<string, string>): string {
  return Object.entries(aliases).map(([from, to]) => `${from}=${to}`).join(', ');
}

function terminalDecorationsEnabled(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function printBridgeCard(args: {
  baseUrl: string;
  token: string | null;
  tokenSource: SquidBridgeConfig['authTokenSource'];
  serveOnly: boolean;
  codexModel?: string;
  capabilityTier?: SquidTier;
  aliases: Record<string, string>;
}): void {
  const decorated = terminalDecorationsEnabled();
  const label = args.tokenSource === 'generated'
    ? 'generated per run'
    : args.tokenSource === 'explicit'
      ? 'explicit'
      : 'disabled';
  const command = args.serveOnly
    ? `ANTHROPIC_BASE_URL=${args.baseUrl} ANTHROPIC_AUTH_TOKEN=${args.token ?? ''} claude`
    : 'client launched with Anthropic env injected';

  if (!decorated) {
    console.log('Injected for Anthropic-compatible clients:');
    console.log(`  export ANTHROPIC_BASE_URL=${args.baseUrl}`);
    console.log(`  export ANTHROPIC_AUTH_TOKEN=${args.token ?? ''}`);
    console.log(`  token source: ${label}`);
    console.log('');
    console.log('Routes: GET /health, POST /v1/messages, POST /v1/messages/count_tokens');
    return;
  }

  const rows = [
    ['Base URL', args.baseUrl],
    ['Auth', label],
    ['Tier', args.capabilityTier ?? 'backend default'],
    ['Backend', args.codexModel ? `codex exec --model ${args.codexModel}` : 'codex exec'],
    ['Aliases', Object.keys(args.aliases).length > 0 ? formatModelAliases(args.aliases) : 'request model passes through'],
    ['Use now', command],
  ];
  const width = 78;
  const valueWidth = 64;
  const title = 'Giant Squid :: Claude-shaped local bridge';
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, width - title.length - 5))}╮`;
  console.log(top);
  for (const [key, value] of rows) {
    console.log(`│ ${key.padEnd(9)} ${String(value).slice(0, valueWidth).padEnd(valueWidth)} │`);
  }
  console.log(`├${'─'.repeat(width - 2)}┤`);
  console.log('│ Routes    GET /health  POST /v1/messages  POST /v1/messages/count_tokens │');
  console.log('│ Boundary  unofficial compatibility layer; not Claude Code auth            │');
  console.log(`╰${'─'.repeat(width - 2)}╯`);
}

function printHelp(): void {
  console.log(`Usage:
  pd squid on     [--cwd <repo>]                 Arm the FULL harness for this project
  pd squid off    [--all] [--cwd <repo>]         Disarm it (hooks, statusline, /squid)
  pd squid status                                Non-diegetic readout of every surface
  pd squid tap                                   Preview the next-turn injection envelope
  pd squid hooks  [--provider <name>] [--cwd <repo>]
  pd squid bridge [bridge options] [-- <client> <args...>]
  pd squid codex  [bridge options] [-- <client> <args...>]
  pd squid pro    [bridge options] [-- <client> <args...>]
  pd squid serve  [bridge options]

Toggle:
  on    Stage tentacles + wire hooks for detected CLIs, install the ◆ PD
        statusline, the Pilot SessionStart steering hook, and /squid — one shot.
  off   Remove all of it from this project. --all also clears user-level
        codex/agy configs (otherwise the runtime gate just keeps them inert).

Hook options:
  --provider <name>           Hook provider: all, claude, codex, gemini, antigravity; repeatable
  --cwd <repo>                Repository/workspace whose agent hook configs should be armed

Bridge options:
  --port <n>                  Local bridge port (default: 8765)
  --host <addr>               Local bind host (default: 127.0.0.1)
  --cwd <repo>                Working directory for Codex and launched client
  --max-request-bytes <n>     Max JSON request body size (default: ${DEFAULT_SQUID_MAX_REQUEST_BYTES})
  --token <token>             Local bridge token (default: generated per run)
  --no-token                  Disable auth; loopback-only
  --tier <fast|mid|strong>    Public capability tier; maps to Codex reasoning effort
  --model-tier <tier>         Alias for --tier
  --thinking <tier>           Alias for --tier
  --codex-model <model>       Actual Codex CLI model
  --codex-model-alias <a=b>   Route client model a to Codex backend model b; repeatable
  --codex-effort <level>      Shortcut for -c model_reasoning_effort="<level>"
  --codex-config <key=value>  Extra Codex -c override; repeatable
  --client <bin>              Client to launch when no -- passthrough is given
  --client-arg <arg>          Client arg; repeatable
  --serve-only                With bridge, do not launch a client
  --no-isolate                Share the operator's Claude config instead of a clean
                              isolated one (Claude Code will warn about the login/token
                              auth conflict; only use if you need your global MCP/login)

Examples:
  pd squid hooks
  pd squid hooks --provider claude --provider codex
  pd squid codex --tier strong
  pd squid pro --thinking strong
  pd squid bridge --tier mid -- your-client
  pd squid bridge --client claude --client-arg=-p --client-arg="Say hi"
  pd squid serve --port 8765

Runs an unofficial local Anthropic Messages compatibility endpoint backed by Codex CLI,
then launches a Claude-compatible client with ANTHROPIC_BASE_URL and local auth injected.
This is not an official Claude Code auth mode.`);
}
