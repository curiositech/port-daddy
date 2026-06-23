/**
 * A3 perms-audit unit tests (jest, pure-fn). ADR-0088 Phase A.
 *   - `0600` key file → ok; `0644` key → exposed (world-readable).
 *   - `0640` → exposed (group-readable); `0700` dir → ok; `0750` dir → loose.
 *   - recommendedMode records the tightening target (the prior mode is the file's
 *     current `mode` — what A9's reversible fix would record before chmod).
 *   - coastGuardStatus is reported alongside (both facts matter).
 *   - injected stat/coastGuard → no real fs touched.
 */
import {
  auditPerms,
  classifyMode,
  jewelTargets,
  octal,
} from '../../lib/safe/perms-audit.js';

const HOME = '/home/test';

function fileTarget(path: string) {
  return { path, isDirTarget: false, recommendedMode: '0600' };
}
function dirTarget(path: string) {
  return { path, isDirTarget: true, recommendedMode: '0700' };
}

describe('octal', () => {
  test('formats permission bits as 0NNN', () => {
    expect(octal(0o600)).toBe('0600');
    expect(octal(0o644)).toBe('0644');
    expect(octal(0o700)).toBe('0700');
    expect(octal(0o4755 & 0o777)).toBe('0755');
  });
});

describe('classifyMode — secret FILES', () => {
  test('0600 → ok, no recommendedMode', () => {
    const f = classifyMode(fileTarget('/k/id_rsa'), { mode: 0o600, isDir: false });
    expect(f.severity).toBe('ok');
    expect(f.worldReadable).toBe(false);
    expect(f.groupReadable).toBe(false);
    expect(f.recommendedMode).toBeNull();
  });

  test('0644 → exposed (world-readable), recommends 0600', () => {
    const f = classifyMode(fileTarget('/k/id_rsa'), { mode: 0o644, isDir: false });
    expect(f.severity).toBe('exposed');
    expect(f.worldReadable).toBe(true);
    expect(f.recommendedMode).toBe('0600');
    // The current mode is what a reversible fix records as priorMode.
    expect(f.mode).toBe('0644');
  });

  test('0640 → exposed (group-readable only)', () => {
    const f = classifyMode(fileTarget('/k/creds'), { mode: 0o640, isDir: false });
    expect(f.severity).toBe('exposed');
    expect(f.groupReadable).toBe(true);
    expect(f.worldReadable).toBe(false);
  });

  test('0620 (group-writable, not readable) → loose', () => {
    const f = classifyMode(fileTarget('/k/creds'), { mode: 0o620, isDir: false });
    expect(f.severity).toBe('loose');
    expect(f.groupReadable).toBe(false);
    expect(f.groupOrWorldWritable).toBe(true);
  });
});

describe('classifyMode — secret DIRS', () => {
  test('0700 dir → ok', () => {
    const f = classifyMode(dirTarget('/k/.ssh'), { mode: 0o700, isDir: true });
    expect(f.severity).toBe('ok');
    expect(f.isDir).toBe(true);
  });

  test('0755 dir → exposed (world can read/traverse), recommends 0700', () => {
    const f = classifyMode(dirTarget('/k/.ssh'), { mode: 0o755, isDir: true });
    expect(f.severity).toBe('exposed');
    expect(f.recommendedMode).toBe('0700');
  });
});

describe('classifyMode — missing path', () => {
  test('non-existent path → exists:false, ok, no recommendation', () => {
    const f = classifyMode(fileTarget('/k/nope'), null);
    expect(f.exists).toBe(false);
    expect(f.severity).toBe('ok');
    expect(f.recommendedMode).toBeNull();
  });
});

describe('jewelTargets', () => {
  test('includes ~/.ssh as a dir target and id_rsa as a file target', () => {
    const targets = jewelTargets(HOME);
    const ssh = targets.find((t) => t.path === `${HOME}/.ssh`);
    expect(ssh?.isDirTarget).toBe(true);
    expect(ssh?.recommendedMode).toBe('0700');
    const key = targets.find((t) => t.path === `${HOME}/.ssh/id_rsa`);
    expect(key?.isDirTarget).toBe(false);
    expect(key?.recommendedMode).toBe('0600');
  });

  test('.docker/config.json from the jewel list is a FILE target (0600), not a dir', () => {
    const targets = jewelTargets(HOME);
    const docker = targets.find((t) => t.path === `${HOME}/.docker/config.json`);
    expect(docker).toBeDefined();
    expect(docker?.isDirTarget).toBe(false);
    expect(docker?.recommendedMode).toBe('0600');
  });
});

describe('auditPerms — injected deps', () => {
  test('reports findings + the Coast Guard posture together', () => {
    const result = auditPerms(HOME, {
      // every path 0600 file / 0700 dir → all ok except a poisoned .ssh
      stat: (p: string) => {
        if (p === `${HOME}/.ssh`) return { mode: 0o755, isDir: true }; // exposed
        if (p.endsWith('/id_rsa')) return { mode: 0o644, isDir: false }; // exposed
        if (p.endsWith('.ssh') || p.endsWith('.aws') || p.endsWith('.gnupg')) {
          return { mode: 0o700, isDir: true };
        }
        return { mode: 0o600, isDir: false };
      },
      coastGuard: () => ({
        onByDefault: true,
        confinementAvailable: false,
        mechanism: 'none',
      }),
    });

    const ssh = result.findings.find((f) => f.path === `${HOME}/.ssh`);
    expect(ssh?.severity).toBe('exposed');
    const rsa = result.findings.find((f) => f.path.endsWith('/id_rsa'));
    expect(rsa?.severity).toBe('exposed');
    expect(rsa?.recommendedMode).toBe('0600');

    // Coast Guard posture surfaces even though the file is "0644".
    expect(result.coastGuard.onByDefault).toBe(true);
    expect(result.coastGuard.confinementAvailable).toBe(false);
    expect(result.coastGuard.mechanism).toBe('none');
  });

  test('a fully locked-down host → zero exposed findings', () => {
    const result = auditPerms(HOME, {
      stat: (p: string) =>
        p.split('/').pop()?.startsWith('.') && !p.endsWith('.json') && !p.includes('id_')
          ? { mode: 0o700, isDir: true }
          : { mode: 0o600, isDir: false },
      coastGuard: () => ({ onByDefault: true, confinementAvailable: true, mechanism: 'seatbelt' }),
    });
    expect(result.findings.every((f) => f.severity === 'ok')).toBe(true);
  });
});
