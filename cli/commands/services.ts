/**
 * CLI Services Commands
 *
 * Handles: claim, release, find, services, url, env, ports commands
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { getDirectServices } from '../utils/direct-db.js';
import { IS_TTY, separator, tableHeader } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Auto-detect identity from nearest package.json
 */
export function autoIdentityFromPackageJson(): string | undefined {
  let dir: string = process.cwd();
  const root: string = dirname(dir) === dir ? dir : '/';

  while (true) {
    const pkgPath: string = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
        if (pkg.name) {
          // Sanitize: strip @scope/, replace invalid chars with dashes
          const name: string = pkg.name
            .replace(/^@[^/]+\//, '')   // strip npm scope
            .replace(/[^a-zA-Z0-9._:-]/g, '-')
            .replace(/^-+|-+$/g, '');   // trim leading/trailing dashes
          return name || undefined;
        }
      } catch {
        // Invalid JSON, keep walking
      }
    }
    const parent: string = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Handle `pd claim <identity>` command
 */
export async function handleClaim(id: string | undefined, options: CLIOptions): Promise<void> {
  // Auto-identity: read from nearest package.json if no id given
  if (!id) {
    id = autoIdentityFromPackageJson();
    if (!id) {
      console.error('Usage: port-daddy claim <identity> [options]');
      console.error('  Tip: Run from a directory with package.json for auto-detection');
      process.exit(1);
    }
    if (IS_TTY) console.error(`Auto-detected identity: ${id}`);
  }

  const body: Record<string, unknown> = { id };
  if (options.port) body.port = parseInt(options.port as string, 10);
  if (options.range) {
    const [min, max] = (options.range as string).split('-').map((n: string) => parseInt(n, 10));
    body.range = [min, max];
  }
  if (options.expires) body.expires = options.expires;
  if (options.pair) body.pair = options.pair;
  if (options.cmd) body.cmd = options.cmd;

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PID': String(process.pid)
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to claim port'));
    process.exit(1);
  }

  if (isJson(options)) {
    // JSON mode: full data to stdout
    console.log(JSON.stringify(data, null, 2));
  } else if (options.export) {
    // Export mode: prints shell export statement for eval
    // Usage: eval $(port-daddy claim myapp --export)
    console.log(`export PORT=${data.port}`);
  } else if (isQuiet(options)) {
    // Quiet mode: just the port to stdout (-q or --quiet both set options.quiet)
    console.log(data.port);
  } else {
    // Normal mode: friendly message to stderr, port to stdout
    // This allows: PORT=$(port-daddy claim myapp) to work
    // while still showing the user what happened
    if (IS_TTY) {
      console.error(`${data.id} \u2192 port ${data.port}`);
      if (data.existing) console.error('  (reused existing)');
    }
    console.log(data.port);
  }
}

/**
 * Handle `pd release <identity>` command
 */
export async function handleRelease(id: string | undefined, options: CLIOptions): Promise<void> {
  const body: Record<string, unknown> = {};

  if (options.expired) {
    body.expired = true;
  } else if (!id) {
    console.error('Usage: port-daddy release <identity> [options]');
    console.error('       port-daddy release --expired');
    process.exit(1);
  } else {
    body.id = id;
  }

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/release`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to release'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    console.log(data.released);
  } else {
    console.log(data.message);
  }
}

/**
 * Handle `pd find <pattern>` / `pd services` command
 */
export async function handleFind(pattern: string | undefined, options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (pattern) params.append('pattern', pattern);
  if (options.status) params.append('status', options.status as string);
  if (options.port) params.append('port', options.port as string);
  if (options.expired) params.append('expired', 'true');

  const url: string = `${PORT_DADDY_URL}/services${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to find services'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.error('No services found');

    // Helpful hint about wildcards
    if (pattern && !pattern.includes('*')) {
      console.error('');
      console.error(`Hint: To find all services for "${pattern}", try:`);
      console.error(`  port-daddy find '${pattern}:*'`);
      console.error('');
      console.error('Remember to quote wildcards to prevent shell expansion.');
    }
    return;
  }

  // Table output goes to stderr (human-readable)
  // This keeps stdout clean for piping/scripting
  console.error('');
  console.error('ID'.padEnd(35) + 'PORT'.padEnd(8) + 'STATUS'.padEnd(12) + 'URL');
  console.error('\u2500'.repeat(75));

  const services = data.services as Array<{ id: string; port: number; status: string; urls?: { local?: string } }>;
  for (const svc of services) {
    const localUrl: string = svc.urls?.local || '-';
    console.error(
      svc.id.padEnd(35) +
      String(svc.port).padEnd(8) +
      svc.status.padEnd(12) +
      localUrl
    );
  }

  console.error('');
  console.error(`Total: ${data.count} service(s)`);
}

