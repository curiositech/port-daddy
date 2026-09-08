import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export interface WorkspaceIdentity {
  canonicalPath: string;
  device: number;
  inode: number;
}

export function captureWorkspaceIdentity(value: unknown): WorkspaceIdentity | null {
  if (typeof value !== 'string' || !isAbsolute(value)) return null;
  try {
    const canonicalPath = realpathSync(resolve(value));
    const stats = statSync(canonicalPath);
    if (!stats.isDirectory()) return null;
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) return null;
    return {
      canonicalPath,
      device: stats.dev,
      inode: stats.ino,
    };
  } catch {
    return null;
  }
}

export function sameWorkspaceIdentity(
  value: unknown,
  expected: WorkspaceIdentity,
): boolean {
  const actual = captureWorkspaceIdentity(value);
  return Boolean(
    actual
    && actual.canonicalPath === expected.canonicalPath
    && actual.device === expected.device
    && actual.inode === expected.inode,
  );
}
