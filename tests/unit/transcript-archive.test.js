// tests/unit/transcript-archive.test.js
//
// Durable transcript retention (ADR-0058): every finalized transcript becomes
// one immutable, content-addressed artifact outside the live SQLite database.

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createJsonlTranscriptArchive, defaultTranscriptArchiveDir } =
  await import('../../lib/transcript-archive.js');
const {
  describeTranscriptArchiveArtifact,
  serializeTranscriptArchiveArtifact,
} = await import('../../lib/transcripts.js');

function entry(over = {}) {
  return {
    id: 'tx-1',
    ship: 'steward',
    session_id: 's1',
    spawned_agent_id: 'agent-1',
    trigger: 'manual',
    backend: 'claude-cli',
    model: 'claude-haiku-4-5-20251001',
    status: 'completed',
    started_at: Date.parse('2026-06-15T10:00:00Z'),
    ended_at: Date.parse('2026-06-15T10:05:00Z'),
    cost_usd: 0.04,
    tokens_in: 100,
    tokens_out: 200,
    messages: [{ role: 'assistant', content: 'did the thing', timestamp: 1, tool_calls: [] }],
    outputs: [{ type: 'other', url: 'http://x/1', summary: 'opened' }],
    error: null,
    project: 'port-daddy',
    identity: 'port-daddy:fleet:steward',
    ...over,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('immutable JSONL transcript archive — durable retention', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pd-tx-archive-'));
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  test('publishes one full content-addressed artifact and returns exact evidence', () => {
    const transcript = entry();
    const result = createJsonlTranscriptArchive({ dir }).archive(transcript);
    expect(result).toEqual({
      ok: true,
      artifact: expect.objectContaining({
        locator: expect.stringMatching(/^2026-06-15[/\\]transcript-[a-f0-9]{64}\.jsonl$/),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        bytes: expect.any(Number),
        format: 'port-daddy.transcript-jsonl.v1',
      }),
    });

    const artifactPath = join(dir, result.artifact.locator);
    const bytes = readFileSync(artifactPath);
    expect(bytes.length).toBe(result.artifact.bytes);
    expect(sha256(bytes)).toBe(result.artifact.sha256);
    const retained = JSON.parse(bytes.toString('utf8'));
    expect(retained.id).toBe('tx-1');
    expect(retained.status).toBe('completed');
    expect(retained.messages[0].content).toBe('did the thing');
    expect(retained.outputs[0].url).toBe('http://x/1');
    expect(retained).not.toHaveProperty('archived_at');
  });

  test('distinct transcripts get immutable artifacts and exact retry is idempotent', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    const first = sink.archive(entry({ id: 'tx-1' }));
    const second = sink.archive(entry({ id: 'tx-2' }));
    const replay = sink.archive(entry({ id: 'tx-1' }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(readdirSync(join(dir, '2026-06-15')).sort()).toEqual(
      [first.artifact.locator, second.artifact.locator]
        .map((locator) => locator.split(/[/\\]/u).at(-1))
        .sort(),
    );
  });

  test('completes bounded partial writes before any fsync or success receipt', () => {
    let writes = 0;
    let complete = false;
    let fsyncBeforeComplete = false;
    const sink = createJsonlTranscriptArchive({
      dir,
      io: {
        writeSync(fd, buffer, offset, length, position) {
          writes += 1;
          const written = writeSync(fd, buffer, offset, Math.min(length, 7), position);
          if (offset + written === buffer.length) complete = true;
          return written;
        },
        fsyncSync() {
          if (!complete) fsyncBeforeComplete = true;
        },
      },
    });

    const result = sink.archive(entry());
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(writes).toBeGreaterThan(1);
    expect(complete).toBe(true);
    expect(fsyncBeforeComplete).toBe(false);
    expect(sha256(readFileSync(join(dir, result.artifact.locator)))).toBe(result.artifact.sha256);
  });

  test('a stalled partial write cannot fsync, publish, or produce a success receipt', () => {
    let writes = 0;
    let syncs = 0;
    const sink = createJsonlTranscriptArchive({
      dir,
      io: {
        writeSync(fd, buffer, offset, length, position) {
          writes += 1;
          if (writes > 1) return 0;
          return writeSync(fd, buffer, offset, Math.max(1, Math.floor(length / 2)), position);
        },
        fsyncSync() {
          syncs += 1;
        },
      },
      onError: () => {},
    });

    expect(sink.archive(entry())).toEqual(expect.objectContaining({ ok: false }));
    expect(writes).toBe(2);
    expect(syncs).toBe(0);
    expect(readdirSync(join(dir, '2026-06-15'))).toEqual([]);
  });

  test('an interleaved failed writer cannot delete or corrupt another writer\'s retained artifact', () => {
    const transcript = entry({ id: 'tx-concurrent' });
    const winner = createJsonlTranscriptArchive({ dir });
    let winnerResult;
    let writes = 0;
    const failingWriter = createJsonlTranscriptArchive({
      dir,
      io: {
        writeSync(fd, buffer, offset, length, position) {
          writes += 1;
          if (writes === 1) {
            const written = writeSync(fd, buffer, offset, Math.min(length, 11), position);
            winnerResult = winner.archive(transcript);
            return written;
          }
          return 0;
        },
      },
      onError: () => {},
    });

    const failed = failingWriter.archive(transcript);
    expect(failed).toEqual(expect.objectContaining({ ok: false }));
    expect(winnerResult).toEqual(expect.objectContaining({ ok: true }));

    const artifactPath = join(dir, winnerResult.artifact.locator);
    const bytes = readFileSync(artifactPath);
    expect(sha256(bytes)).toBe(winnerResult.artifact.sha256);
    expect(JSON.parse(bytes.toString('utf8')).id).toBe('tx-concurrent');
    expect(readdirSync(join(dir, '2026-06-15'))).toEqual([
      winnerResult.artifact.locator.split(/[/\\]/u).at(-1),
    ]);
  });

  test('clamps new and existing roots, partitions, and artifacts under permissive umask', () => {
    const transcript = entry();
    const bytes = serializeTranscriptArchiveArtifact(transcript);
    const metadata = describeTranscriptArchiveArtifact(
      transcript,
      join('2026-06-15', `transcript-${sha256(bytes)}.jsonl`),
    );
    const partition = join(dir, '2026-06-15');
    const file = join(dir, metadata.locator);
    mkdirSync(partition, { mode: 0o777 });
    chmodSync(dir, 0o777);
    chmodSync(partition, 0o777);
    writeFileSync(file, bytes, { mode: 0o666 });
    chmodSync(file, 0o666);

    const newDir = join(dir, 'new-archive');
    const previousUmask = process.umask(0);
    let newResult;
    try {
      expect(createJsonlTranscriptArchive({ dir }).archive(transcript))
        .toEqual({ ok: true, artifact: metadata });
      newResult = createJsonlTranscriptArchive({ dir: newDir }).archive(transcript);
      expect(newResult).toEqual(expect.objectContaining({ ok: true }));
    } finally {
      process.umask(previousUmask);
    }

    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(partition).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(newDir).mode & 0o777).toBe(0o700);
    expect(statSync(join(newDir, '2026-06-15')).mode & 0o777).toBe(0o700);
    expect(statSync(join(newDir, newResult.artifact.locator)).mode & 0o777).toBe(0o600);
  });

  test('rejects a symlink artifact without following or corrupting its victim', () => {
    const archiveDir = join(dir, 'archive');
    const partition = join(archiveDir, '2026-06-15');
    mkdirSync(partition, { recursive: true, mode: 0o700 });
    const transcript = entry();
    const digest = sha256(serializeTranscriptArchiveArtifact(transcript));
    const target = join(partition, `transcript-${digest}.jsonl`);
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'do not overwrite\n', { mode: 0o600 });
    symlinkSync(victim, target);

    const result = createJsonlTranscriptArchive({
      dir: archiveDir,
      onError: () => {},
    }).archive(transcript);

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(readFileSync(victim, 'utf8')).toBe('do not overwrite\n');
    expect(statSync(victim).mode & 0o777).toBe(0o600);
  });

  test('the archive is independent of any DB — the artifact is the retained copy', () => {
    const result = createJsonlTranscriptArchive({ dir }).archive(entry());
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, result.artifact.locator))).toHaveLength(result.artifact.bytes);
  });

  test('a write failure never throws and returns a negative receipt after loud reporting', () => {
    const errors = [];
    const badParent = join(dir, 'not-a-dir');
    writeFileSync(badParent, 'x');
    const sink = createJsonlTranscriptArchive({
      dir: join(badParent, 'sub'),
      onError: (message, error) => errors.push({ message, error }),
    });

    expect(sink.archive(entry())).toEqual(expect.objectContaining({ ok: false }));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/failed to archive transcript tx-1/);
  });

  test('partitions by UTC day', () => {
    const sink = createJsonlTranscriptArchive({ dir });
    sink.archive(entry({ id: 'a', ended_at: Date.parse('2026-06-15T23:59:00Z') }));
    sink.archive(entry({ id: 'b', ended_at: Date.parse('2026-06-16T00:01:00Z') }));
    expect(readdirSync(dir).sort()).toEqual(['2026-06-15', '2026-06-16']);
  });
});

describe('default archive dir', () => {
  test('defaults under ~/.port-daddy/transcripts and honors PD_TRANSCRIPT_ARCHIVE_DIR', () => {
    const previous = process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    delete process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    expect(defaultTranscriptArchiveDir()).toMatch(/\.port-daddy[/\\]transcripts$/);
    process.env.PD_TRANSCRIPT_ARCHIVE_DIR = '/custom/warehouse';
    expect(defaultTranscriptArchiveDir()).toBe('/custom/warehouse');
    if (previous === undefined) delete process.env.PD_TRANSCRIPT_ARCHIVE_DIR;
    else process.env.PD_TRANSCRIPT_ARCHIVE_DIR = previous;
  });
});
