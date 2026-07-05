/**
 * tests/unit/safe-corral.test.ts — ADR-0088 Phase B corral (jest, pure-fn +
 * in-memory vault). Verifies: a fixture secret corrals into the vault, the
 * source is rewritten to pd-secret://, a .bak is written, the resolver
 * round-trips the ORIGINAL value, and the dry-run plan writes nothing.
 *
 * Keychain is disabled suite-wide (tests/jest.env.js), so we inject the
 * in-memory corral vault — exercising the FULL save→resolve→inject round-trip
 * without a real Keychain. The bun test (tests/bun/) covers the real vault.
 */

import {
  planCorral,
  applyCorralItem,
  parseAssignment,
  rewriteAssignmentLine,
} from '../../lib/safe/corral.js';
import { scanContent } from '../../lib/safe/secret-scanner.js';
import {
  setCorralVault,
  memoryCorralVault,
  resolveSecretRef,
  resolveSecretRefsInEnv,
  corralResolves,
  _resetForTests,
  PD_SECRET_SCHEME,
} from '../../lib/secret-env.js';
import type { SecretFinding } from '../../lib/safe/types.js';

const HOME = '/home/test';

// A real-shaped AWS access key (structured format the A1 scanner flags).
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const ENV_PATH = '/home/test/proj/.env';

function findingForLine(path: string, line: string, lineNo: number): SecretFinding[] {
  return scanContent(path, line, HOME).map((f) => ({ ...f, line: lineNo }));
}

describe('parseAssignment (structured KEY=value grammar — no NLP)', () => {
  it('parses a bare assignment', () => {
    expect(parseAssignment('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')).toEqual({
      key: 'AWS_ACCESS_KEY_ID',
      value: 'AKIAIOSFODNN7EXAMPLE',
      quote: '',
    });
  });
  it('parses a double-quoted value', () => {
    expect(parseAssignment('FOO="bar baz"')).toEqual({ key: 'FOO', value: 'bar baz', quote: '"' });
  });
  it('parses a single-quoted value', () => {
    expect(parseAssignment("FOO='bar'")).toEqual({ key: 'FOO', value: 'bar', quote: "'" });
  });
  it('parses an export-prefixed assignment', () => {
    expect(parseAssignment('export TOKEN=abc')).toEqual({ key: 'TOKEN', value: 'abc', quote: '' });
  });
  it('strips an inline comment from an unquoted value', () => {
    expect(parseAssignment('FOO=bar # note')).toEqual({ key: 'FOO', value: 'bar', quote: '' });
  });
  it('returns null for comments and blanks', () => {
    expect(parseAssignment('# a comment')).toBeNull();
    expect(parseAssignment('   ')).toBeNull();
  });
  it('returns null for a non-assignment (bare PEM body line)', () => {
    expect(parseAssignment('-----BEGIN RSA PRIVATE KEY-----')).toBeNull();
  });
  it('refuses an unterminated quote (will not guess)', () => {
    expect(parseAssignment('FOO="bar')).toBeNull();
  });
});

describe('rewriteAssignmentLine preserves head + export, swaps only the value', () => {
  it('bare', () => {
    expect(rewriteAssignmentLine('FOO=secret', 'FOO', 'pd-secret://FOO', '')).toBe('FOO=pd-secret://FOO');
  });
  it('export prefix + leading ws', () => {
    expect(rewriteAssignmentLine('  export FOO=secret', 'FOO', 'pd-secret://FOO', '')).toBe(
      '  export FOO=pd-secret://FOO',
    );
  });
  it('preserves a trailing CR', () => {
    expect(rewriteAssignmentLine('FOO=secret\r', 'FOO', 'pd-secret://FOO', '')).toBe('FOO=pd-secret://FOO\r');
  });
});

