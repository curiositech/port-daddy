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
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { documentCitationViolations, isSealedSyntheticCitation } from '../../scripts/check-doc-citations.mjs';

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

/** Run an explicit script variant against an explicit file (used by the mutation tests below). */
function runScript(scriptPath, ...files) {
  try {
    const stdout = execFileSync('node', [scriptPath, ...files], { cwd: repo, encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? '', stderr: e.stderr?.toString() ?? '' };
  }
}

describe('check-doc-citations guard', () => {
  const sealedReports = [
    'docs/harbor-research/campaigns/2026-11-06/round-two/red/FINAL.md',
    'docs/harbor-research/campaigns/2026-11-06/round-two/red/FINAL.first-freeze.md',
  ];
  const syntheticToken = 'routes/future/direct-writer.ts';

  test.each(sealedReports)('the exact sealed synthetic reference passes without editing %s', documentPath => {
    const bytes = readFileSync(join(repo, documentPath));
    const documentSha256 = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.toString('utf8').split('\n')[46]).toContain('`' + syntheticToken + '`');
    expect(isSealedSyntheticCitation({ documentPath, documentSha256, line: 47, token: syntheticToken })).toBe(true);
    expect(documentCitationViolations(documentPath, bytes)).toEqual([]);
    expect(run(documentPath).code).toBe(0);
  });

  test.each([
    ['document hash', { documentSha256: '0'.repeat(64) }],
    ['document path', { documentPath: 'docs/harbor-research/campaigns/2026-11-06/round-two/red/UNREVIEWED.md' }],
    ['line', { line: 48 }],
    ['literal token', { token: 'routes/future/other-writer.ts' }],
    ['literal line suffix', { token: 'routes/future/direct-writer.ts:1' }],
    ['literal whitespace', { token: ' routes/future/direct-writer.ts ' }],
  ])('sealed annotation refuses changed %s', (_name, altered) => {
    const documentPath = sealedReports[0];
    const documentSha256 = createHash('sha256').update(readFileSync(join(repo, documentPath))).digest('hex');
    expect(isSealedSyntheticCitation({ documentPath, documentSha256, line: 47, token: syntheticToken, ...altered })).toBe(false);
  });

  test.each(sealedReports)('changed bytes fail closed and neighboring missing citations remain checked: %s', documentPath => {
    const bytes = readFileSync(join(repo, documentPath));
    const lines = bytes.toString('utf8').split('\n');
    const missingPath = 'routes/citation-neighbor-does-not-exist.ts';
    const missingLink = 'citation-neighbor-does-not-exist.md';
    lines[46] += ` Neighbor \`${missingPath}\` and [missing](${missingLink}).`;
    const changed = Buffer.from(lines.join('\n'));
    const violations = documentCitationViolations(documentPath, changed);
    expect(violations).toEqual(expect.arrayContaining([
      { file: documentPath, line: 47, kind: 'path', token: syntheticToken },
      { file: documentPath, line: 47, kind: 'path', token: missingPath },
      { file: documentPath, line: 47, kind: 'link', token: missingLink },
    ]));
    // The source report and its existing seal are untouched by the test.
    expect(readFileSync(join(repo, documentPath))).toEqual(bytes);
  });

  test('an otherwise identical unannotated document cannot reuse a sealed annotation', () => {
    const bytes = readFileSync(join(repo, sealedReports[0]));
    const documentPath = 'docs/harbor-research/campaigns/2026-11-06/round-two/red/UNREVIEWED.md';
    expect(documentCitationViolations(documentPath, bytes)).toContainEqual({
      file: documentPath, line: 47, kind: 'path', token: syntheticToken,
    });
  });

  test('the import guard preserves CLI enforcement through a script symlink', () => {
    const dir = mkdtempSync(join(tmpdir(), 'doc-citations-symlink-'));
    const linkedScript = join(dir, 'check-doc-citations.mjs');
    symlinkSync(script, linkedScript);
    try {
      const { code, stderr } = runScript(linkedScript, fixture('broken.md'));
      expect(code).toBe(1);
      expect(stderr).toMatch(/lib\/this-module-does-not-exist-xyz\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

  // ── Brace-expansion exclusion and the proof-estate proposal markers ────────
  //
  // Raised by pd-qa on the PR that added these: the `{`/`}` exclusion and the
  // `placeholder` / `artifact target` markers shipped with no test exercising
  // them at all, so a future regex or list edit could silently start rejecting
  // (or silently stop excluding) either one and nothing would notice. Each
  // fixture line was checked non-vacuous BEFORE this test was written: with the
  // exclusion or marker removed, that specific line — and only that line —
  // fails, naming the same path the finding warned about.

  test('a brace-expansion citation is out of scope, not a broken path', () => {
    const { code, stdout } = run(fixture('clean.md'));
    expect(code).toBe(0);
    // Non-vacuity: the literal (braced) token is not a file on disk, so if the
    // `{`/`}` exclusion in REPO_PATH_RE were ever dropped, this citation would
    // start failing — and it would name exactly this token.
    expect(stdout).not.toMatch(/coordination-\{crypto,acl\}/);
  });

  test('the two proof-estate prospective-artifact markers are honoured', () => {
    const { code } = run(fixture('clean.md'));
    expect(code).toBe(0);
    // Mutation check, run directly rather than asserted on faith: strip the
    // `'placeholder', 'artifact target',` entry from PROPOSAL_MARKERS and rerun
    // the real script against the real fixture. Both lines that rely on those
    // markers must fail, and only those two.
    const src = readFileSync(script, 'utf8');
    const markerLine = "  'placeholder', 'artifact target',\n";
    expect(src).toContain(markerLine);
    const mutated = src.replace(markerLine, '');
    expect(mutated).not.toBe(src);

    const dir = mkdtempSync(join(tmpdir(), 'doc-citations-mutation-'));
    const mutatedScript = join(dir, 'check-doc-citations.mjs');
    writeFileSync(mutatedScript, mutated);
    try {
      const { code: mutatedCode, stderr } = runScript(mutatedScript, fixture('clean.md'));
      expect(mutatedCode).toBe(1);
      expect(stderr).toMatch(/proofs\/economics\/does-not-exist-yet\.pv/);
      expect(stderr).toMatch(/analyses\/does-not-exist-yet\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
