/**
 * A4 binary-trust unit tests (jest). ADR-0088 Phase A test plan:
 *   - REAL `codesign` shell on a known platform binary (`/bin/ls`) → `platform`.
 *   - fixture-text classification for ad-hoc / unsigned / dev-id (notarized +
 *     un-notarized) — the buckets.
 *   - MISSING quarantine xattr → `no-quarantine` (UNKNOWN), NEVER `quarantine`.
 *   - the `--check-notarization` non-verb is replaced by the `=notarized`
 *     requirement probe (exit 0 ⇔ notarized).
 *
 * The fixture text is captured from real `codesign -dv --verbose=4` output shapes
 * so the parsers are exercised against the genuine format, not a mock of our own
 * invention. Platform binaries are unstable to ship as fixtures (Gatekeeper/CI),
 * so the live-shell assertion uses `/bin/ls`, which is always present on macOS.
 */
import {
  assessBinary,
  classifyTrust,
  classifyQuarantine,
  classifyPathOrigin,
  parseTeamId,
  parseSigningId,
  parseCdhash,
  parseAuthority,
  parseAdhoc,
  realTrustRunner,
  type CodesignRaw,
  type TrustRunner,
} from '../../lib/safe/binary-trust.js';

const onMac = process.platform === 'darwin';

// ── Captured real `codesign -dv --verbose=4` output shapes ──────────────────

const LS_DISPLAY = [
  'Executable=/bin/ls',
  'Identifier=com.apple.ls',
  'Format=Mach-O universal (x86_64 arm64e)',
  'CodeDirectory v=20400 size=741 flags=0x0(none) hashes=18+2 location=embedded',
  'Platform identifier=26',
  'CDHash=470984c28c4eb5e5b866dcb88639b7afa56c845f',
  'Signature size=4442',
  'Authority=Software Signing',
  'Authority=Apple Code Signing Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=not set',
].join('\n');

const DEVID_DISPLAY = [
  'Identifier=node',
  'CodeDirectory v=20500 size=857584 flags=0x10000(runtime) hashes=26789+7 location=embedded',
  'CDHash=aabbccddeeff00112233445566778899aabbccdd',
  'Signature size=8987',
  'Authority=Developer ID Application: Node.js Foundation (HX7739G8FX)',
  'Authority=Developer ID Certification Authority',
  'Authority=Apple Root CA',
  'TeamIdentifier=HX7739G8FX',
].join('\n');

const ADHOC_DISPLAY = [
  'Identifier=_safe_unsigned_bin',
  'CodeDirectory v=20400 size=267 flags=0x20002(adhoc,linker-signed) hashes=5+0 location=embedded',
  'CDHash=0ec4acc5128e830ca1ca64b2c74fa58aec53eb91',
  'Signature=adhoc',
].join('\n');

const UNSIGNED_DISPLAY = '_safe_unsigned_bin: code object is not signed at all';

function raw(over: Partial<CodesignRaw>): CodesignRaw {
  return {
    verifyOk: false,
    displayText: '',
    notarizedOk: false,
    quarantineXattr: null,
    ...over,
  };
}

// ── Parsers ──────────────────────────────────────────────────────────────────

describe('codesign -dv parsers', () => {
  test('Authority chain leaf → root, in order', () => {
    expect(parseAuthority(DEVID_DISPLAY)).toEqual([
      'Developer ID Application: Node.js Foundation (HX7739G8FX)',
      'Developer ID Certification Authority',
      'Apple Root CA',
    ]);
  });
  test('TeamIdentifier — value, and "not set" → null', () => {
    expect(parseTeamId(DEVID_DISPLAY)).toBe('HX7739G8FX');
    expect(parseTeamId(LS_DISPLAY)).toBeNull();
  });
  test('Identifier + CDHash', () => {
    expect(parseSigningId(LS_DISPLAY)).toBe('com.apple.ls');
    expect(parseCdhash(LS_DISPLAY)).toBe('470984c28c4eb5e5b866dcb88639b7afa56c845f');
  });
  test('adhoc flag from Signature=adhoc and from the flags bitfield', () => {
    expect(parseAdhoc(ADHOC_DISPLAY)).toBe(true);
    expect(parseAdhoc(LS_DISPLAY)).toBe(false);
    expect(parseAdhoc(DEVID_DISPLAY)).toBe(false);
  });
});

// ── Classification buckets ───────────────────────────────────────────────────

describe('classifyTrust — the buckets', () => {
  test('platform binary (Software Signing → Apple Root) → platform', () => {
    expect(classifyTrust(raw({ displayText: LS_DISPLAY, verifyOk: true }), 'system')).toBe(
      'platform',
    );
  });
  test('Developer ID + notarized → dev-id-notarized', () => {
    expect(
      classifyTrust(raw({ displayText: DEVID_DISPLAY, verifyOk: true, notarizedOk: true }), 'npm-global'),
    ).toBe('dev-id-notarized');
  });
  test('Developer ID + NOT notarized → dev-id-unnotarized', () => {
    expect(
      classifyTrust(raw({ displayText: DEVID_DISPLAY, verifyOk: true, notarizedOk: false }), 'downloads'),
    ).toBe('dev-id-unnotarized');
  });
  test('ad-hoc (linker-signed) → ad-hoc', () => {
    expect(classifyTrust(raw({ displayText: ADHOC_DISPLAY, verifyOk: true }), 'tmp')).toBe('ad-hoc');
  });
  test('unsigned ("not signed at all") → unsigned', () => {
    expect(classifyTrust(raw({ displayText: UNSIGNED_DISPLAY, verifyOk: false }), 'downloads')).toBe(
      'unsigned',
    );
  });
  test('NO codesign output at all → unknown (cannot claim unsigned)', () => {
    expect(classifyTrust(raw({ displayText: '', verifyOk: false }), 'other')).toBe('unknown');
  });
  test('codesign ran but output carries no signature anchors → unsigned', () => {
    expect(classifyTrust(raw({ displayText: 'garbage line', verifyOk: false }), 'other')).toBe(
      'unsigned',
    );
  });
});

