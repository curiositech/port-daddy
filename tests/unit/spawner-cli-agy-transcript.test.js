/**
 * cli:agy transcript failure behavior.
 *
 * This runs through the real spawner and cli-tube backend with a fake agy
 * binary. It proves a hanging/no-output agy child becomes a terminal failed
 * transcript row with an operator-visible reason instead of lingering as
 * status=running.
 */

import { describe, test, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { createSpawner } = await import('../../lib/spawner.js');
const { createTranscripts } = await import('../../lib/transcripts.js');
const { createTestDb } = await import('../setup-unit.js');

jest.setTimeout(15_000);

const TEST_TELEMETRY_BYPASS = {
  humanConfirmed: true,
  confirmedBy: 'jest',
  reason: 'cli:agy timeout transcript behavior test with fake local binary',
};

describe('cli:agy timeout transcript behavior', () => {
  let db;
  let transcripts;
  let tempDir;
  let originalFetch;
  let originalAgyBin;
  let originalIsolationOff;
  let originalCoastGuardOff;

  beforeAll(() => {
    originalAgyBin = process.env.PD_CLI_AGY_BIN;
    originalIsolationOff = process.env.PD_SPAWN_ISOLATION_OFF;
    originalCoastGuardOff = process.env.PD_COAST_GUARD_OFF;
    process.env.PD_SPAWN_ISOLATION_OFF = '1';
    process.env.PD_COAST_GUARD_OFF = '1';
  });

  afterAll(() => {
    restoreEnv('PD_CLI_AGY_BIN', originalAgyBin);
    restoreEnv('PD_SPAWN_ISOLATION_OFF', originalIsolationOff);
    restoreEnv('PD_COAST_GUARD_OFF', originalCoastGuardOff);
  });

  beforeEach(() => {
    db = createTestDb();
    transcripts = createTranscripts(db);
    tempDir = mkdtempSync(join(tmpdir(), 'pd-fake-agy-'));
    process.env.PD_CLI_AGY_BIN = installFakeAgy(tempDir);
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
      text: async () => 'OK',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (db) db.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  test('hanging no-output agy child finalizes transcript as failed', async () => {
    const spawner = createSpawner({
      transcripts,
      enforceTelemetryPolicy: false,
      enforceTranscriptPolicy: true,
      telemetryBypassApproval: TEST_TELEMETRY_BYPASS,
    });

    const result = await spawner.spawn({
      backend: 'cli:agy',
      task: 'Reply with exactly: agy',
      timeout: 25,
      ship: 'spawn:cli:agy',
      trigger: 'manual',
      coastGuard: false,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toContain('agy timed out after 25ms');
    expect(result.completedAt).not.toBeNull();

    const rows = transcripts.listTranscripts({ ship: 'spawn:cli:agy' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error).toContain('agy timed out after 25ms');
    expect(rows[0].ended_at).toBeTruthy();

    const tx = transcripts.getTranscript(rows[0].id);
    expect(tx.status).toBe('failed');
    expect(tx.error).toContain('agy timed out after 25ms');
    expect(tx.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(tx.messages[1].content).toContain('[error] agy timed out after 25ms');
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].type).toBe('noop');
    expect(tx.outputs[0].summary).toContain('failed: agy timed out after 25ms');
  });
});

function installFakeAgy(dir) {
  const file = join(dir, 'agy');
  writeFileSync(file, '#!/bin/sh\ntrap "" TERM\nsleep 30\n');
  chmodSync(file, 0o755);
  return file;
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
