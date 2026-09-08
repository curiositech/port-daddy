import { describe, it, expect, vi } from 'vitest';
import { controlDb } from './support/fleet-controls.js';
import { readFleetControl, fleetMayRun, writeFleetControl, installationScope } from '../../../shared/fleet-controls.js';


describe('Cloud Fleet control authority', () => {
  it('times out an unavailable primary and refuses admission', async () => {
    vi.useFakeTimers();
    try {
      const statement = { bind() { return this; }, all: () => new Promise(() => {}) };
      const db = { withSession: () => ({ prepare: () => statement }) } as unknown as D1Database;
      const pending = fleetMayRun(db, 42);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('rolls back the setting when its mandatory audit cannot be recorded', async () => {
    const db = controlDb([42]);
    await db.prepare('DROP TABLE fleet_control_audit').run();
    await expect(writeFleetControl(db, 'global', false, 1, 'u_admin')).rejects.toThrow();
    expect(await readFleetControl(db, 'global')).toMatchObject({ enabled: true, revision: 1 });
  });

  it('defaults both levels off and never admits without both explicit enables', async () => {
    const db = controlDb();
    expect(await fleetMayRun(db, 42)).toBe(false);
    await writeFleetControl(db, 'global', true, 0, 'u_admin');
    expect(await fleetMayRun(db, 42)).toBe(false);
    await writeFleetControl(db, installationScope(42), true, 0, 'u_owner');
    expect(await fleetMayRun(db, 42)).toBe(true);
    expect(await fleetMayRun(db, 43)).toBe(false);
    await writeFleetControl(db, 'global', false, 1, 'u_admin');
    expect(await fleetMayRun(db, 42)).toBe(false);
    expect((await readFleetControl(db, installationScope(42))).enabled).toBe(true);
  });

  it('rejects stale resumes and records only successful changes atomically', async () => {
    const db = controlDb();
    await writeFleetControl(db, 'global', true, 0, 'u_admin');
    await writeFleetControl(db, 'global', false, 1, 'u_admin');
    await expect(writeFleetControl(db, 'global', true, 1, 'u_admin')).rejects.toThrow('STALE_CONTROL');
    expect((await readFleetControl(db, 'global')).enabled).toBe(false);
    const audit = await db.prepare('SELECT * FROM fleet_control_audit ORDER BY revision').all();
    expect(audit.results).toHaveLength(2);
    expect(audit.results[1]).toMatchObject({ scope: 'global', enabled: 0, revision: 2, updated_by: 'u_admin' });
  });

  it('is fail-closed for absent bindings, failed reads, missing IDs and malformed rows', async () => {
    expect(await fleetMayRun(undefined, 42)).toBe(false);
    expect(await fleetMayRun(controlDb(), null)).toBe(false);
    const broken = { withSession() { throw new Error('offline'); } } as unknown as D1Database;
    expect(await fleetMayRun(broken, 42)).toBe(false);
    expect(await readFleetControl(broken, 'global')).toMatchObject({ enabled: false, available: false });
    const malformedStatement = { bind() { return this; }, all: async () => ({ success: true, results: [{ scope: 'global', enabled: '1', revision: 1 }] }) };
    const malformed = { withSession() { return { prepare: () => malformedStatement }; } } as unknown as D1Database;
    expect(await fleetMayRun(malformed, 42)).toBe(false);
  });

  it('does not reuse an earlier allow result after an installation stop', async () => {
    const db = controlDb();
    await writeFleetControl(db, 'global', true, 0, 'u_admin');
    await writeFleetControl(db, installationScope(42), true, 0, 'u_owner');
    expect(await fleetMayRun(db, 42)).toBe(true);
    await writeFleetControl(db, installationScope(42), false, 1, 'u_owner');
    expect(await fleetMayRun(db, 42)).toBe(false);
  });
});
