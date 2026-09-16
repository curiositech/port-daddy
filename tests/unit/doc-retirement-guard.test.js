/**
 * Regression test for scripts/doc-retirement-guard.mjs.
 *
 * The gate exists because a superseded plan that still reads as current is
 * worse than a missing one: an agent that finds it follows it. `docs/recovery/`
 * asserted "if a roadmap ... elsewhere disagrees with this directory, this
 * directory wins" for four months after that stopped being true.
 *
 * What is actually pinned here is that the gate checks BOTH directions. A gate
 * that only verified "every manifest entry is bannered" would be satisfied by
 * an empty manifest, and would never notice a banner pasted onto a doc that
 * nobody registered. Each fixture below breaks exactly one property, so a
 * passing case cannot mask a failing one.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'doc-retirement-guard.mjs');
const caseDir = (name) => join(repo, 'tests', 'fixtures', 'doc-retirement', name);

/** Run the guard against one fixture tree. */
function run(name) {
  const root = caseDir(name);
  const args = [script, '--root', root, '--manifest', join(root, 'manifest.json')];
  try {
    return { code: 0, out: execFileSync('node', args, { cwd: repo, encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '') };
  }
}

describe('doc-retirement-guard', () => {
  test('a properly retired doc passes', () => {
    const { code, out } = run('clean');
    expect(code).toBe(0);
    expect(out).toMatch(/1 retired document/);
  });

  test('a manifest entry whose file was DELETED fails — retirement is demotion', () => {
    // The 2026-06-05 operator rule is delete only a merged twin. A guard that
    // shrugged at a missing file would let a deletion masquerade as a retirement.
    const { code, out } = run('missing-file');
    expect(code).toBe(1);
    expect(out).toMatch(/does not exist/);
    expect(out).toMatch(/demotion, not deletion/);
  });

  test('a bannered doc that is NOT in the manifest fails', () => {
    // The direction that keeps the manifest from falling behind the tree. Drop
    // this check and the gate degrades into "whatever I remembered to list".
    const { code, out } = run('unregistered');
    expect(code).toBe(1);
    expect(out).toMatch(/sneaked-in\.md/);
    expect(out).toMatch(/NOT in/);
    // ...and the correctly-registered doc beside it is not blamed for it.
    expect(out).not.toMatch(/retired\.md:/);
  });

  test('a banner naming a different ADR than the manifest fails', () => {
    const { code, out } = run('number-mismatch');
    expect(code).toBe(1);
    expect(out).toMatch(/banner says ADR-0049, manifest says ADR-0126/);
  });

  test('a banner below the fold fails, and says so specifically', () => {
    // Distinguished from "no banner at all" on purpose: the two have different
    // fixes, and telling an author "you have no banner" when they wrote one at
    // the bottom sends them to write a second.
    const { code, out } = run('below-fold');
    expect(code).toBe(1);
    expect(out).toMatch(/below line 40/);
    expect(out).not.toMatch(/carries no "RETIRED-BY/);
  });

  test('a retirement pointing at a non-existent ADR fails', () => {
    const { code, out } = run('dangling-adr');
    expect(code).toBe(1);
    expect(out).toMatch(/ADR-0999, which is not a live ADR/);
  });

  test('a retirement with no stated reason fails', () => {
    // Whitespace-only, not absent: "   " is non-empty by length and empty by
    // meaning, the same failure mode the relay envelope's `reason` field has.
    const { code, out } = run('no-reason');
    expect(code).toBe(1);
    expect(out).toMatch(/non-empty "reason"/);
  });

  test('a doc listed as retired but still reading as current fails', () => {
    const { code, out } = run('unbannered');
    expect(code).toBe(1);
    expect(out).toMatch(/carries no "RETIRED-BY: ADR-NNNN" marker/);
  });

  test('a banner link that only resolves from the repo root fails', () => {
    // The mistake this caught for real: a banner in docs/ linking
    // `docs/adr/0126-...`, which renders as `docs/docs/adr/0126-...` and 404s.
    // check-doc-citations.mjs read the same string as repo-relative and passed
    // it, so this gate is not redundant with that one.
    const { code, out } = run('broken-link');
    expect(code).toBe(1);
    expect(out).toMatch(/does not resolve from this file's directory/);
  });

  test('the real repo corpus is clean', () => {
    // The gate is worthless if it does not pass on the tree it ships with.
    let code = 0;
    let out = '';
    try {
      out = execFileSync('node', [script], { cwd: repo, encoding: 'utf8' });
    } catch (e) {
      code = e.status ?? 1;
      out = (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '');
    }
    expect(out).toBe(out); // keep the output in the failure message
    expect(code).toBe(0);
  });

  test('every doc ADR-0126 named as superseded is actually registered', () => {
    // Ties the manifest to the ADR that authorized it. ADR-0126 says WS-H
    // "cites this section and adds no new judgments" — so the manifest must
    // not quietly retire something the ADR never named, and must not miss one.
    const manifest = JSON.parse(
      execFileSync('node', ['-e', 'process.stdout.write(require("fs").readFileSync("docs/retirement-manifest.json","utf8"))'], {
        cwd: repo,
        encoding: 'utf8',
      }),
    );
    const listed = Object.keys(manifest.retired).sort();
    expect(listed).toEqual(
      [
        'V4-DAG.md',
        'docs/DAEMON-MESH-ARCHITECTURE.md',
        'docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md',
        'docs/recovery/README.md',
        'v4.dag.yaml',
      ].sort(),
    );
    for (const entry of Object.values(manifest.retired)) {
      expect(entry.supersededBy).toBe('ADR-0126');
    }
  });
});
