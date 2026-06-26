/**
 * Forensics archive — durable retention for security events the live DB DELETES.
 *
 * Arbiter security events (PID_SQUATTING, CAP_ESCALATION, NOTE_MONOTONICITY,
 * covenant breaks, man-overboard) are recorded into `activity_log`, which
 * `lib/activity.ts` PRUNES after 7 days (LOG_RETENTION_MS) and caps at 10k rows.
 * So a security incident discovered on day 9 has zero forensic trail — the one
 * class of log the operator most cannot lose, lost by design.
 *
 * This is the security-forensics half of the loss-critical-records program
 * (after the transcript archive, ADR-0058). Same shape: an always-on, append-only,
 * fsync'd, day-partitioned JSONL journal OUTSIDE the live DB
 * (`~/.port-daddy/forensics/`), written fire-and-forget the moment a violation is
 * recorded — independent of the 7-day prune. Loud-fail on write error, because a
 * silent forensics loss is the outcome the directive forbids.
 *
 * (The transcript archive, lib/transcript-archive.ts, is the same pattern over a
 * different record. A shared append-only-JSONL primitive is a worthwhile future
 * extraction once both land on main; kept separate now to avoid cross-PR coupling.)
 */

import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** A durably-retained security event. Mirrors lib/arbiter.ts Violation + a write stamp. */
export interface ForensicsEvent {
  id?: number;
  timestamp: number;
  rule: string;
  severity: 'warning' | 'violation' | 'critical';
  details: string;
  agentId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fire-and-forget durable sink. MUST NOT throw — it reports failures loudly instead. */
export interface ForensicsSink {
  record(event: ForensicsEvent): void;
}

/** Default durable forensics dir, outside the live DB so it survives DB loss + the 7-day prune. */
export function defaultForensicsDir(): string {
  return (
    process.env.PD_FORENSICS_ARCHIVE_DIR?.trim() ||
    join(homedir(), '.port-daddy', 'forensics')
  );
}

export interface ForensicsArchiveOptions {
  dir?: string;
  now?: () => number;
  /** fsync each append (default true — security forensics wants durability over throughput). */
  fsync?: boolean;
  onError?: (message: string, err: unknown) => void;
}

function dayPartition(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

/**
 * Append-only JSONL forensics journal. One file per UTC day:
 *   <dir>/forensics-YYYY-MM-DD.jsonl
 * One JSON line per security event. Never deletes; never overwritten.
 */
export function createJsonlForensicsArchive(opts: ForensicsArchiveOptions = {}): ForensicsSink {
  const dir = opts.dir ?? defaultForensicsDir();
  const now = opts.now ?? Date.now;
  const doFsync = opts.fsync ?? true;
  const onError =
    opts.onError ??
    ((message: string, err: unknown) =>
      // Loud-fail: a forensics retention loss must be visible, never silent.
      console.error(`[forensics-archive] RETENTION FAILURE: ${message}`, err));

  let dirReady = false;
  function ensureDir(): void {
    if (dirReady) return;
    mkdirSync(dir, { recursive: true });
    dirReady = true;
  }

  return {
    record(event: ForensicsEvent): void {
      try {
        ensureDir();
        const ts = event.timestamp ?? now();
        const file = join(dir, `forensics-${dayPartition(ts)}.jsonl`);
        const line = JSON.stringify({ archived_at: now(), ...event }) + '\n';
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
        onError(`failed to record security event ${event?.rule}`, err);
      }
    },
  };
}
