/**
 * Regression test for scripts/check-doc-citations.mjs — the machine-checkable half
 * of the ship checklist's "citations are real" killer item (AGENTS.md § Pull Request
 * Operating Procedure). Runs the guard against committed fixtures so the behaviour is
 * pinned: a clean doc passes (real paths, proposal-marked fakes, placeholders, and
 * site-absolute routes all OK), a broken doc fails with the offending tokens named.
 */
import { describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const script = join(repo, 'scripts', 'check-doc-citations.mjs');
const fixture = (name) => join(repo, 'tests', 'fixtures', 'doc-citations', name);

/** Run the guard on explicit files; return { code, stdout, stderr }. */
function run(...files) {
  try {
    const stdout = execFileSync('node', [script, ...files], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-doc-citations guard', () => {
  test('passes a clean doc (real paths, proposal-marked fakes, placeholders, site routes)', () => {
    const { code, stdout } = run(fixture('clean.md'));
    expect(code).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  test('fails a doc with an unresolved repo path and names the token', () => {
    const { code, stderr } = run(fixture('broken.md'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/lib\/this-module-does-not-exist-xyz\.ts/);
    expect(stderr).toMatch(/repo path does not exist/);
  });

  test('fails a doc with a broken relative link', () => {
    const { code, stderr } = run(fixture('broken.md'));
    expect(code).toBe(1);
    expect(stderr).toMatch(/no-such-sibling\.md/);
    expect(stderr).toMatch(/relative link target missing/);
  });

  // ── Retired documents ─────────────────────────────────────────────────────
  //
  // A retired plan's citations record what the repo looked like when it was
  // written. V4-DAG.md cites `lib/hlc.ts` and `lib/sync-protocol.ts` because
  // Part XVII was the plan then; ADR-0049 rejected it and those files were
  // never built. This gate enforces what you touch, so adding a retirement
  // banner would otherwise make 24 dead citations the retiring PR's problem —
  // and "fix them" would mean editing history to make a dead document look
  // current.

  test('a retired document is never named by the sweeps', () => {
    // Asserts the EXEMPTION, not the repo's overall cleanliness. The first
    // version of this test ran the changed-files sweep and expected exit 0 —
    // which made it a claim about whatever else happened to be in the branch's
    // diff, and it duly went red in CI on a document this change never touched.
    // A unit test must not depend on the rest of the diff.
    const manifest = JSON.parse(
      readFileSync(join(repo, 'docs', 'retirement-manifest.json'), 'utf8'),
    );
    const retiredMd = Object.keys(manifest.retired).filter((f) => f.endsWith('.md'));
    expect(retiredMd.length).toBeGreaterThan(0);

    // Premise: these documents really would be rejected if the sweep saw them.
    // Without this the assertion below passes for a manifest of clean files.
    expect(retiredMd.some((f) => run(f).code !== 0)).toBe(true);

    // The --all sweep is not expected to exit 0 — the repo has pre-existing
    // citation debt in files this change never touched. What must hold is that
    // no RETIRED document is among the violations.
    const { stderr } = run('--all');
    const leaked = retiredMd.filter((f) => stderr.includes(`${f}:`));
    expect(leaked).toEqual([]); // any entry here is a retired doc the sweep still reported
  });

  test('the exemption is driven by the manifest, not a hardcoded list', () => {
    // If someone hardcodes paths here instead of reading the manifest, a doc
    // retired later silently stays under the gate. This asserts the wiring.
    const src = readFileSync(script, 'utf8');
    expect(src).toMatch(/retirement-manifest\.json/);
    // Strip comments before looking for hardcoded paths: the doc comment cites
    // V4-DAG.md as the worked example deliberately, and asserting on prose
    // would make this test fail for explaining itself.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    for (const p of ['V4-DAG.md', 'DAEMON-MESH', 'PHONE-INTEGRATION', 'recovery/README']) {
      expect(code).not.toContain(p);
    }
  });

  test('a retired document passed EXPLICITLY is still scanned', () => {
    // Same posture as fixtures: skipped in sweeps, checkable on demand, so the
    // exemption cannot hide a doc from every path at once.
    const { code, stderr } = run('V4-DAG.md');
    expect(code).toBe(1);
    expect(stderr).toMatch(/lib\/hlc\.ts|lib\/sync-protocol\.ts/);
  });
});
