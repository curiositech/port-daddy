/**
 * Tunnel CLI Commands
 *
 * Usage:
 *   pd tunnel start <identity> [--provider ngrok|cloudflared|localtunnel]
 *   pd tunnel stop <identity>
 *   pd tunnel status <identity>
 *   pd tunnel list
 *   pd tunnel providers
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { status as maritimeStatus } from '../../lib/maritime.js';
import { tableHeader, separator } from '../utils/output.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';

type TunnelProvider = 'ngrok' | 'cloudflared' | 'localtunnel';

/**
 * Handle tunnel commands
 */
export async function handleTunnel(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  if (!subcommand) {
    console.error('Usage: pd tunnel <subcommand> [args]');
    console.error('');
    console.error('Subcommands:');
    console.error('  start <identity> [--provider ngrok]  Start a tunnel');
    console.error('  stop <identity>                      Stop a tunnel');
    console.error('  status <identity>                    Get tunnel status');
    console.error('  list                                 List active tunnels');
    console.error('  providers                            Check installed providers');
    process.exit(1);
  }

  switch (subcommand) {
    case 'start':
      await tunnelStart(args[0], options);
      break;

    case 'stop':
      await tunnelStop(args[0], options);
      break;

    case 'status':
      await tunnelStatus(args[0], options);
      break;

    case 'list':
    case 'ls':
      await tunnelList(options);
      break;

    case 'providers':
      await tunnelProviders(options);
      break;

    default:
      console.error(`Unknown tunnel subcommand: ${subcommand}`);
      console.error('Subcommands: start, stop, status, list, providers');
      process.exit(1);
  }
}

/**
 * Start a tunnel for a service
 */
async function tunnelStart(identity: string | undefined, options: CLIOptions): Promise<void> {
  if (!identity) {
    console.error('Usage: pd tunnel start <identity> [--provider ngrok|cloudflared|localtunnel]');
    process.exit(1);
  }

  const provider = (options.provider as TunnelProvider) || 'ngrok';

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/tunnel/${encodeURIComponent(identity)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to start tunnel'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.url);
    return;
  }

  console.log(maritimeStatus('success', `Tunnel started for ${identity}`));
  console.log(`  Provider: ${provider}`);
  console.log(`  URL: ${data.url}`);
}

/**
 * Stop a tunnel for a service
 */
async function tunnelStop(identity: string | undefined, options: CLIOptions): Promise<void> {
  if (!identity) {
    console.error('Usage: pd tunnel stop <identity>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/tunnel/${encodeURIComponent(identity)}`,
    { method: 'DELETE' }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to stop tunnel'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (!isQuiet(options)) {
    console.log(maritimeStatus('success', `Tunnel stopped for ${identity}`));
  }
}

/**
 * Get tunnel status for a service
 */
async function tunnelStatus(identity: string | undefined, options: CLIOptions): Promise<void> {
  if (!identity) {
    console.error('Usage: pd tunnel status <identity>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(
    `${PORT_DADDY_URL}/tunnel/${encodeURIComponent(identity)}`
  );

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get tunnel status'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(data.status);
    return;
  }

  const statusIcon = data.status === 'running' ? '\x1b[32m●\x1b[0m' : '\x1b[90m○\x1b[0m';
  console.log(`${statusIcon} ${identity}`);
  console.log(`  Status: ${data.status}`);
  console.log(`  Provider: ${data.provider}`);
  console.log(`  Port: ${data.port}`);

  if (data.url) {
    console.log(`  URL: ${data.url}`);
  }

  if (data.pid) {
    console.log(`  PID: ${data.pid}`);
  }
}

/**
 * List all active tunnels
 */
async function tunnelList(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/tunnels`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list tunnels'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const tunnels = data.tunnels as Array<{
    serviceId: string;
    provider: string;
    port: number;
    url: string | null;
    status: string;
  }>;

  if (tunnels.length === 0) {
    console.log('No active tunnels');
    return;
  }

  console.log('');
  console.log(tableHeader(['SERVICE', 30], ['PROVIDER', 12], ['PORT', 6], ['URL', 40]));
  separator(88);

  for (const t of tunnels) {
    const url = t.url || '(starting...)';
    console.log(
      `${t.serviceId.padEnd(30)}${t.provider.padEnd(12)}${String(t.port).padEnd(6)}${url}`
    );
  }

  console.log('');
}

/**
 * Check which tunnel providers are installed
 */
async function tunnelProviders(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/tunnel/providers`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to check providers'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const providers = data.providers as Record<string, boolean>;

  console.log('');
  console.log('Tunnel Providers:');
  console.log('');

  for (const [name, installed] of Object.entries(providers)) {
    const icon = installed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const status = installed ? 'installed' : 'not installed';
    console.log(`  ${icon} ${name.padEnd(15)} ${status}`);
  }

  console.log('');

  // Show install hints for missing providers
  const missing = Object.entries(providers)
    .filter(([, installed]) => !installed)
    .map(([name]) => name);

  if (missing.length > 0) {
    console.log('Install missing providers:');
    console.log('');

    const hints: Record<string, string> = {
      ngrok: 'brew install ngrok/ngrok/ngrok  OR  npm i -g ngrok',
      cloudflared: 'brew install cloudflare/cloudflare/cloudflared',
      localtunnel: 'npm i -g localtunnel'
    };

    for (const name of missing) {
      if (hints[name]) {
        console.log(`  ${name}: ${hints[name]}`);
      }
    }

    console.log('');
  }
}
