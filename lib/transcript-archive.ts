/**
 * Durable transcript archive — the retention floor.
 *
 * Operator directive (2026-06-15): "ALL Port Daddy agent transcripts MUST be
 * logged to a data-warehousing solution and retained — it's OK if not the live
 * SQL table, but WE MUST RETAIN."
 *
 * Today every agent transcript lives ONLY in the live daemon SQLite DB
 * (`fleet_transcripts*`). Backups are opt-in. If that DB is deleted, corrupted, or
 * reset, every transcript is gone. This module closes that hole: an always-on,
 * append-only JSONL archive OUTSIDE the live DB. Each finalized transcript is
 * written, in full (header + messages + outputs), as one fsync'd line to a
 * day-partitioned file under `~/.port-daddy/transcripts/`. It is the durable
 * source of truth that survives any DB loss, and the on-ramp to an external
 * warehouse (S3/R2/BigQuery) — those plug in behind the same `TranscriptArchiveSink`
 * interface.
 *
 * The hot path (lib/transcripts.ts finalize/recordTranscript) calls the sink
 * fire-and-forget: a sink failure NEVER blocks a spawn, but it IS logged loudly,
 * because a silent retention failure is the one outcome the directive forbids.
 */

import { appendFileSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TranscriptArchiveSink, TranscriptEntry } from './transcripts.js';

/** Default durable archive dir, outside the live DB so it survives DB loss. */
export function defaultTranscriptArchiveDir(): string {
  return (
    process.env.PD_TRANSCRIPT_ARCHIVE_DIR?.trim() ||
    join(homedir(), '.port-daddy', 'transcripts')
  );
}

export interface JsonlArchiveOptions {
  /** Archive directory. Defaults to defaultTranscriptArchiveDir(). */
  dir?: string;
  /** Date.now injector (tests). */
  now?: () => number;
  /**
   * fsync each append so a crash can't lose the just-written line. Default true —
   * "MUST RETAIN" wants durability over throughput, and finalize fires once per run.
   */
  fsync?: boolean;
  /** Sink for failure reporting (tests); defaults to console.error. */
  onError?: (message: string, err: unknown) => void;
}

function dayPartition(ms: number): string {
  // UTC YYYY-MM-DD — stable, sortable, timezone-independent partitions.
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Append-only JSONL archive. One file per UTC day:
 *   <dir>/transcripts-YYYY-MM-DD.jsonl
 * One JSON line per finalized transcript (the full TranscriptEntry).
 */
export function createJsonlTranscriptArchive(
  opts: JsonlArchiveOptions = {},
): TranscriptArchiveSink {
  const dir = opts.dir ?? defaultTranscriptArchiveDir();
  const now = opts.now ?? Date.now;
  const doFsync = opts.fsync ?? true;
  const onError =
    opts.onError ??
    ((message: string, err: unknown) =>
      // Loud-fail on the failure path: retention loss must be visible.
      console.error(`[transcript-archive] RETENTION FAILURE: ${message}`, err));

  let dirReady = false;
  function ensureDir(): void {
    if (dirReady) return;
    mkdirSync(dir, { recursive: true });
    dirReady = true;
  }

  return {
    archive(entry: TranscriptEntry): void {
      try {
        ensureDir();
        // Partition by run end (or start, or now) — whichever timestamp we have.
        const ts = entry.ended_at ?? entry.started_at ?? now();
        const file = join(dir, `transcripts-${dayPartition(ts)}.jsonl`);
        const line = JSON.stringify({ archived_at: now(), ...entry }) + '\n';
        if (doFsync) {
          const fd = openSync(file, 'a');
          try {
            writeSync(fd, line);
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
        } else {
          appendFileSync(file, line);
        }
      } catch (err) {
        onError(`failed to archive transcript ${entry?.id}`, err);
      }
    },
  };
}

/**
 * Backfill: archive every transcript currently in the DB, so retention covers
 * history, not just runs from now on ("log ALL transcripts"). Idempotent at the
 * archive level only by append — callers run it once after first enabling the
 * archive. Returns the count archived.
 */
export function backfillTranscriptArchive(
  listTranscripts: () => TranscriptEntry[],
  getTranscript: (id: string) => TranscriptEntry | null,
  sink: TranscriptArchiveSink,
): { archived: number } {
  let archived = 0;
  for (const header of listTranscripts()) {
    // listTranscripts may return headers without messages/outputs — re-hydrate.
    const full = getTranscript(header.id) ?? header;
    sink.archive(full);
    archived += 1;
  }
  return { archived };
}
