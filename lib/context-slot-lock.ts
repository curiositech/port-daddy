/**
 * Kernel-held lease for one `.portdaddy/contexts/<slot>.json` authority file.
 *
 * Operator recovery and ordinary CLI context writes share the same persistent
 * lock inode. The Rust kernel owns exclusion; the open descriptor owns lease
 * lifetime, so crashes and restarts release it without PID guessing, stale-file
 * deletion, or a check-then-unlink race.
 */

import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  lstatSync,
  openSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  tryContextSlotKernelLock,
  unlockContextSlotKernelLock,
  type ContextSlotKernelLockResult,
} from './operator-presence-ffi.js';

export type ContextSlotLockCode = 'CONTEXT_SLOT_BUSY' | 'CONTEXT_SLOT_LOCK_UNSAFE';

export class ContextSlotLockError extends Error {
  constructor(public readonly code: ContextSlotLockCode, message: string) {
    super(message);
    this.name = 'ContextSlotLockError';
  }
}

export interface ContextSlotLockLease {
  readonly path: string;
  release(): void;
}

export interface ContextSlotLockKernel {
  tryLock(descriptor: number): ContextSlotKernelLockResult;
  unlock(descriptor: number): boolean;
}

const nativeKernel: ContextSlotLockKernel = {
  tryLock: tryContextSlotKernelLock,
  unlock: unlockContextSlotKernelLock,
};

let injectedTestKernel: ContextSlotLockKernel | null = null;

/** Explicit test seam. Production callers cannot select a TypeScript fallback. */
export function __setContextSlotLockKernelForTests(
  kernel: ContextSlotLockKernel | null,
): void {
  if (process.env.PD_TEST !== '1' && !process.env.JEST_WORKER_ID) {
    throw new Error('context-slot test kernel injection is test-only');
  }
  injectedTestKernel = kernel;
}

function lockKernel(): ContextSlotLockKernel {
  return injectedTestKernel ?? nativeKernel;
}

export function contextSlotLockPath(contextDir: string, contextSlot: string): string {
  return join(contextDir, `.${contextSlot}.operator-recovery.lock`);
}

function assertSafePersistentLock(lockPath: string, descriptor: number): void {
  const opened = fstatSync(descriptor);
  const named = lstatSync(lockPath);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (
    !opened.isFile()
    || !named.isFile()
    || named.isSymbolicLink()
    || opened.nlink !== 1
    || named.nlink !== 1
    || opened.dev !== named.dev
    || opened.ino !== named.ino
    || (currentUid !== null && (opened.uid !== currentUid || named.uid !== currentUid))
  ) {
    throw new ContextSlotLockError(
      'CONTEXT_SLOT_LOCK_UNSAFE',
      'the exact context slot has an unsafe persistent lock inode',
    );
  }
}

export function acquireContextSlotLock(
  lockPath: string,
  record: Record<string, unknown>,
): ContextSlotLockLease {
  let descriptor: number | null = null;
  let acquired = false;
  const kernel = lockKernel();
  try {
    descriptor = openSync(
      lockPath,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    assertSafePersistentLock(lockPath, descriptor);

    const verdict = kernel.tryLock(descriptor);
    if (verdict === 'busy') {
      throw new ContextSlotLockError(
        'CONTEXT_SLOT_BUSY',
        'the exact context slot is already held by another writer',
      );
    }
    if (verdict !== 'acquired') {
      throw new ContextSlotLockError(
        'CONTEXT_SLOT_LOCK_UNSAFE',
        'the required context-slot kernel lease is unavailable',
      );
    }
    acquired = true;

    // Recheck the path after the lease is held. Cooperating writers never
    // replace or unlink this persistent inode.
    assertSafePersistentLock(lockPath, descriptor);
    fchmodSync(descriptor, 0o600);
    ftruncateSync(descriptor, 0);
    writeFileSync(descriptor, JSON.stringify({
      ...record,
      pid: process.pid,
      lease: 'pd-anchor-flock-v1',
    }), 'utf8');
    fsyncSync(descriptor);

    let released = false;
    const heldDescriptor = descriptor;
    descriptor = null;
    return {
      path: lockPath,
      release() {
        if (released) return;
        released = true;
        try { kernel.unlock(heldDescriptor); } finally {
          try { closeSync(heldDescriptor); } catch {}
        }
      },
    };
  } catch (error) {
    if (descriptor !== null) {
      if (acquired) {
        try { kernel.unlock(descriptor); } catch {}
      }
      try { closeSync(descriptor); } catch {}
    }
    if (error instanceof ContextSlotLockError) throw error;
    throw new ContextSlotLockError(
      'CONTEXT_SLOT_LOCK_UNSAFE',
      'the exact context-slot kernel lease could not be established safely',
    );
  }
}
