/**
 * `pd squid` - local Giant Squid compatibility surfaces.
 */

import { spawn as spawnChild } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import {
  DEFAULT_SQUID_MAX_REQUEST_BYTES,
  listenClaudeCodexBridge,
} from '../../lib/squid/claude-codex-bridge.js';
import type { CLIOptions } from '../types.js';
import * as ui from '../utils/ui.js';

const DEFAULT_SQUID_TOKEN = 'squid-local';

export interface SquidBridgeConfig {
  host: string;
  port: number;
  cwd: string;
  timeoutMs: number;
  maxRequestBytes: number;
  authToken: string | null;
  codexModel?: string;
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
    case 'bridge':
    case 'codex-bridge':
      await handleCodexBridge(rest, options, { serveOnly: Boolean(options['serve-only']) });
      return;
    case 'serve':
      await handleCodexBridge(rest, options, { serveOnly: true });
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
  const codexEffort = typeof options['codex-effort'] === 'string' ? options['codex-effort'] : undefined;
  if (codexEffort) {
    codexConfig.push(`model_reasoning_effort="${codexEffort}"`);
  }
  const modelAliases = parseModelAliases([
    ...normalizeStringArray(process.env.PD_SQUID_MODEL_ALIASES),
    ...normalizeStringArray(options['codex-model-alias']),
  ]);
  const uniqueCodexConfig = [...new Set(codexConfig)];
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
    authToken: options.token === false
      ? null
      : String(options.token ?? process.env.PD_SQUID_BRIDGE_TOKEN ?? DEFAULT_SQUID_TOKEN),
    codexModel: typeof options['codex-model'] === 'string'
      ? options['codex-model']
      : typeof options.model === 'string'
        ? options.model
        : undefined,
    modelAliases,
    codexConfig: uniqueCodexConfig,
  };
}

/** Fail closed when the bridge is exposed beyond loopback with weak local auth. */
export function validateSquidBridgeConfig(config: SquidBridgeConfig): string | null {
  if (!Number.isFinite(config.maxRequestBytes) || config.maxRequestBytes <= 0) {
    return 'Refusing to start the Squid bridge with an invalid --max-request-bytes value.';
  }
  if (isLoopbackHost(config.host)) return null;
  if (!config.authToken) return 'Refusing to bind the Squid bridge off loopback with auth disabled; pass --host 127.0.0.1 or set a strong --token.';
  if (config.authToken === DEFAULT_SQUID_TOKEN) {
    return 'Refusing to bind the Squid bridge off loopback with the default token; set a strong --token or PD_SQUID_BRIDGE_TOKEN.';
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
  if (Object.keys(config.modelAliases).length > 0) console.log(`  aliases:  ${formatModelAliases(config.modelAliases)}`);
  if (config.codexConfig.length > 0) console.log(`  config:   ${config.codexConfig.join(', ')}`);
  console.log(`  official:  no - compatibility bridge only`);
  console.log('');
  console.log('Injected for Anthropic-compatible clients:');
  console.log(`  export ANTHROPIC_BASE_URL=${baseUrl}`);
  console.log(`  export ANTHROPIC_AUTH_TOKEN=${config.authToken ?? ''}`);
  console.log('');
  console.log('Routes: GET /health, POST /v1/messages, POST /v1/messages/count_tokens');

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

/** Normalize parser output for repeatable flags. */
export function normalizeStringArray(value: CLIOptions[string]): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  if (typeof value === 'string' && value.length > 0) return [value];
  return [];
}

function parseModelAliases(values: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const value of values.flatMap((entry) => entry.split(','))) {
    const separator = value.indexOf('=');
    if (separator <= 0) continue;
    const from = value.slice(0, separator).trim();
    const to = value.slice(separator + 1).trim();
    if (from && to) aliases[from] = to;
  }
  return aliases;
}

function formatModelAliases(aliases: Record<string, string>): string {
  return Object.entries(aliases).map(([from, to]) => `${from}=${to}`).join(', ');
}

function printHelp(): void {
  console.log(`Usage:
  pd squid bridge [bridge options] [-- <client> <args...>]
  pd squid serve  [bridge options]

Bridge options:
  --port <n>                  Local bridge port (default: 8765)
  --host <addr>               Local bind host (default: 127.0.0.1)
  --cwd <repo>                Working directory for Codex and launched client
  --max-request-bytes <n>     Max JSON request body size (default: ${DEFAULT_SQUID_MAX_REQUEST_BYTES})
  --token <token>             Local bridge token (default: squid-local)
  --codex-model <model>       Actual Codex CLI model
  --codex-model-alias <a=b>   Route client model a to Codex backend model b; repeatable
  --codex-effort <level>      Shortcut for -c model_reasoning_effort="<level>"
  --codex-config <key=value>  Extra Codex -c override; repeatable
  --client <bin>              Client to launch when no -- passthrough is given
  --client-arg <arg>          Client arg; repeatable
  --serve-only                With bridge, do not launch a client

Examples:
  pd squid bridge --codex-model-alias client-model=backend-model --codex-effort high -- your-client --model client-model
  pd squid bridge --client claude --client-arg=-p --client-arg="Say hi"
  pd squid serve --port 8765

Runs an unofficial local Anthropic Messages compatibility endpoint backed by Codex CLI,
then launches a Claude-compatible client with ANTHROPIC_BASE_URL and local auth injected.
This is not an official Claude Code auth mode.`);
}
