/**
 * CLI Locks Commands
 *
 * Handles: lock, unlock, locks commands for distributed locking
 */

import { CLIOptions, isQuiet, isJson } from '../types.js';
import { getDirectLocks } from '../utils/direct-db.js';
import * as ui from '../utils/ui.js';
import PortDaddy from '../../lib/client.js';
import { requireConfirmation, DESTRUCTIVE_EXIT_CODE } from '../utils/destructive-confirm.js';
import { ensureCliActorCredential, resolveCliActorCredential } from '../utils/actor-credential.js';
import { readCurrentContext } from '../utils/current-context.js';

/**
 * Build the SDK client for lock commands with the ADR-0040 actor credential
 * (#8877 / ADR-0122 — lock mutations reject without one). The asserted owner
 * is `--owner` when given, else the context agent from `pd begin`; the
 * credential resolves through the shared CLI resolver so a mismatched
 * context credential is never presented for someone else's owner name.
 */
function createLockClient(options: CLIOptions): PortDaddy {
  const owner = typeof options.owner === 'string' ? options.owner : readCurrentContext()?.agentId;
  return new PortDaddy({
    agentId: owner,
    credential: resolveCliActorCredential(owner),
    pid: process.pid,
  });
}

/**
 * Handle `pd lock <name-or-path>` command
 */
export async function handleLock(name: string | undefined, options: CLIOptions): Promise<void> {
  const pd = createLockClient(options);
  // #8877 / ADR-0122: lock mutations require a daemon-minted credential;
  // mint one (persisted per shell slot) when this shell holds none.
  if (!pd.credential) {
    try {
      pd.credential = await ensureCliActorCredential(typeof options.owner === 'string' ? options.owner : undefined);
    } catch (error) {
      console.error(`ERROR: failed to mint actor credential: ${(error as Error).message}`);
      process.exit(1);
    }
  }

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
      console.error('Usage: port-daddy lock extend <name-or-path> [--ttl <ms>]');
      process.exit(1);
    }

    try {
      const data = await pd.extendLock(extName, {
        owner: typeof options.owner === 'string' ? options.owner : undefined,
        ttl: extTtl ? parseInt(extTtl, 10) : 300000,
      });
      if (isJson(options)) {
        console.log(JSON.stringify(data, null, 2));
      } else if (!isQuiet(options)) {
        console.log(`Extended lock: ${extName}`);
        if (data.expiresAt) {
          console.log(`  New expiry: ${new Date(data.expiresAt as number).toISOString()}`);
        }
      }
      return;
    } catch (error: any) {
      ui.error(error?.body?.error || error?.message || 'Failed to extend lock');
      process.exit(1);
    }
  }

  if (!name) {
    console.error('Usage: port-daddy lock <name-or-path> [--ttl <ms>] [--owner <id>]');
    console.error('       port-daddy lock extend <name-or-path> [--ttl <ms>]');
    console.error('       port-daddy lock db-migrations');
    process.exit(1);
  }

  try {
    const data = await pd.lock(name, {
      owner: typeof options.owner === 'string' ? options.owner : undefined,
      ttl: options.ttl ? parseInt(options.ttl as string, 10) : 300000,
    });

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (isQuiet(options)) {
      // Silent success for scripting: port-daddy lock foo && do_stuff
    } else {
      ui.success(`Acquired lock: ${name}`);
      if (data.expiresAt) {
        const ttlSeconds: number = Math.ceil(((data.expiresAt as number) - (data.acquiredAt as number)) / 1000);
        console.log(`  TTL: ${ttlSeconds}s`);
      }
    }
  } catch (error: any) {
    const data = error?.body;
    if (data?.error === 'lock is held') {
      console.error(`Lock '${name}' is held by ${data.holder}`);
      console.error(`  Held since: ${new Date(data.heldSince as number).toISOString()}`);
      if (data.expiresAt) {
        const remaining: number = Math.max(0, (data.expiresAt as number) - Date.now());
        console.error(`  Expires in: ${Math.ceil(remaining / 1000)}s`);
      }
      process.exit(1);
    }
    ui.error(data?.error || error?.message || 'Failed to acquire lock');
    process.exit(1);
  }
}

/**
 * Handle `pd unlock <name-or-path>` command
 */
export async function handleUnlock(name: string | undefined, options: CLIOptions): Promise<void> {
  if (!name) {
    console.error('Usage: port-daddy unlock <name-or-path> [--force]');
    process.exit(1);
  }

  if (options.force === true) {
    const ok = await requireConfirmation({
      summary: `Unlock --force will release "${name}" even if you don't own it. Whoever holds it loses their guarantee of exclusive access.`,
      args: options as Record<string, unknown>,
    });
    if (!ok) process.exit(DESTRUCTIVE_EXIT_CODE);
  }

  const pd = createLockClient(options);
  // #8877: release is soul-checked against the acquiring actor; present the
  // shell's persisted credential (minting here would fail ownership anyway,
  // but a fresh shell releasing an expired/foreign lock still needs a soul).
  if (!pd.credential) {
    try {
      pd.credential = await ensureCliActorCredential(typeof options.owner === 'string' ? options.owner : undefined);
    } catch (error) {
      console.error(`ERROR: failed to mint actor credential: ${(error as Error).message}`);
      process.exit(1);
    }
  }

  try {
    const data = await pd.unlock(name, {
      owner: typeof options.owner === 'string' ? options.owner : undefined,
      force: options.force === true,
    });

    if (isJson(options)) {
      console.log(JSON.stringify(data, null, 2));
    } else if (!isQuiet(options)) {
      if (data.released) {
        ui.success(`Released lock: ${name}`);
      } else {
        ui.warn(`Lock '${name}' was not held`);
      }
    }
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to release lock');
    process.exit(1);
  }
}

/**
 * Handle `pd locks` command
 */
export async function handleLocks(options: CLIOptions): Promise<void> {
  const pd = createLockClient(options);

  let data;
  try {
    data = await pd.listLocks({
      owner: typeof options.owner === 'string' ? options.owner : undefined,
    });
  } catch (error: any) {
    ui.error(error?.body?.error || error?.message || 'Failed to list locks');
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
      console.error('Usage: port-daddy lock extend <name-or-path> [--ttl <ms>]');
      process.exit(1);
    }

    const result = lk.extend(extName, {
      ttl: extTtl ? parseInt(extTtl, 10) : 300000,
      owner: options.owner as string | undefined,
    });

    if (!result.success) {
      ui.error(result.error || 'Failed to extend lock');
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
    console.error('Usage: port-daddy lock <name-or-path> [--ttl <ms>] [--owner <id>]');
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
    ui.error(result.error || 'Failed to acquire lock');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (isQuiet(options)) {
    // Silent success for scripting
  } else {
    ui.success(`Acquired lock: ${name}`);
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
    console.error('Usage: port-daddy unlock <name-or-path> [--force]');
    process.exit(1);
  }

  const lk = getDirectLocks();
  const result = lk.release(name, {
    owner: options.owner as string | undefined,
    force: options.force === true,
  });

  if (!result.success) {
    ui.error(result.error || 'Failed to release lock');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!isQuiet(options)) {
    if (result.released) {
      ui.success(`Released lock: ${name}`);
    } else {
      ui.warn(`Lock '${name}' was not held`);
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
