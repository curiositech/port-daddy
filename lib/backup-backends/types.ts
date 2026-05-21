/**
 * Backup backend interface — see docs/adr/0037-pd-backup-durable-snapshots.md.
 *
 * A backend is anything that can store a (manifest, db-bytes) pair under a
 * stable snapshot ID. PR-α ships the file:// backend; s3:// and gs:// land
 * in PR-γ against this same interface.
 */

export type EncryptionScheme = 'none' | 'age';

export interface Manifest {
  snapshotId: string;
  createdAt: number;
  pdVersion: string;
  schemaVersion: number | null;
  dbBytesUncompressed: number;
  dbBytesCompressed: number;
  sha256Uncompressed: string;
  sha256Compressed: string;
  encryption: { scheme: EncryptionScheme; recipient?: string | null };
  sourceHost: string;
  sourcePath: string;
  agentId: string | null;
  sessionId: string | null;
}

export interface SnapshotSummary {
  snapshotId: string;
  createdAt: number;
  dbBytesCompressed: number;
  encryption: { scheme: EncryptionScheme };
}

export interface BackupBackend {
  /** URI form, used in operator output and logs. */
  uri: string;
  /** Persist a snapshot. Must be atomic at the snapshot level (no half-written rows in list()). */
  put(snapshotId: string, manifest: Manifest, dbBytes: Buffer): Promise<void>;
  /** Read a snapshot back. Throws if the snapshot is missing or the manifest is corrupt. */
  get(snapshotId: string): Promise<{ manifest: Manifest; dbBytes: Buffer }>;
  /** Newest-first list of snapshots known to this backend. */
  list(): Promise<SnapshotSummary[]>;
  /** Idempotent: deleting a missing snapshot resolves without error. */
  delete(snapshotId: string): Promise<void>;
}

/**
 * GFS retention. `keep` is an extra always-on floor: regardless of the
 * GFS buckets, the N most recent snapshots are never pruned. Set any
 * bucket to 0 to opt out; omit to use defaults.
 */
export interface RetentionSpec {
  daily?: number;
  weekly?: number;
  monthly?: number;
  keep?: number;
}

export const DEFAULT_RETENTION: Required<RetentionSpec> = {
  daily: 7,
  weekly: 4,
  monthly: 12,
  keep: 3,
};
