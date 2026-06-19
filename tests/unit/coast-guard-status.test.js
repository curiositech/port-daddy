/**
 * The Coast Guard read path: coastGuardStatus() is what `pd coast-guard status`
 * (and, next, the route + MCP tool + console UI) render. It must report the
 * guard's posture without ever exposing a secret value — only the protected paths.
 */
import { coastGuardStatus } from '../../lib/coast-guard.js';

describe('coastGuardStatus — the Coast Guard read path', () => {
  test('on by default; off only when PD_COAST_GUARD_OFF=1', () => {
    const prev = process.env.PD_COAST_GUARD_OFF;
    delete process.env.PD_COAST_GUARD_OFF;
    expect(coastGuardStatus().onByDefault).toBe(true);
    process.env.PD_COAST_GUARD_OFF = '1';
    expect(coastGuardStatus().onByDefault).toBe(false);
    if (prev === undefined) delete process.env.PD_COAST_GUARD_OFF;
    else process.env.PD_COAST_GUARD_OFF = prev;
  });

  test('reports the crown-jewel dirs (paths, never values) + dotenv denial', () => {
    const s = coastGuardStatus('/home/test');
    expect(s.protects.deniedDirs).toEqual(
      expect.arrayContaining(['/home/test/.ssh', '/home/test/.aws', '/home/test/.port-daddy-env']),
    );
    expect(s.protects.dotenvUnderHome).toBe(true);
    // No values, only paths — every entry is an absolute path under the given HOME.
    for (const d of s.protects.deniedDirs) expect(d.startsWith('/home/test/')).toBe(true);
  });

  test('mechanism + confinementAvailable are consistent with the platform', () => {
    const s = coastGuardStatus();
    expect(['seatbelt', 'landlock-helper', 'bwrap', 'none']).toContain(s.mechanism);
    expect(s.confinementAvailable).toBe(s.mechanism !== 'none');
    expect(s.secretBroker).toBe(true);
    expect(s.egressMetering).toBe(true);
  });
});
