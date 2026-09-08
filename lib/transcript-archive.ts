/**
 * Durable transcript archive — the retention floor.
 *
 * Every finalized transcript is retained outside the live SQLite database as
 * one immutable, day-partitioned JSONL artifact. Writers never append to a
 * shared file: each attempt writes a private unique temp, fsyncs only after the
 * complete byte sequence is present, then atomically publishes a deterministic
 * content-addressed target. A failed or concurrent writer can remove only its
 * own unpublished temp and can never truncate another retained transcript.
 *
 * Successful receipts name and hash the exact artifact. The same sink interface
 * remains the on-ramp to an approved external warehouse.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync as nodeFsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync as nodeWriteSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, relative, resolve, sep } from 'node:path';
import {
  TRANSCRIPT_ARCHIVE_ARTIFACT_FORMAT,
  serializeTranscriptArchiveArtifact,
} from './transcripts.js';
import type {
  TranscriptArchiveArtifact,
  TranscriptArchiveSink,
  TranscriptEntry,
} from './transcripts.js';

/** Default durable archive dir, outside the live DB so it survives DB loss. */
export function defaultTranscriptArchiveDir(): string {
  return (
    process.env.PD_TRANSCRIPT_ARCHIVE_DIR?.trim()
    || join(homedir(), '.port-daddy', 'transcripts')
  );
}

export interface JsonlArchiveOptions {
  /** Archive directory. Defaults to defaultTranscriptArchiveDir(). */
  dir?: string;
  /** Date.now injector used only when a transcript has no lifecycle timestamp. */
  now?: () => number;
  /** Sink for failure reporting (tests); defaults to console.error. */
  onError?: (message: string, err: unknown) => void;
  /** Narrow I/O seam for adversarial partial-write, fsync, and concurrency tests. */
  io?: {
    writeSync?: (
      fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ) => number;
    fsyncSync?: (fd: number) => void;
  };
}

function dayPartition(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function optionalFlag(name: 'O_CLOEXEC' | 'O_DIRECTORY' | 'O_NOFOLLOW' | 'O_NONBLOCK'): number {
  const value = (constants as unknown as Record<string, unknown>)[name];
  return typeof value === 'number' ? value : 0;
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertCurrentUserOwner(stats: Stats, label: string): void {
  if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
    throw new Error(`${label} is not owned by the daemon user`);
  }
}

function assertPrivateDirectory(stats: Stats, label: string): void {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} is not a safe archive directory`);
  }
  assertCurrentUserOwner(stats, label);
}

function assertPrivateFile(stats: Stats, label: string): void {
  if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink !== 1) {
    throw new Error(`${label} is not a safe archive file`);
  }
  assertCurrentUserOwner(stats, label);
}

function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Reject every static symlink/non-directory component from the filesystem root
 * to the requested directory. This anchors lexical containment for configured
 * roots without pretending that name-based Node APIs close a concurrent
 * ancestor rename/symlink race; that stronger boundary still needs dirfd/openat.
 *
 * Design rationale: validating only the final path would let a static ancestor
 * symlink redirect publication outside the approved archive root.
 *
 * @param path Absolute archive root or partition path to validate.
 * @param label Human-readable path role used in fail-closed errors.
 */
function assertAnchoredDirectoryChain(path: string, label: string): void {
  const absolute = resolve(path);
  const anchor = parse(absolute).root;
  const anchorStats = lstatSync(anchor);
  if (anchorStats.isSymbolicLink() || !anchorStats.isDirectory()) {
    throw new Error(`${label} filesystem anchor is not a safe directory`);
  }

  let current = anchor;
  const suffix = relative(anchor, absolute);
  for (const component of suffix.split(sep).filter(Boolean)) {
    current = join(current, component);
    const stats = lstatIfPresent(current);
    if (!stats) break;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label} contains an unsafe ancestor: ${current}`);
    }
  }
}

function assertPathIdentity(path: string, expected: Stats, label: string): void {
  const current = lstatSync(path);
  assertPrivateDirectory(current, label);
  if (!sameIdentity(current, expected)) {
    throw new Error(`${label} changed during archive publication`);
  }
}