/**
 * Handle `pd url <identity>` command
 */
export async function handleUrl(id: string | undefined, options: CLIOptions): Promise<void> {
  if (!id) {
    console.error('Usage: port-daddy url <identity> [--env <environment>]');
    process.exit(1);
  }

  const env: string = (options.env as string) || 'local';
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services/${encodeURIComponent(id)}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Service not found'));
    process.exit(1);
  }

  const service = data.service as { urls?: Record<string, string> };
  const url: string | undefined = service.urls?.[env];
  if (!url) {
    console.error(`No ${env} URL for ${id}`);
    process.exit(1);
  }

  if (options.open) {
    const openCmd: string = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(openCmd, [url], { stdio: 'ignore', detached: true }).unref();
    console.log(`Opening ${url}`);
  } else {
    console.log(url);
  }
}

/**
 * Handle `pd env [pattern]` command
 */
export async function handleEnv(id: string | undefined, options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (id) params.append('pattern', id);

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/services?${params}`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to get services'));
    process.exit(1);
  }

  const lines: string[] = [];
  const services = data.services as Array<{ id: string; port: number; urls?: { local?: string } }>;
  for (const svc of services) {
    const varName: string = svc.id.toUpperCase().replace(/[:.]/g, '_') + '_PORT';
    lines.push(`${varName}=${svc.port}`);

    const urlVarName: string = svc.id.toUpperCase().replace(/[:.]/g, '_') + '_URL';
    if (svc.urls?.local) {
      lines.push(`${urlVarName}=${svc.urls.local}`);
    }
  }

  const output: string = lines.join('\n');

  if (options.file) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(options.file as string, output + '\n');
    console.log(`Wrote ${lines.length} variables to ${options.file}`);
  } else {
    console.log(output);
  }
}

/**
 * Handle `pd ports [subcommand]` command
 */
export async function handlePorts(subcommand: string | undefined, options: CLIOptions): Promise<void> {
  if (subcommand === 'cleanup') {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/ports/cleanup`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Cleanup failed'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Cleanup complete: ${data.released ?? 0} stale ports released`);
    }
    return;
  }

  if (options.system) {
    // System/well-known ports
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/ports/system`);
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to get system ports'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    const ports = data.ports as Array<{ port: number; process?: string; pid?: number }>;
    if (!ports || ports.length === 0) {
      console.log('No system ports in use');
      return;
    }
    console.log('');
    console.log(tableHeader(['PORT', 10], ['PROCESS', 30], ['PID', 10]));
    separator(50);
    for (const p of ports) {
      console.log(
        String(p.port).padEnd(10) +
        (p.process || '-').slice(0, 29).padEnd(30) +
        String(p.pid || '-').padEnd(10)
      );
    }
    console.log('');
    return;
  }

  // Default: list active ports
  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/ports/active`);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list ports'));
    process.exit(1);
  }

  // Detect API errors that returned 200 but no ports array
  if (data.error) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list ports'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const ports = data.ports as Array<{ port: number; identity: string; claimedAt?: number; expiresAt?: number }> | undefined;
  if (!ports) {
    console.error('Unexpected API response: missing ports array');
    process.exit(1);
  }
  if (ports.length === 0) {
    console.log('No active port assignments');
    return;
  }

  console.log('');
  console.log(tableHeader(['PORT', 10], ['IDENTITY', 35], ['CLAIMED', 22], ['EXPIRES', 22]));
  separator(89);

  for (const p of ports) {
    const claimed = p.claimedAt ? new Date(p.claimedAt).toISOString().replace('T', ' ').slice(0, 19) : '-';
    const expires = p.expiresAt ? new Date(p.expiresAt).toISOString().replace('T', ' ').slice(0, 19) : 'never';
    console.log(
      String(p.port).padEnd(10) +
      (p.identity || '-').slice(0, 34).padEnd(35) +
      claimed.padEnd(22) +
      expires.padEnd(22)
    );
  }
  console.log('');
}