// ── Quarantine: missing → UNKNOWN, never SAFE ────────────────────────────────

describe('classifyQuarantine — missing xattr is UNKNOWN, not SAFE', () => {
  test('present xattr → quarantine', () => {
    expect(classifyQuarantine('0083;deadbeef;Safari;', true)).toBe('quarantine');
  });
  test('ABSENT xattr (probe ran, no value) → no-quarantine (the dangerous path)', () => {
    expect(classifyQuarantine(null, true)).toBe('no-quarantine');
    expect(classifyQuarantine('', true)).toBe('no-quarantine');
  });
  test('probe could not run → unknown (distinct from a confirmed-absent attr)', () => {
    expect(classifyQuarantine(null, false)).toBe('unknown');
  });
  test('no-quarantine is NEVER reported as a safe/quarantine origin', () => {
    const q = classifyQuarantine(null, true);
    expect(q).not.toBe('quarantine');
  });
});

// ── Path origin ──────────────────────────────────────────────────────────────

describe('classifyPathOrigin', () => {
  const HOME = '/home/test';
  test('running process beats path', () => {
    expect(classifyPathOrigin('/usr/bin/foo', HOME, true)).toBe('running-process');
  });
  test('~/Downloads → downloads', () => {
    expect(classifyPathOrigin(`${HOME}/Downloads/tool`, HOME, false)).toBe('downloads');
  });
  test('npm global bin → npm-global', () => {
    expect(classifyPathOrigin('/usr/local/lib/node_modules/x/bin/x', HOME, false)).toBe('npm-global');
  });
  test('/usr/bin → system', () => {
    expect(classifyPathOrigin('/usr/bin/ls', HOME, false)).toBe('system');
  });
});

// ── Defensive: a runner that returns null for every probe ───────────────────

describe('assessBinary — defensive when codesign is unavailable', () => {
  test('all probes null → unknown class, no-throw, no fields invented', () => {
    const nullRunner: TrustRunner = () => null;
    const b = assessBinary('/some/path/tool', { run: nullRunner, home: '/home/test' });
    expect(b.trustClass).toBe('unknown');
    expect(b.quarantine).toBe('unknown'); // probe could not run
    expect(b.teamId).toBeNull();
    expect(b.authority).toEqual([]);
    expect(b.notarized).toBe(false);
  });

  test('absent quarantine attr (xattr ran, reported "No such xattr") → no-quarantine, not safe', () => {
    const runner: TrustRunner = (cmd, args) => {
      // xattr RAN but the attribute is ABSENT — non-zero exit WITH a message.
      // This is the dangerous curl|bash / npm-install path, distinct from a
      // probe that could not run at all (which would be null → unknown).
      if (cmd === 'xattr') {
        return { ok: false, out: 'xattr: /usr/local/bin/node: No such xattr: com.apple.quarantine' };
      }
      if (cmd === 'codesign' && args.includes('-dv')) return { ok: true, out: DEVID_DISPLAY };
      if (cmd === 'codesign' && args.includes('--test-requirement==notarized'))
        return { ok: true, out: '' };
      return { ok: true, out: '' };
    };
    const b = assessBinary('/usr/local/bin/node', { run: runner, home: '/home/test' });
    expect(b.quarantine).toBe('no-quarantine');
    expect(b.trustClass).toBe('dev-id-notarized');
    expect(b.teamId).toBe('HX7739G8FX');
  });

  test('xattr probe could not run at all (null) → unknown, not no-quarantine', () => {
    const runner: TrustRunner = (cmd, args) => {
      if (cmd === 'xattr') return null; // command unrunnable (e.g. file gone)
      if (cmd === 'codesign' && args.includes('-dv')) return { ok: true, out: DEVID_DISPLAY };
      return { ok: true, out: '' };
    };
    const b = assessBinary('/usr/local/bin/node', { run: runner, home: '/home/test' });
    expect(b.quarantine).toBe('unknown');
  });
});

// ── REAL codesign shell on /bin/ls (the platform-binary live assertion) ─────

(onMac ? describe : describe.skip)('REAL codesign on /bin/ls', () => {
  test('/bin/ls classifies as a platform binary with no quarantine', () => {
    const b = assessBinary('/bin/ls', { run: realTrustRunner, home: process.env.HOME });
    expect(b.trustClass).toBe('platform');
    expect(b.signingId).toBe('com.apple.ls');
    expect(b.cdhash).toMatch(/^[0-9a-f]+$/);
    // /bin/ls carries no quarantine xattr → no-quarantine (UNKNOWN provenance,
    // which is CORRECT — a platform binary is trusted via SIGNING, not xattr).
    expect(b.quarantine).toBe('no-quarantine');
    // Platform binaries are NOT notarized (they are platform-signed).
    expect(b.notarized).toBe(false);
  });
});