function openPrivateDirectory(
  path: string,
  label: string,
  create: 'recursive' | 'single',
): { fd: number; identity: Stats } {
  assertAnchoredDirectoryChain(path, label);
  if (create === 'recursive') {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  } else {
    try {
      mkdirSync(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  assertAnchoredDirectoryChain(path, label);

  const before = lstatSync(path);
  assertPrivateDirectory(before, label);
  const fd = openSync(
    path,
    constants.O_RDONLY
      | optionalFlag('O_CLOEXEC')
      | optionalFlag('O_DIRECTORY')
      | optionalFlag('O_NOFOLLOW')
      | optionalFlag('O_NONBLOCK'),
  );
  try {
    const opened = fstatSync(fd);
    assertPrivateDirectory(opened, `opened ${label}`);
    if (!sameIdentity(before, opened)) {
      throw new Error(`${label} changed while opening`);
    }
    fchmodSync(fd, 0o700);
    const secured = fstatSync(fd);
    if ((secured.mode & 0o777) !== 0o700) {
      throw new Error(`${label} permissions are not private`);
    }
    assertPathIdentity(path, opened, label);
    return { fd, identity: opened };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function writeCompleteArtifact(
  fd: number,
  bytes: Buffer,
  write: NonNullable<NonNullable<JsonlArchiveOptions['io']>['writeSync']>,
): void {
  let offset = 0;
  while (offset < bytes.length) {
    const remaining = bytes.length - offset;
    const written = write(fd, bytes, offset, remaining, null);
    if (!Number.isSafeInteger(written) || written <= 0 || written > remaining) {
      throw new Error(
        `transcript archive write made invalid progress (${written}/${remaining} bytes)`,
      );
    }
    offset += written;
  }
}

function openPrivateTemp(
  path: string,
  partitionPath: string,
  partitionIdentity: Stats,
): { fd: number; identity: Stats } {
  assertPathIdentity(partitionPath, partitionIdentity, 'transcript archive partition');
  const fd = openSync(
    path,
    constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | optionalFlag('O_CLOEXEC')
      | optionalFlag('O_NOFOLLOW')
      | optionalFlag('O_NONBLOCK'),
    0o600,
  );
  try {
    const opened = fstatSync(fd);
    assertPrivateFile(opened, 'opened transcript archive temp');
    fchmodSync(fd, 0o600);
    const secured = fstatSync(fd);
    if ((secured.mode & 0o777) !== 0o600) {
      throw new Error('transcript archive temp permissions are not private');
    }
    const named = lstatSync(path);
    assertPrivateFile(named, 'transcript archive temp');
    if (!sameIdentity(opened, named)) {
      throw new Error('transcript archive temp changed while opening');
    }
    assertPathIdentity(partitionPath, partitionIdentity, 'transcript archive partition');
    return { fd, identity: opened };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function verifyPrivateArtifact(
  path: string,
  expectedBytes: Buffer,
  sync: NonNullable<NonNullable<JsonlArchiveOptions['io']>['fsyncSync']>,
): void {
  const before = lstatSync(path);
  assertPrivateFile(before, 'transcript archive artifact');
  const fd = openSync(
    path,
    constants.O_RDONLY
      | optionalFlag('O_CLOEXEC')
      | optionalFlag('O_NOFOLLOW')
      | optionalFlag('O_NONBLOCK'),
  );
  try {
    const opened = fstatSync(fd);
    assertPrivateFile(opened, 'opened transcript archive artifact');
    if (!sameIdentity(before, opened)) {
      throw new Error('transcript archive artifact changed while opening');
    }
    fchmodSync(fd, 0o600);
    const secured = fstatSync(fd);
    if ((secured.mode & 0o777) !== 0o600) {
      throw new Error('transcript archive artifact permissions are not private');
    }
    if (secured.size !== expectedBytes.length) {
      throw new Error('transcript archive artifact length does not match its receipt');
    }
    const actual = readFileSync(fd);
    if (!actual.equals(expectedBytes)) {
      throw new Error('transcript archive artifact digest does not match its receipt');
    }
    const after = lstatSync(path);
    assertPrivateFile(after, 'transcript archive artifact');
    if (!sameIdentity(opened, after)) {
      throw new Error('transcript archive artifact changed during verification');
    }
    sync(fd);
  } finally {
    closeSync(fd);
  }
}

function unlinkOwnedTemp(
  path: string,
  identity: Stats,
  partitionPath: string,
  partitionIdentity: Stats,
): void {
  try {
    assertPathIdentity(partitionPath, partitionIdentity, 'transcript archive partition');
    const named = lstatIfPresent(path);
    if (!named || !sameIdentity(named, identity)) return;
    assertPrivateFile(named, 'transcript archive temp');
    unlinkSync(path);
  } catch {
    // Never risk unlinking through a changed parent/name. A private orphan temp
    // is safer than deleting an object whose identity can no longer be proven.
  }
}

/**
 * Immutable JSONL archive. One private directory per UTC day and one
 * content-addressed, one-record artifact per finalized transcript:
 *
 *   <dir>/YYYY-MM-DD/transcript-<sha256>.jsonl
 */
export function createJsonlTranscriptArchive(
  opts: JsonlArchiveOptions = {},
): TranscriptArchiveSink {
  const dir = resolve(opts.dir ?? defaultTranscriptArchiveDir());
  if (dir === parse(dir).root) {
    throw new Error('transcript archive directory cannot be a filesystem root');
  }

  const now = opts.now ?? Date.now;
  const write = opts.io?.writeSync ?? nodeWriteSync;
  const sync = opts.io?.fsyncSync ?? nodeFsyncSync;
  const onError = opts.onError ?? ((message: string, err: unknown) => {
    console.error(`[transcript-archive] RETENTION FAILURE: ${message}`, err);
  });

  return {
    archive(entry: TranscriptEntry) {
      let rootFd: number | null = null;
      let partitionFd: number | null = null;
      let tempFd: number | null = null;
      let tempPath: string | null = null;
      let tempIdentity: Stats | null = null;
      let cleanupPartitionPath: string | null = null;
      let cleanupPartitionIdentity: Stats | null = null;

      try {
        const bytes = serializeTranscriptArchiveArtifact(entry);
        const digest = createHash('sha256').update(bytes).digest('hex');
        const ts = entry.ended_at ?? entry.started_at ?? now();
        const partitionName = dayPartition(ts);
        const partitionPath = join(dir, partitionName);
        const artifactName = `transcript-${digest}.jsonl`;
        const artifactPath = join(partitionPath, artifactName);
        const artifact: TranscriptArchiveArtifact = {
          locator: join(partitionName, artifactName),
          sha256: digest,
          bytes: bytes.length,
          format: TRANSCRIPT_ARCHIVE_ARTIFACT_FORMAT,
        };

        const root = openPrivateDirectory(dir, 'transcript archive directory', 'recursive');
        rootFd = root.fd;
        assertPathIdentity(dir, root.identity, 'transcript archive directory');

        const partition = openPrivateDirectory(
          partitionPath,
          'transcript archive partition',
          'single',
        );
        partitionFd = partition.fd;
        cleanupPartitionPath = partitionPath;
        cleanupPartitionIdentity = partition.identity;
        assertPathIdentity(dir, root.identity, 'transcript archive directory');
        assertPathIdentity(partitionPath, partition.identity, 'transcript archive partition');

        const existing = lstatIfPresent(artifactPath);
        if (existing) {
          // Never overwrite or follow a pre-planted symlink/unsafe target. An
          // exact immutable artifact is the only idempotent success case.
          assertPrivateFile(existing, 'transcript archive artifact');
          verifyPrivateArtifact(artifactPath, bytes, sync);
          assertPathIdentity(partitionPath, partition.identity, 'transcript archive partition');
          sync(partitionFd);
          sync(rootFd);
          return { ok: true, artifact } as const;
        }

        tempPath = join(
          partitionPath,
          `.${artifactName}.${process.pid}.${randomBytes(16).toString('hex')}.tmp`,
        );
        const temp = openPrivateTemp(tempPath, partitionPath, partition.identity);
        tempFd = temp.fd;
        tempIdentity = temp.identity;
        writeCompleteArtifact(tempFd, bytes, write);
        // A success path cannot pass this point until every artifact byte exists.
        sync(tempFd);
        closeSync(tempFd);
        tempFd = null;

        assertPathIdentity(dir, root.identity, 'transcript archive directory');
        assertPathIdentity(partitionPath, partition.identity, 'transcript archive partition');

        const racedArtifact = lstatIfPresent(artifactPath);
        if (racedArtifact) {
          // Another writer won. Accept only its byte-identical durable artifact;
          // this writer then removes only its own private temp.
          assertPrivateFile(racedArtifact, 'transcript archive artifact');
          verifyPrivateArtifact(artifactPath, bytes, sync);
          unlinkOwnedTemp(tempPath, tempIdentity, partitionPath, partition.identity);
          tempPath = null;
          tempIdentity = null;
          sync(partitionFd);
          sync(rootFd);
          return { ok: true, artifact } as const;
        }

        // rename(2) atomically publishes the complete temp. If a final symlink
        // appears after the precheck, rename replaces that directory entry and
        // never follows it. Final directory/file identities are rechecked; the
        // documented name-based ancestor race remains until dirfd/openat exists.
        renameSync(tempPath, artifactPath);
        tempPath = null;
        tempIdentity = null;

        assertPathIdentity(dir, root.identity, 'transcript archive directory');
        assertPathIdentity(partitionPath, partition.identity, 'transcript archive partition');
        verifyPrivateArtifact(artifactPath, bytes, sync);
        // Persist both the partition entry and a newly created partition name.
        sync(partitionFd);
        sync(rootFd);
        return { ok: true, artifact } as const;
      } catch (err) {
        try {
          onError(`failed to archive transcript ${entry?.id}`, err);
        } catch {
          // Failure reporting cannot convert a negative retention receipt into a throw.
        }
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        } as const;
      } finally {
        if (tempFd !== null) {
          try { closeSync(tempFd); } catch { /* negative receipts must not throw */ }
        }
        if (tempPath && tempIdentity && cleanupPartitionPath && cleanupPartitionIdentity) {
          // A failed writer never truncates or removes the shared final artifact.
          unlinkOwnedTemp(
            tempPath,
            tempIdentity,
            cleanupPartitionPath,
            cleanupPartitionIdentity,
          );
        }
        if (partitionFd !== null) {
          try { closeSync(partitionFd); } catch { /* negative receipts must not throw */ }
        }
        if (rootFd !== null) {
          try { closeSync(rootFd); } catch { /* negative receipts must not throw */ }
        }
      }
    },
  };
}
