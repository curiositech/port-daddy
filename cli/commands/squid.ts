/**
 * `pd squid` - local Giant Squid compatibility surfaces.
 */

import { spawn as spawnChild } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_SQUID_MAX_REQUEST_BYTES,
  listenClaudeCodexBridge,
} from '../../lib/squid/claude-codex-bridge.js';
import { squidAdapters } from '../../lib/squid/adapter.js';
import { normalizeCodexConfigOverrides } from '../../lib/spawner/backends/cli-tube.js';
import type { CLIOptions } from '../types.js';
import * as ui from '../utils/ui.js';

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

/** Build the child-process environment for a Claude-compatible client. */
export function bridgeClientEnv(baseUrl: string, authToken: string | null, baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    ANTHROPIC_BASE_URL: baseUrl,
  };
  if (authToken) {
    env.ANTHROPIC_AUTH_TOKEN = authToken;
    env.ANTHROPIC_API_KEY = authToken;
  } else {
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_API_KEY;
  }
  return env;
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
): ClientLaunch {
  const command = passthrough[0] || String(options.client ?? 'claude');
  const args = passthrough.length > 0 ? passthrough.slice(1) : normalizeStringArray(options['client-arg']);
  return { command, args, env: bridgeClientEnv(baseUrl, authToken, baseEnv) };
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
  console.log('Installed tentacles: pre-turn envelope, pre-tool veto, post-tool telemetry.');
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
    const launch = resolveClientLaunch(baseUrl, config.authToken, clientPassthrough, options);
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
  pd squid hooks  [--provider <name>] [--cwd <repo>]
  pd squid bridge [bridge options] [-- <client> <args...>]
  pd squid codex  [bridge options] [-- <client> <args...>]
  pd squid pro    [bridge options] [-- <client> <args...>]
  pd squid serve  [bridge options]

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
