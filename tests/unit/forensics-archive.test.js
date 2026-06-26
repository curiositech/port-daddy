// tests/unit/forensics-archive.test.js
//
// Durable security-forensics retention (ADR-0089): every Arbiter violation is
// written to an append-only JSONL journal OUTSIDE the live DB, so it survives the
// 7-day activity_log prune. Pure-fs tests — no DB needed.

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createJsonlForensicsArchive, defaultForensicsDir } =
  await import('../../lib/forensics-archive.js');

function violation(over = {}) {
  return {
    id: 1,
    timestamp: Date.parse('2026-06-17T10:00:00Z'),
    rule: 'PID_SQUATTING',
    severity: 'critical',
    details: 'PID 9999 impersonating agent-1 (expected 1234)',
    agentId: 'agent-1',
    metadata: { pid: 9999, expectedPid: 1234 },
    ...over,
  };
}

describe('jsonl forensics archive — durable security retention', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pd-forensics-')); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ } });

  test('records a security event, in full, as one JSONL line in a day-partitioned file', () => {
    const sink = createJsonlForensicsArchive({ dir });
    sink.record(violation());

    expect(readdirSync(dir)).toContain('forensics-2026-06-17.jsonl');
    const lines = readFileSync(join(dir, 'forensics-2026-06-17.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.rule).toBe('PID_SQUATTING');
    expect(rec.severity).toBe('critical');
    expect(rec.metadata.pid).toBe(9999);
    expect(typeof rec.archived_at).toBe('number');
  });

  test('append-only: multiple violations accumulate, never overwrite', () => {
    const sink = createJsonlForensicsArchive({ dir });
    sink.record(violation({ id: 1, rule: 'PID_SQUATTING' }));
    sink.record(violation({ id: 2, rule: 'CAP_ESCALATION', severity: 'critical' }));
    const lines = readFileSync(join(dir, 'forensics-2026-06-17.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).rule)).toEqual(['PID_SQUATTING', 'CAP_ESCALATION']);
  });

  test('independent of the live DB — the JSONL line IS the retained copy, survives the prune', () => {
    const sink = createJsonlForensicsArchive({ dir });
    sink.record(violation());
    // No DB involved; the file persists regardless of activity_log's 7-day cleanup.
    expect(readdirSync(dir).length).toBe(1);
  });

  test('fire-and-forget: a write failure NEVER throws, but IS reported loudly', () => {
    const errors = [];
    const badParent = join(dir, 'not-a-dir');
    writeFileSync(badParent, 'x'); // a file where a dir is needed
    const sink = createJsonlForensicsArchive({
      dir: join(badParent, 'sub'),
      onError: (msg, err) => errors.push({ msg, err }),
    });
    expect(() => sink.record(violation())).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(errors[0].msg).toMatch(/failed to record security event PID_SQUATTING/);
  });

  test('partitions by UTC day', () => {
    const sink = createJsonlForensicsArchive({ dir });
    sink.record(violation({ id: 1, timestamp: Date.parse('2026-06-17T23:59:00Z') }));
    sink.record(violation({ id: 2, timestamp: Date.parse('2026-06-18T00:01:00Z') }));
    expect(readdirSync(dir).sort()).toEqual(['forensics-2026-06-17.jsonl', 'forensics-2026-06-18.jsonl']);
  });

  test('default dir is under ~/.port-daddy/forensics and honors PD_FORENSICS_ARCHIVE_DIR', () => {
    const prev = process.env.PD_FORENSICS_ARCHIVE_DIR;
    delete process.env.PD_FORENSICS_ARCHIVE_DIR;
    expect(defaultForensicsDir()).toMatch(/\.port-daddy[/\\]forensics$/);
    process.env.PD_FORENSICS_ARCHIVE_DIR = '/custom/forensics';
    expect(defaultForensicsDir()).toBe('/custom/forensics');
    if (prev === undefined) delete process.env.PD_FORENSICS_ARCHIVE_DIR;
    else process.env.PD_FORENSICS_ARCHIVE_DIR = prev;
  });
});
