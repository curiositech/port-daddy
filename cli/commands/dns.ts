/**
 * CLI DNS Commands
 *
 * Usage:
 *   pd dns list [--pattern <glob>] [--limit <n>]
 *   pd dns register <identity> --port <n> [--hostname <name.local>]
 *   pd dns unregister <identity>
 *   pd dns lookup <hostname>
 *   pd dns cleanup
 *   pd dns status
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import { status as maritimeStatus } from '../../lib/maritime.js';
import { tableHeader, separator } from '../utils/output.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';

interface DnsRecord {
  identity: string;
  hostname: string;
  port: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Handle dns commands
 */
export async function handleDns(
  subcommand: string | undefined,
  args: string[],
  options: CLIOptions
): Promise<void> {
  if (!subcommand || subcommand === 'help') {
    console.error('Usage: pd dns <subcommand> [args] [options]');
    console.error('');
    console.error('Local DNS records for services');
    console.error('');
    console.error('Subcommands:');
    console.error('  list                              List DNS records');
    console.error('  register <identity> --port <n>    Register a DNS record');
    console.error('  unregister <identity>             Remove a DNS record');
    console.error('  lookup <hostname>                 Lookup by hostname');
    console.error('  cleanup                           Remove stale records');
    console.error('  status                            DNS system status');
    console.error('');
    console.error('Options:');
    console.error('  --port <n>           Port number (required for register)');
    console.error('  --hostname <name>    Custom hostname (must end in .local)');
    console.error('  --pattern <glob>     Filter by identity pattern');
    console.error('  --limit <n>          Max records to return (default: 100)');
    console.error('  -j, --json           Output as JSON');
    console.error('  -q, --quiet          Minimal output');
    if (!subcommand) process.exit(1);
    return;
  }

  switch (subcommand) {
    case 'list':
    case 'ls':
      await dnsList(options);
      break;

    case 'register':
    case 'add':
      await dnsRegister(args[0], options);
      break;

    case 'unregister':
    case 'rm':
    case 'remove':
      await dnsUnregister(args[0], options);
      break;

    case 'lookup':
      await dnsLookup(args[0], options);
      break;

    case 'cleanup':
      await dnsCleanup(options);
      break;

    case 'status':
      await dnsStatus(options);
      break;

    default:
      console.error(`Unknown dns subcommand: ${subcommand}`);
      console.error('Run "pd dns help" for usage');
      process.exit(1);
  }
}

/**
 * List DNS records
 */
async function dnsList(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.pattern) params.append('pattern', options.pattern as string);
  if (options.limit) params.append('limit', options.limit as string);

  const qs = params.toString() ? `?${params.toString()}` : '';
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns${qs}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list DNS records'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const records = data.records as DnsRecord[];
  if (!records || records.length === 0) {
    if (!isQuiet(options)) console.error('No DNS records found');
    return;
  }

  if (isQuiet(options)) {
    for (const r of records) {
      console.log(`${r.hostname}\t${r.port}\t${r.identity}`);
    }
    return;
  }

  console.log('');
  console.log(tableHeader(['HOSTNAME', 30], ['PORT', 8], ['IDENTITY', 35]));
  separator(73);

  for (const r of records) {
    console.log(
      r.hostname.padEnd(30) +
      String(r.port).padEnd(8) +
      r.identity
    );
  }

  console.log('');
  console.log(`Total: ${records.length} record(s)`);
}

/**
 * Register a DNS record
 */
async function dnsRegister(identity: string | undefined, options: CLIOptions): Promise<void> {
  if (!identity) {
    console.error('Usage: pd dns register <identity> --port <n> [--hostname <name.local>]');
    process.exit(1);
  }

  const port = options.port ? parseInt(options.port as string, 10) : undefined;
  if (!port || isNaN(port)) {
    console.error('Error: --port is required for dns register');
    process.exit(1);
  }

  const body: Record<string, unknown> = { port };
  if (options.hostname) body.hostname = options.hostname;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/${encodeURIComponent(identity)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to register DNS'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.hostname);
  } else {
    const action = data.updated ? 'Updated' : 'Registered';
    console.log(`${action}: ${data.hostname} -> port ${data.port}`);
  }
}

/**
 * Unregister a DNS record
 */
async function dnsUnregister(identity: string | undefined, options: CLIOptions): Promise<void> {
  if (!identity) {
    console.error('Usage: pd dns unregister <identity>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/${encodeURIComponent(identity)}`, {
    method: 'DELETE',
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to unregister DNS'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.hostname);
  } else {
    console.log(`Unregistered: ${data.hostname}`);
  }
}

/**
 * Lookup DNS record by hostname
 */
async function dnsLookup(hostname: string | undefined, options: CLIOptions): Promise<void> {
  if (!hostname) {
    console.error('Usage: pd dns lookup <hostname>');
    process.exit(1);
  }

  // Use the list endpoint with pattern match, or get by identity if it looks like one
  // Actually, we look up by hostname via the DNS list and filter
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to lookup DNS'));
    process.exit(1);
  }

  const records = data.records as DnsRecord[];
  const match = records?.find((r: DnsRecord) => r.hostname === hostname.toLowerCase());

  if (!match) {
    console.error(`DNS record not found for hostname: ${hostname}`);
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify({ success: true, record: match }, null, 2));
  } else if (isQuiet(options)) {
    console.log(match.port);
  } else {
    console.log(`${match.hostname} -> port ${match.port} (${match.identity})`);
  }
}

/**
 * Cleanup stale DNS records
 */
async function dnsCleanup(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/cleanup`, {
    method: 'POST',
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'DNS cleanup failed'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.cleaned);
  } else {
    console.log(`DNS cleanup complete: ${data.cleaned} stale record(s) removed`);
  }
}

/**
 * DNS system status
 */
async function dnsStatus(options: CLIOptions): Promise<void> {
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/dns/status`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get DNS status'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.recordCount);
  } else {
    console.log(`DNS records: ${data.recordCount}`);
    console.log(`Bonjour/mDNS: ${data.bonjourAvailable ? 'available' : 'not available'}`);
  }
}
