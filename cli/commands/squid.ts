/**
 * `pd squid` - local Giant Squid compatibility surfaces.
 */

import type { AddressInfo } from 'node:net';
import { listenClaudeCodexBridge } from '../../lib/squid/claude-codex-bridge.js';
import type { CLIOptions } from '../types.js';
import * as ui from '../utils/ui.js';

export async function handleSquid(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0] || 'help';
  switch (sub) {
    case 'bridge':
    case 'codex-bridge':
      await handleCodexBridge(options);
      return;
    case 'help':
    case '--help':
    case '-h':
    default:
      printHelp();
      return;
  }
}

async function handleCodexBridge(options: CLIOptions): Promise<void> {
  const port = parseInt(String(options.port ?? process.env.PD_SQUID_BRIDGE_PORT ?? '8765'), 10);
  const host = String(options.host ?? process.env.PD_SQUID_BRIDGE_HOST ?? '127.0.0.1');
  const cwd = String(options.cwd ?? options.workdir ?? process.cwd());
  const timeoutMs = parseInt(String(options.timeout ?? options['timeout-ms'] ?? 10 * 60 * 1000), 10);
  const authToken = options.token === false
    ? null
    : String(options.token ?? process.env.PD_SQUID_BRIDGE_TOKEN ?? 'squid-local');
  const codexModel = typeof options.model === 'string' ? options.model : undefined;

  const server = await listenClaudeCodexBridge({
    port,
    host,
    cwd,
    timeoutMs,
    authToken,
    codexModel,
  });
  const info = server.address() as AddressInfo;
  const displayHost = info.address === '::' ? '127.0.0.1' : info.address;
  const baseUrl = `http://${displayHost}:${info.port}`;

  ui.success('Giant Squid Claude-to-Codex bridge is listening');
  console.log(`  base URL:  ${baseUrl}`);
  console.log(`  backend:   codex exec`);
  console.log(`  official:  no - compatibility bridge only`);
  console.log('');
  console.log('Use with Anthropic-compatible clients:');
  console.log(`  export ANTHROPIC_BASE_URL=${baseUrl}`);
  console.log(`  export ANTHROPIC_AUTH_TOKEN=${authToken ?? ''}`);
  console.log('');
  console.log('Routes: GET /health, POST /v1/messages');

  process.on('SIGINT', () => {
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

function printHelp(): void {
  console.log(`Usage:
  pd squid bridge [--port 8765] [--host 127.0.0.1] [--cwd <repo>] [--token <token>] [--model <codex-model>]

Runs an unofficial local Anthropic Messages compatibility endpoint backed by Codex CLI.
This is not an official Claude Code auth mode.`);
}
