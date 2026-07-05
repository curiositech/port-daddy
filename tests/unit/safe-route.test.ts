/**
 * A9/A10 daemon-route smoke for GET /safe/scan (ADR-0088 Phase A). This is the
 * surface the MCP `safe_scan` tool proxies to — the tool is a thin
 * `GET('/safe/scan')` in mcp/server.ts, so verifying the route's contract here
 * verifies the MCP tool's contract too (the proxy adds no transform; asserting
 * the route boundary is sufficient — see the MCP-PROXY note on the no-leak test).
 *
 * ── Why this file is `.ts`, not `.js` ───────────────────────────────────────
 * The jest `unit` project transform only matches `^.+\.tsx?$`. A `.js` test
 * still matches `testMatch` but is loaded UNTRANSFORMED — its ESM `import`s
 * throw "Cannot use import statement outside a module", the suite errors, and
 * jest reports `Tests: 0 total`. That looked GREEN-ish in a full run while the
 * route + MCP proxy were in fact UNTESTED. Renaming to `.ts` is the fix.
 *
 * ── Why we mock instead of running the real sensors ─────────────────────────
 * `runSafeScan` shells the read-only sensors A1–A7 (`ps`, `codesign`, `nettop`,
 * `lsof`) and reads operator dotfiles under $HOME. Run for real, this hangs the
 * suite for minutes and is non-hermetic (depends on the host's processes/files).
 *
 * The seam: the leaf sensors were built "pure over injectable runners/fs", and
 * `lib/safe/scan.ts`'s own process enumeration shells via `node:child_process`.
 * So we mock at TWO points and leave the interesting code REAL:
 *   1. `node:child_process` → `execFileSync`/`spawnSync` are inert (return
 *      empty/throw ENOENT-shaped), which neutralizes EVERY spawn path at once:
 *      `scan.ts`'s `ps` enumeration, `binary-trust`'s `codesign`, and
 *      `egress-snapshot`'s `nettop`/`lsof`. No real process is ever spawned.
 *   2. the fs-reading sensors (`secret-scanner`, `baseline`, `perms-audit`,
 *      `mcp-inventory`) → return controlled, hermetic data so the report is
 *      deterministic and reads no operator dotfiles.
 *
 * Left REAL (this is what the test actually covers): `routes/safe.ts` (the
 * handler, the query parse, the ledger register/degrade branch, the
 * success/500 envelope), `lib/safe/scan.ts` (the A1–A8 orchestration), the
 * `lib/safe/posture-report.ts` scorer (real score/state/blast-radius), and
 * `lib/safe/trust-ledger.ts` (the A5 schema boot over a real :memory: db).
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import Fastify from 'fastify';
import type { SecretFinding } from '../../lib/safe/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks — registered BEFORE the subject (routes/safe.ts) is imported.
// ─────────────────────────────────────────────────────────────────────────────

// (1) Kill every real spawn. `realRunner`/`realTrustRunner`/egress all reach
// for these two functions; making them inert guarantees NO ps/codesign/nettop/
// lsof process is ever started. `null`/ENOENT is the sensors' "couldn't run"
// signal, which they each degrade to an empty result on.
const mockExecFileSync = jest.fn((_cmd: string, _args?: readonly string[]) => {
  const err = new Error('ENOENT: mocked — no real spawn in tests') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  throw err;
});
const mockSpawnSync = jest.fn((_cmd: string, _args?: readonly string[]) => ({
  status: null as number | null,
  stdout: '',
  stderr: '',
  error: Object.assign(new Error('ENOENT: mocked'), { code: 'ENOENT' }),
}));
jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  spawnSync: mockSpawnSync,
}));

// (2) Hermetic fs-reading sensors. Each returns the module-level fixture below
// so a single test can drive a specific finding through the REAL scorer.

/** Drives A1 (secret scan). Mutated per-test; reset in beforeEach. */
let secretFindings: SecretFinding[] = [];

jest.unstable_mockModule('../../lib/safe/secret-scanner.js', () => ({
  scanHost: jest.fn(() => ({ findings: secretFindings, scannedPaths: [] })),
}));

jest.unstable_mockModule('../../lib/safe/baseline.js', () => ({
  // Empty baseline; applyBaseline is re-implemented inertly so nothing is
  // suppressed — every finding flows through to the report (worst case for the
  // no-leak assertion: a finding IS present in the payload).
  loadBaseline: jest.fn(() => ({ version: 1, generatedAt: '1970-01-01T00:00:00.000Z', entries: [] })),
  applyBaseline: jest.fn((findings: SecretFinding[]) => ({
    newFindings: findings,
    suppressed: 0,
    allFindings: findings,
  })),
}));

jest.unstable_mockModule('../../lib/safe/perms-audit.js', () => ({
  auditPerms: jest.fn(() => ({
    findings: [],
    coastGuard: { onByDefault: true, confinementAvailable: true, mechanism: 'mocked' },
  })),
  // jewelTargets is re-exported through scan.ts; keep it defined so the import
  // does not blow up even though this test does not exercise the fixer.
  jewelTargets: jest.fn(() => []),
}));

