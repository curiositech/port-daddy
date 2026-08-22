import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

function parsePid(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return Number.isSafeInteger(pid) ? pid : null;
}

/** Read the daemon generation that has completed its service boot gate. */
export function readDaemonReadyPid(path: string): number | null {
  try {
    return parsePid(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomically publish a private readiness lease for the current daemon generation. */
export function publishDaemonReady(path: string, pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid daemon readiness PID: ${pid}`);
  }

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Clear readiness. With an expected PID, never remove another generation's
 * lease; this is the normal shutdown path for a daemon being displaced.
 */
export function clearDaemonReady(path: string, expectedPid?: number): boolean {
  if (!existsSync(path)) return false;
  if (expectedPid !== undefined) {
    // Rename first so the comparison and deletion apply to one immutable file
    // generation. If it belongs to a successor, restore it; a hook may observe
    // a brief safe no-op window, but the old daemon cannot erase the new lease.
    const claimed = `${path}.clear.${expectedPid}.${process.pid}.${Date.now()}`;
    try {
      renameSync(path, claimed);
    } catch {
      return false;
    }
    if (readDaemonReadyPid(claimed) === expectedPid) {
      try {
        rmSync(claimed, { force: true });
        return true;
      } catch {
        return false;
      }
    }
    try {
      if (existsSync(path)) {
        rmSync(claimed, { force: true });
      } else {
        renameSync(claimed, path);
      }
    } catch {
      // A concurrent publisher won the path. Never remove that current lease;
      // only discard this displaced claim if it still exists.
      if (existsSync(path)) {
        try { rmSync(claimed, { force: true }); } catch {}
      }
    }
    return false;
  }
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}