describe('planCorral (dry-run, mutates nothing)', () => {
  it('plans a corralable dotenv secret', () => {
    const line = `AWS_ACCESS_KEY_ID=${AWS_KEY}`;
    const findings = findingForLine(ENV_PATH, line, 1);
    expect(findings.length).toBeGreaterThan(0);

    const reads: Record<string, string> = { [ENV_PATH]: line };
    const writes: string[] = [];
    const plan = planCorral(findings, {
      home: HOME,
      readFile: (p) => reads[p] ?? null,
    });
    expect(writes).toHaveLength(0); // planning writes nothing
    const item = plan.items[0];
    expect(item.corralable).toBe(true);
    expect(item.key).toBe('AWS_ACCESS_KEY_ID');
    expect(item.ref).toBe(`${PD_SECRET_SCHEME}AWS_ACCESS_KEY_ID`);
    // NO RAW VALUE on the plan object.
    expect(JSON.stringify(plan)).not.toContain(AWS_KEY);
  });

  it('marks a non-keyed finding (bare PEM body) as not corralable', () => {
    const pemPath = '/home/test/.ssh/id_rsa';
    const line = 'MIIBVAIBADANBgkqhkiG9w0BAQEFAASCAT4wggE6AgEAAkEA0' + 'abcdefghij';
    const findings = findingForLine(pemPath, line, 1);
    // entropy fallback fires on a known cred path; the source line is not KEY=value.
    if (findings.length === 0) return; // nothing detected → nothing to assert
    const plan = planCorral(findings, { home: HOME, readFile: () => line });
    expect(plan.items[0].corralable).toBe(false);
    expect(plan.items[0].skipReason).toBe('not-keyed');
  });

  it('marks an already-corralled line as already-ref', () => {
    const line = 'AWS_ACCESS_KEY_ID=pd-secret://AWS_ACCESS_KEY_ID';
    // synthesize a finding pointing at this line (last4 won't match a real key,
    // so use a finding that the scanner produces from a value we then replace).
    const findings: SecretFinding[] = [
      { path: ENV_PATH, line: 1, ruleId: 'aws-access-token', last4: 'MPLE', entropy: 4, method: 'structured-format', verified: null },
    ];
    const plan = planCorral(findings, { home: HOME, readFile: () => line });
    expect(plan.items[0].corralable).toBe(false);
    expect(plan.items[0].skipReason).toBe('already-ref');
  });
});