jest.unstable_mockModule('../../lib/safe/mcp-inventory.js', () => ({
  inventoryMcp: jest.fn(() => ({ servers: [], configsScanned: [] })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Subject + collaborators imported AFTER mocks (ESM top-level await).
// ─────────────────────────────────────────────────────────────────────────────
const { safePlugin } = await import('../../routes/safe.js');
const { HONEST_LIMITS } = await import('../../lib/coast-guard.js');
const Database = (await import('../../lib/sqlite-runtime.js')).default;

async function buildApp(withLedger = true) {
  const app = Fastify();
  const db = withLedger ? new Database(':memory:') : undefined;
  const deps = db ? { db, logger: { warn: () => {} } } : { logger: { warn: () => {} } };
  await app.register(safePlugin, { deps });
  await app.ready();
  return { app, db };
}

beforeEach(() => {
  secretFindings = [];
  mockExecFileSync.mockClear();
  mockSpawnSync.mockClear();
});

describe('GET /safe/scan', () => {
  it('returns a valid posture report (200, score, state, verbatim HONEST_LIMITS)', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { success: boolean; report: Record<string, unknown> };
    expect(body.success).toBe(true);

    const r = body.report as {
      score: number;
      state: string;
      honestLimits: string;
      deductions: unknown[];
      blastRadius: unknown[];
      summary: Record<string, unknown>;
    };
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['green', 'amber', 'red']).toContain(r.state);
    expect(Array.isArray(r.deductions)).toBe(true);
    expect(Array.isArray(r.blastRadius)).toBe(true);
    expect(typeof r.summary).toBe('object');
    // The load-bearing honesty check: footer is HONEST_LIMITS, verbatim.
    expect(r.honestLimits).toBe(HONEST_LIMITS);

    await app.close();
  });

  it('routes every host shell through the inert child_process mock — no real ps/codesign/nettop/lsof spawns', async () => {
    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    expect(res.statusCode).toBe(200);

    // `scan.ts`'s process enumeration (`ps -xo pid=,comm=`) goes through
    // `execFileSync`. Its presence in the mock's calls proves the REAL scan
    // path executed AND that the only thing standing between the test and a
    // real `ps` is the mock — i.e. without the mock this would have spawned.
    const execCmds = mockExecFileSync.mock.calls.map((c) => c[0]);
    const spawnCmds = mockSpawnSync.mock.calls.map((c) => c[0]);
    expect(execCmds).toContain('ps');

    // EVERYTHING the scan tried to shell was a benign host sensor and was
    // intercepted by the inert mocks — never a real process. (No command
    // outside this read-only allowlist should ever be shelled by the scan.)
    const SENSOR_CMDS = new Set(['ps', 'codesign', 'nettop', 'lsof', 'xattr', 'spctl', 'stat']);
    for (const cmd of [...execCmds, ...spawnCmds]) {
      expect(SENSOR_CMDS.has(cmd)).toBe(true);
    }
    await app.close();
  });

  it('NEVER returns a raw secret value in the payload — only last4 crosses the boundary', async () => {
    // Drive a real-shaped finding through the REAL scorer. last4 is the ONLY
    // token fragment a SecretFinding carries; the raw value must never appear.
    const RAW_SECRET = 'sk-THIS-RAW-VALUE-MUST-NEVER-LEAK-9999';
    secretFindings = [
      {
        path: '/home/op/.env',
        line: 3,
        ruleId: 'openai-api-key',
        last4: '9999',
        entropy: 4.2,
        method: 'structured-format',
        verified: null,
      },
    ];

    const { app } = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    const blob = JSON.stringify(res.json());

    // The raw value never appears anywhere in the serialized payload …
    expect(blob).not.toContain(RAW_SECRET);
    expect(blob).not.toContain('sk-THIS-RAW-VALUE');
    // … nor do the value-bearing key shapes a leak would surface as …
    expect(blob).not.toContain('"value":');
    expect(blob).not.toContain('"secret":');
    expect(blob).not.toContain('"rawValue":');
    // … and the finding's identifier (last4) DID cross — proving a finding was
    // genuinely present, so the no-leak above is meaningful, not vacuous.
    expect(blob).toContain('9999');

    await app.close();
  });

  it('builds the A5 trust-ledger schema at register (table exists)', async () => {
    const { app, db } = await buildApp();
    const row = (db as InstanceType<typeof Database>)
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='safe_trust_ledger'")
      .get();
    expect(row).toBeTruthy();
    await app.close();
  });

  it('still returns a report when no ledger db is supplied (degrades, never fails)', async () => {
    const { app } = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: '/safe/scan' });
    expect(res.statusCode).toBe(200);
    const report = (res.json() as { report: { honestLimits: string } }).report;
    expect(report.honestLimits).toBe(HONEST_LIMITS);
    await app.close();
  });
});