/**
 * Direct-mode claim handler (no daemon required)
 */
export function handleClaimDirect(id: string | undefined, options: CLIOptions): void {
  if (!id) {
    id = autoIdentityFromPackageJson();
    if (!id) {
      console.error('Usage: port-daddy claim <identity> [options]');
      console.error('  Tip: Run from a directory with package.json for auto-detection');
      process.exit(1);
    }
    if (IS_TTY) console.error(`Auto-detected identity: ${id}`);
  }

  const services = getDirectServices();

  const claimOpts: Record<string, unknown> = {};
  if (options.port) claimOpts.preferredPort = parseInt(options.port as string, 10);
  if (options.range) {
    const [min, max] = (options.range as string).split('-').map((n: string) => parseInt(n, 10));
    claimOpts.range = [min, max];
  }
  if (options.expires) claimOpts.expires = options.expires;

  const result = services.claim(id, claimOpts as { preferredPort?: number; range?: [number, number]; expires?: string | number });

  if (!result.success) {
    console.error(maritimeStatus('error', result.error || 'Failed to claim port'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.export) {
    console.log(`export PORT=${result.port}`);
  } else if (isQuiet(options)) {
    console.log(result.port);
  } else {
    if (IS_TTY) {
      console.error(`${result.id} \u2192 port ${result.port}`);
      if (result.existing) console.error('  (reused existing)');
    }
    console.log(result.port);
  }
}

/**
 * Direct-mode release handler (no daemon required)
 */
export function handleReleaseDirect(id: string | undefined, options: CLIOptions): void {
  const services = getDirectServices();

  if (options.expired) {
    const result = services.cleanup();
    if (isJson(options)) {
      console.log(JSON.stringify(result, null, 2));
    } else if (isQuiet(options)) {
      console.log(result.cleaned);
    } else {
      console.log(`Released ${result.cleaned} expired service(s)`);
    }
    return;
  }

  if (!id) {
    console.error('Usage: port-daddy release <identity> [options]');
    console.error('       port-daddy release --expired');
    process.exit(1);
  }

  const result = services.release(id);

  if (!result.success) {
    console.error(maritimeStatus('error', result.error || 'Failed to release'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (isQuiet(options)) {
    console.log(result.released);
  } else {
    console.log(result.message);
  }
}

/**
 * Direct-mode find handler (no daemon required)
 */
export function handleFindDirect(pattern: string | undefined, options: CLIOptions): void {
  const services = getDirectServices();

  const findOpts: Record<string, unknown> = {};
  if (options.status) findOpts.status = options.status;
  if (options.port) findOpts.port = parseInt(options.port as string, 10);
  if (options.expired) findOpts.expired = true;

  const result = services.find(pattern || '*', findOpts as { status?: string; port?: number; expired?: boolean });

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.count === 0) {
    console.error('No services found');
    if (pattern && !pattern.includes('*')) {
      console.error('');
      console.error(`Hint: To find all services for "${pattern}", try:`);
      console.error(`  port-daddy find '${pattern}:*'`);
    }
    return;
  }

  console.error('');
  console.error('ID'.padEnd(35) + 'PORT'.padEnd(8) + 'STATUS'.padEnd(12) + 'URL');
  console.error('\u2500'.repeat(75));

  for (const svc of result.services ?? []) {
    const localUrl: string = (svc.urls as { local?: string })?.local || '-';
    console.error(
      svc.id.padEnd(35) +
      String(svc.port).padEnd(8) +
      svc.status.padEnd(12) +
      localUrl
    );
  }

  console.error('');
  console.error(`Total: ${result.count} service(s)`);
}