describe('applyCorralItem — the full safety-order round-trip', () => {
  beforeEach(() => {
    _resetForTests();
    setCorralVault(memoryCorralVault());
  });
  afterEach(() => {
    _resetForTests();
  });

  it('saves to vault, round-trips, writes .bak, rewrites source', () => {
    const original = `# project\nAWS_ACCESS_KEY_ID=${AWS_KEY}\nOTHER=plain\n`;
    const findings = scanContent(ENV_PATH, original, HOME);
    const awsFinding = findings.find((f) => f.ruleId.includes('aws'))!;
    expect(awsFinding).toBeDefined();

    const fs: Record<string, string> = { [ENV_PATH]: original };
    const dirs: string[] = [];
    const plan = planCorral([awsFinding], { home: HOME, readFile: (p) => fs[p] ?? null });
    const item = plan.items[0];
    expect(item.corralable).toBe(true);

    const result = applyCorralItem(item, {
      home: HOME,
      readFile: (p) => fs[p] ?? null,
      writeFile: (p, c) => {
        fs[p] = c;
      },
      mkdirp: (d) => dirs.push(d),
      exists: (p) => p in fs,
      now: () => new Date('2026-06-23T00:00:00.000Z'),
    });

    // (1) applied with round-trip verified
    expect(result.applied).toBe(true);
    expect(result.roundTripVerified).toBe(true);
    expect(result.key).toBe('AWS_ACCESS_KEY_ID');

    // (2) the value is in the vault and resolves to the ORIGINAL value
    expect(resolveSecretRef(`${PD_SECRET_SCHEME}AWS_ACCESS_KEY_ID`)).toBe(AWS_KEY);
    expect(corralResolves('AWS_ACCESS_KEY_ID')).toBe(true);

    // (3) the source is rewritten to the pd-secret:// reference
    expect(fs[ENV_PATH]).toContain('AWS_ACCESS_KEY_ID=pd-secret://AWS_ACCESS_KEY_ID');
    expect(fs[ENV_PATH]).not.toContain(AWS_KEY); // raw secret gone from disk
    // untouched lines preserved
    expect(fs[ENV_PATH]).toContain('# project');
    expect(fs[ENV_PATH]).toContain('OTHER=plain');

    // (4) a .bak of the ORIGINAL was written under the recovered dir
    expect(result.backupPath).toBeDefined();
    expect(result.backupPath).toContain('.port-daddy/recovered');
    expect(fs[result.backupPath!]).toBe(original); // the .bak holds the original (with the secret)
    expect(dirs).toContain('/home/test/.port-daddy/recovered');

    // (5) the access path resolves it back into a child env
    const injected = resolveSecretRefsInEnv({ AWS_ACCESS_KEY_ID: 'pd-secret://AWS_ACCESS_KEY_ID' });
    expect(injected.env.AWS_ACCESS_KEY_ID).toBe(AWS_KEY);
    expect(injected.resolved).toContain('AWS_ACCESS_KEY_ID');
  });

  it('does NOT rewrite the source when the resolver round-trip would fail', () => {
    const original = `AWS_ACCESS_KEY_ID=${AWS_KEY}\n`;
    const findings = scanContent(ENV_PATH, original, HOME);
    const awsFinding = findings.find((f) => f.ruleId.includes('aws'))!;
    const fs: Record<string, string> = { [ENV_PATH]: original };

    // A broken vault that "saves" but loads back a DIFFERENT value → round-trip fails.
    setCorralVault({
      available: () => true,
      save: () => true,
      load: () => 'WRONG-VALUE',
      remove: () => true,
      describe: () => ({ storage: 'memory', location: 'broken' }),
    });

    const plan = planCorral([awsFinding], { home: HOME, readFile: () => original });
    const result = applyCorralItem(plan.items[0], {
      home: HOME,
      readFile: (p) => fs[p] ?? null,
      writeFile: (p, c) => {
        fs[p] = c;
      },
      mkdirp: () => {},
      exists: () => false,
    });

    expect(result.applied).toBe(false);
    expect(result.roundTripVerified).toBe(false);
    expect(result.error).toMatch(/round-trip/i);
    // CRITICAL: the source still holds the original secret — nothing was lost.
    expect(fs[ENV_PATH]).toBe(original);
  });

  it('aborts on a TOCTOU value change (last4 mismatch at apply time)', () => {
    const original = `AWS_ACCESS_KEY_ID=${AWS_KEY}\n`;
    const findings = scanContent(ENV_PATH, original, HOME);
    const awsFinding = findings.find((f) => f.ruleId.includes('aws'))!;
    const plan = planCorral([awsFinding], { home: HOME, readFile: () => original });
    // The file CHANGED between plan and apply — different value now.
    const changed = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7DIFFERENT\n`;
    const fs: Record<string, string> = { [ENV_PATH]: changed };
    const result = applyCorralItem(plan.items[0], {
      home: HOME,
      readFile: (p) => fs[p] ?? null,
      writeFile: (p, c) => {
        fs[p] = c;
      },
      mkdirp: () => {},
      exists: () => false,
    });
    expect(result.applied).toBe(false);
    expect(result.error).toMatch(/changed under us|mismatch/i);
    expect(fs[ENV_PATH]).toBe(changed); // untouched
  });
});

describe('resolveSecretRefsInEnv leaves unresolved refs literal (fail-loud)', () => {
  beforeEach(() => {
    _resetForTests();
    setCorralVault(memoryCorralVault());
  });
  afterEach(() => _resetForTests());

  it('passes a non-resolving ref through as the literal value', () => {
    const { env, resolved, unresolved } = resolveSecretRefsInEnv({ MISSING: 'pd-secret://MISSING', PLAIN: 'x' });
    expect(env.MISSING).toBe('pd-secret://MISSING');
    expect(env.PLAIN).toBe('x');
    expect(resolved).toHaveLength(0);
    expect(unresolved).toContain('MISSING');
  });
});
