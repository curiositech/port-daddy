/**
 * FileBackend — the file:// backup backend.
 *
 * Layout under the root directory:
 *
 *   <root>/
 *     <snapshot-id>/
 *       manifest.json
 *       port-registry.db.gz
 *
 * `put()` writes to `<snapshot-id>.partial/` and renames the directory
 * into place to guarantee atomicity at the listing level (a half-written
 * snapshot never appears in `list()`).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { BackupBackend, Manifest, SnapshotSummary } from './types.js';

export const DEFAULT_FILE_BACKEND_ROOT = join(homedir(), '.port-daddy', 'backups');

const MANIFEST_FILE = 'manifest.json';
const DB_FILE = 'port-registry.db.gz';

export function resolveFileBackendRoot(uri?: string): string {
  if (!uri || uri === 'file://') return DEFAULT_FILE_BACKEND_ROOT;
  if (uri.startsWith('file://')) {
    const path = uri.slice('file://'.length);
    return resolve(path.startsWith('~') ? join(homedir(), path.slice(1)) : path);
  }
  return resolve(uri);
}

export function createFileBackend(uri: string = `file://${DEFAULT_FILE_BACKEND_ROOT}`): BackupBackend {
  const root = resolveFileBackendRoot(uri);

  function ensureRoot(): void {
    if (!existsSync(root)) mkdirSync(root, { recursive: true, mode: 0o700 });
  }

  async function put(snapshotId: string, manifest: Manifest, dbBytes: Buffer): Promise<void> {
    ensureRoot();
    const partial = join(root, `${snapshotId}.partial`);
    const final = join(root, snapshotId);
    if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true, mode: 0o700 });
    writeFileSync(join(partial, MANIFEST_FILE), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    writeFileSync(join(partial, DB_FILE), dbBytes, { mode: 0o600 });
    if (existsSync(final)) rmSync(final, { recursive: true, force: true });
    renameSync(partial, final);
  }

  async function get(snapshotId: string): Promise<{ manifest: Manifest; dbBytes: Buffer }> {
    const dir = join(root, snapshotId);
    const manifestPath = join(dir, MANIFEST_FILE);
    const dbPath = join(dir, DB_FILE);
    if (!existsSync(manifestPath) || !existsSync(dbPath)) {
      throw new Error(`snapshot not found: ${snapshotId} at ${dir}`);
    }
    let manifest: Manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    } catch (err) {
      throw new Error(`manifest corrupt for ${snapshotId}: ${(err as Error).message}`);
    }
    const dbBytes = readFileSync(dbPath);
    return { manifest, dbBytes };
  }

  async function list(): Promise<SnapshotSummary[]> {
    if (!existsSync(root)) return [];
    const out: SnapshotSummary[] = [];
    for (const entry of readdirSync(root)) {
      if (entry.endsWith('.partial')) continue;
      const manifestPath = join(root, entry, MANIFEST_FILE);
      if (!existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
        out.push({
          snapshotId: m.snapshotId,
          createdAt: m.createdAt,
          dbBytesCompressed: m.dbBytesCompressed,
          encryption: { scheme: m.encryption.scheme },
        });
      } catch {
        // skip unreadable / corrupt manifests rather than crashing list()
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  async function deleteSnapshot(snapshotId: string): Promise<void> {
    const dir = join(root, snapshotId);
    if (!existsSync(dir)) return;
    const st = statSync(dir);
    if (!st.isDirectory()) return;
    rmSync(dir, { recursive: true, force: true });
  }

  return {
    uri: `file://${root}`,
    put,
    get,
    list,
    delete: deleteSnapshot,
  };
}
