/**
 * Unit tests for the binary-agnostic-wall hook auditor
 * (scripts/audit-hook-bypass.mjs, pd-spark #2, extends ADR-0053 / ADR-0102).
 *
 * The auditor exists to catch a single, precise defect class: a git HOOK that
 * stands down on an in-band environment variable. git runs `.git/hooks/*`
 * regardless of which git binary invoked it, so a hook is the one enforcement
 * surface an agent cannot dodge by swapping binaries — which is exactly why it
 * must never `exit 0` because some `FOO=1` was set in the agent's own shell.
 *
 * Coverage:
 *   1. A hook WITH an env-var bypass is flagged (each structural shape).
 *   2. A clean hook — and a quality gate that merely `exit 1`s — passes.
 *   3. The REAL repo (installers + shim + installed hooks) passes end-to-end
 *      (regression), with the shim's audited PD_SHIM_OFF correctly allowlisted
 *      rather than either flagged or silently ignored.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  scanText,
  allowlistMatch,
  ALLOWLIST,
} from '../../scripts/audit-hook-bypass.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDITOR = join(REPO_ROOT, 'scripts', 'audit-hook-bypass.mjs');

/** Run the auditor CLI over a root and return its parsed JSON + exit code. */
function runAuditor(root, extraArgs = []) {
  try {
    const out = execFileSync('node', [AUDITOR, '--json', '--root', root, ...extraArgs], {
      encoding: 'utf8',
    });
    return { code: 0, ...JSON.parse(out) };
  } catch (e) {
    // Non-zero exit still emits JSON on stdout.
    return { code: e.status ?? 1, ...JSON.parse(e.stdout) };
  }
}

describe('scanText — flags env-var hook bypasses', () => {
  test('if [ "${VAR:-}" = "1" ]; then exit 0  (posix test -> exit 0)', () => {
    const hook = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [ "${MY_BYPASS:-}" = "1" ]; then',
      '  exit 0',
      'fi',
      'echo enforcing >&2',
      'exit 1',
    ].join('\n');
    const found = scanText(hook);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].envVar).toBe('MY_BYPASS');
    expect(found.some((f) => /exit\s+0/.test(f.excerpt) || f.patternId.includes('then-block'))).toBe(true);
  });

  test('[ -n "$VAR" ] && exit 0  (&&-shortcircuit)', () => {
    const hook = '#!/bin/bash\n[ -n "$SKIP_HOOK" ] && exit 0\necho work\n';
    const found = scanText(hook);
    expect(found.map((f) => f.envVar)).toContain('SKIP_HOOK');
  });

  test('env-gated exec passthrough inside a then-block (shim shape)', () => {
    // Mirrors the git-shim idiom: a long audited body, then exec real git.
    const hook = [
      '#!/usr/bin/env bash',
      'if [ "${GIT_OFF:-}" = "1" ]; then',
      '  mkdir -p "$HOME/.log" || true',
      '  printf "bypassed\\n" >> "$HOME/.log/ops" || true',
      '  exec /usr/bin/git "$@"',
      'fi',
      'echo guard',
    ].join('\n');
    const found = scanText(hook);
    expect(found.map((f) => f.envVar)).toContain('GIT_OFF');
  });

  test('escaped template-literal form (\\${VAR}) is still caught', () => {
    // How a bash hook looks when embedded in a TS/JS template string.
    const embedded = 'const S = `if [ "\\${PD_SHIM_OFF:-}" = "1" ]; then\\n  exit 0\\nfi`;';
    const found = scanText(embedded);
    expect(found.map((f) => f.envVar)).toContain('PD_SHIM_OFF');
  });
});

describe('scanText — does NOT false-positive on legitimate hooks', () => {
  test('a clean pre-push hook (no env stand-down) yields zero findings', () => {
    const hook = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'while read -r a b c d; do',
      '  case "$c" in',
      '    refs/heads/main) echo refused >&2; exit 1;;',
      '  esac',
      'done',
      'exit 0',
    ].join('\n');
    expect(scanText(hook)).toEqual([]);
  });

  test('a quality gate that echoes an env-bypass hint but only `exit 1`s does not match', () => {
    // The README-freshness shape: the env check lives in a node script; the
    // hook body advertises the flag in a message and then ENFORCES (exit 1).
    const hook = [
      '#!/usr/bin/env bash',
      'node scripts/check-readme-freshness.mjs --staged',
      'RC=$?',
      'if (( RC == 1 )); then',
      '  echo "BLOCKED: update README (PD_README_OK=1 to bypass)." >&2',
      '  exit 1',
      'fi',
      'exit 0',
    ].join('\n');
    expect(scanText(hook)).toEqual([]);
  });

  test('a non-env conditional guarding exit 0 does not match', () => {
    const hook = 'if [ "$branch" = "wip" ]; then exit 0; fi\n';
    // $branch is a lowercase local var, not an ENV_STYLE name — no match.
    expect(scanText(hook)).toEqual([]);
  });
});

describe('allowlist — structured, documented, ADR-referenced', () => {
  test('the git shim PD_SHIM_OFF is allowlisted with an ADR reference', () => {
    const hit = allowlistMatch('cli/utils/git-shim.ts', 'PD_SHIM_OFF');
    expect(hit).not.toBeNull();
    expect(hit.adr).toMatch(/ADR-0053/);
    expect(hit.reason.length).toBeGreaterThan(40);
  });

  test('an arbitrary env var in the shim is NOT allowlisted', () => {
    expect(allowlistMatch('cli/utils/git-shim.ts', 'SOME_OTHER_FLAG')).toBeNull();
  });

  test('the allowlist stays tiny (a hook bypass must never be allowlisted away)', () => {
    expect(ALLOWLIST.length).toBeLessThanOrEqual(3);
    // Every entry must carry a rationale + ADR pointer.
    for (const e of ALLOWLIST) {
      expect(e.reason && e.reason.length).toBeGreaterThan(20);
      expect(e.adr).toMatch(/ADR-\d{4}/);
    }
  });
});

describe('regression — the real repo passes the wall', () => {
  test('auditor exits 0 with zero violations over the real tree', () => {
    const res = runAuditor(REPO_ROOT);
    if (!res.ok) {
      // Surface offenders so a future regression is diagnosable, not opaque.
      throw new Error(
        'hook bypass violations found:\n' +
        res.violations.map((v) => `  ${v.file}:${v.line} ${v.envVar} [${v.patternId}]`).join('\n'),
      );
    }
    expect(res.ok).toBe(true);
    expect(res.code).toBe(0);
    expect(res.violations).toEqual([]);
  });

  test('the git shim is detected AND allowlisted (allowlist path is live, not dead)', () => {
    const res = runAuditor(REPO_ROOT);
    expect(res.allowed.some((a) => a.file === 'cli/utils/git-shim.ts' && a.envVar === 'PD_SHIM_OFF')).toBe(true);
  });

  test('the pre-push installer no longer carries a silent env stand-down', () => {
    const res = runAuditor(REPO_ROOT);
    expect(res.violations.some((v) => v.file.endsWith('install-pre-push-hook.sh'))).toBe(false);
  });
});
