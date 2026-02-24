/**
 * CLI Locks Commands
 *
 * Handles: lock, unlock, locks commands for distributed locking
 */

import { status as maritimeStatus } from '../../lib/maritime.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { getDirectLocks } from '../utils/direct-db.js';
import type { PdFetchResponse } from '../utils/fetch.js';

/**
 * Handle `pd lock <name>` command
 */
export async function handleLock(name: string | undefined, options: CLIOptions): Promise<void> {
  // Subcommand: lock extend <name> [--ttl <ms>]
  if (name === 'extend') {
    const extArgs = process.argv.slice(process.argv.indexOf('extend') + 1);
    let extName: string | undefined;
    let extTtl: string | undefined;
    for (let i = 0; i < extArgs.length; i++) {
      if (extArgs[i] === '--ttl' && extArgs[i + 1]) {
        extTtl = extArgs[++i];
      } else if (!extArgs[i].startsWith('-') && !extName) {
        extName = extArgs[i];
      }
    }
    if (!extName) {
      console.error('Usage: port-daddy lock extend <name> [--ttl <ms>]');
      process.exit(1);
    }
    const body: Record<string, unknown> = {
      ttl: extTtl ? parseInt(extTtl, 10) : 300000
    };
    if (options.owner) body.owner = options.owner;

    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/locks/${encodeURIComponent(extName)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      console.error(maritimeStatus('error', (data.error as string) || 'Failed to extend lock'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Extended lock: ${extName}`);
      if (data.expiresAt) {
        console.log(`  New expiry: ${new Date(data.expiresAt as number).toISOString()}`);
      }
    }
    return;
  }

  if (!name) {
    console.error('Usage: port-daddy lock <name> [--ttl <ms>] [--owner <id>]');
    console.error('       port-daddy lock extend <name> [--ttl <ms>]');
    console.error('       port-daddy lock db-migrations');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    owner: options.owner,
    ttl: options.ttl ? parseInt(options.ttl as string, 10) : 300000
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PID': String(process.pid)
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    if (data.error === 'lock is held') {
      console.error(`Lock '${name}' is held by ${data.holder}`);
      console.error(`  Held since: ${new Date(data.heldSince as number).toISOString()}`);
      if (data.expiresAt) {
        const remaining: number = Math.max(0, (data.expiresAt as number) - Date.now());
        console.error(`  Expires in: ${Math.ceil(remaining / 1000)}s`);
      }
      process.exit(1);
    }
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to acquire lock'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (isQuiet(options)) {
    // Silent success for scripting: port-daddy lock foo && do_stuff
  } else {
    console.log(maritimeStatus('success', `Acquired lock: ${name}`));
    if (data.expiresAt) {
      const ttlSeconds: number = Math.ceil(((data.expiresAt as number) - (data.acquiredAt as number)) / 1000);
      console.log(`  TTL: ${ttlSeconds}s`);
    }
  }
}

/**
 * Handle `pd unlock <name>` command
 */
export async function handleUnlock(name: string | undefined, options: CLIOptions): Promise<void> {
  if (!name) {
    console.error('Usage: port-daddy unlock <name> [--force]');
    process.exit(1);
  }

  const body: Record<string, unknown> = {
    owner: options.owner,
    force: options.force === true
  };

  const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/locks/${encodeURIComponent(name)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to release lock'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
  } else if (!isQuiet(options)) {
    if (data.released) {
      console.log(maritimeStatus('success', `Released lock: ${name}`));
    } else {
      console.log(maritimeStatus('warning', `Lock '${name}' was not held`));
    }
  }
}

/**
 * Handle `pd locks` command
 */
export async function handleLocks(options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.owner) params.append('owner', options.owner as string);

  const url: string = `${PORT_DADDY_URL}/locks${params.toString() ? '?' + params : ''}`;
  const res: PdFetchResponse = await pdFetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error(maritimeStatus('error', (data.error as string) || 'Failed to list locks'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.count === 0) {
    console.log('No active locks');
    return;
  }

  console.log('');
  console.log('NAME'.padEnd(30) + 'OWNER'.padEnd(25) + 'EXPIRES');
  console.log('\u2500'.repeat(70));

  const locks = data.locks as Array<{ name: string; owner: string; expiresAt?: number }>;
  for (const lock of locks) {
    const expires: string = lock.expiresAt
      ? new Date(lock.expiresAt).toISOString().replace('T', ' ').slice(0, 19)
      : 'never';
    console.log(
      lock.name.padEnd(30) +
      lock.owner.slice(0, 24).padEnd(25) +
      expires
    );
  }

  console.log('');
  console.log(`Total: ${data.count} lock(s)`);
}

/**
 * Direct-mode lock handler (no daemon required)
 */
export function handleLockDirect(name: string | undefined, options: CLIOptions): void {
  const lk = getDirectLocks();

  // Handle 'lock extend'
  if (name === 'extend') {
    const extArgs = process.argv.slice(process.argv.indexOf('extend') + 1);
    let extName: string | undefined;
    let extTtl: string | undefined;
    for (let i = 0; i < extArgs.length; i++) {
      if (extArgs[i] === '--ttl' && extArgs[i + 1]) {
        extTtl = extArgs[++i];
      } else if (!extArgs[i].startsWith('-') && !extName) {
        extName = extArgs[i];
      }
    }
    if (!extName) {
      console.error('Usage: port-daddy lock extend <name> [--ttl <ms>]');
      process.exit(1);
    }

    const result = lk.extend(extName, {
      ttl: extTtl ? parseInt(extTtl, 10) : 300000,
      owner: options.owner as string | undefined,
    });

    if (!result.success) {
      console.error(maritimeStatus('error', result.error || 'Failed to extend lock'));
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(result, null, 2));
    } else if (!isQuiet(options)) {
      console.log(`Extended lock: ${extName}`);
    }
    return;
  }

  if (!name) {
    console.error('Usage: port-daddy lock <name> [--ttl <ms>] [--owner <id>]');
    process.exit(1);
  }

  const result = lk.acquire(name, {
    owner: options.owner as string | undefined,
    ttl: options.ttl ? parseInt(options.ttl as string, 10) : 300000,
    pid: process.pid,
  });

  if (!result.success) {
    if (result.error === 'lock is held') {
      console.error(`Lock '${name}' is held by ${result.holder}`);
      if (result.heldSince) console.error(`  Held since: ${new Date(result.heldSince as number).toISOString()}`);
      if (result.expiresAt) {
        const remaining = Math.max(0, (result.expiresAt as number) - Date.now());
        console.error(`  Expires in: ${Math.ceil(remaining / 1000)}s`);
      }
      process.exit(1);
    }
    console.error(maritimeStatus('error', result.error || 'Failed to acquire lock'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (isQuiet(options)) {
    // Silent success for scripting
  } else {
    console.log(maritimeStatus('success', `Acquired lock: ${name}`));
    if (result.expiresAt) {
      const ttlSeconds = Math.ceil(((result.expiresAt as number) - (result.acquiredAt as number)) / 1000);
      console.log(`  TTL: ${ttlSeconds}s`);
    }
  }
}

/**
 * Direct-mode unlock handler (no daemon required)
 */
export function handleUnlockDirect(name: string | undefined, options: CLIOptions): void {
  if (!name) {
    console.error('Usage: port-daddy unlock <name> [--force]');
    process.exit(1);
  }

  const lk = getDirectLocks();
  const result = lk.release(name, {
    owner: options.owner as string | undefined,
    force: options.force === true,
  });

  if (!result.success) {
    console.error(maritimeStatus('error', result.error || 'Failed to release lock'));
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!isQuiet(options)) {
    if (result.released) {
      console.log(maritimeStatus('success', `Released lock: ${name}`));
    } else {
      console.log(maritimeStatus('warning', `Lock '${name}' was not held`));
    }
  }
}

/**
 * Direct-mode locks list handler (no daemon required)
 */
export function handleLocksDirect(options: CLIOptions): void {
  const lk = getDirectLocks();
  const result = lk.list();

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const locks = result.locks as Array<{ name: string; owner: string; acquiredAt: number; expiresAt: number | null }>;
  if (!locks || locks.length === 0) {
    console.log('No active locks');
    return;
  }

  console.error('');
  console.error('NAME'.padEnd(25) + 'OWNER'.padEnd(20) + 'EXPIRES');
  console.error('\u2500'.repeat(65));
  for (const lock of locks) {
    const expires = lock.expiresAt
      ? new Date(lock.expiresAt).toISOString().slice(11, 19)
      : 'never';
    console.error(
      lock.name.padEnd(25) +
      lock.owner.slice(0, 19).padEnd(20) +
      expires
    );
  }
  console.error('');
}
