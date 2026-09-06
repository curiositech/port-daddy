import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCorpus, renderMechanizedClaims, validateCorpus } from './generate-mega-whitepaper.mjs';

// The emitter defensively splits a long \path{a/b/c.ext} into several
// \allowbreak-joined \path{} calls (and inserts \allowbreak inside \texttt{}
// identifiers) so a narrow table column never overflows -- see
// generate-mega-whitepaper.mjs's texPathBreakable/texCode. That presentation
// detail would make every literal-substring assertion below brittle, so
// tests that need to see a whole id or path as one string first undo it.
function collapseBreakHints(text) {
  let result = text.replace(/\\allowbreak /g, '');
  // Merge one adjacent \path{X}\path{Y pair per pass (only when \path{
  // genuinely precedes the closing brace being dropped, so a \newline{}
  // between two different paths' \path{} runs is never mistaken for one of
  // these splits); repeat until nothing more collapses.
  let previous;
  do {
    previous = result;
    result = result.replace(/\\path\{([^{}]*)\}\\path\{/g, '\\path{$1');
  } while (result !== previous);
  return result;
}

// A minimal, hand-built manifest matching whitepaper/corpus.schema.json's
// shape closely enough to exercise the emitter without depending on the real
// whitepaper/corpus.json (which the real-manifest test below still checks
// separately). Deliberately out of id order and carrying TeX specials in its
// prose fields, so ordering and escaping are both under test.
function fixtureManifest(overrides = {}) {
  return {
    formalArtifacts: [
      {
        id: 'zzz-last-proverif',
        kind: 'protocol-model',
        authority: 'product-runtime',
        status: 'current',
        paths: ['analyses/zzz_last.pv'],
        method: 'ProVerif',
        owner: 'test/owner',
        evidencePolicy: 'checked & verified, with an under_score in it',
        ci: { status: 'wired', job: ['proverif-estate'] },
      },
      {
        id: 'aaa-first-proverif',
        kind: 'negative-control',
        authority: 'product-runtime',
        status: 'historical',
        paths: ['analyses/aaa_first.pv'],
        method: 'ProVerif',
        owner: 'test/owner',
        evidencePolicy: 'first & foremost, now retired',
        ci: { status: 'retired', reason: 'superseded & no longer run' },
      },
      {
        id: 'mid-kani-harness',
        kind: 'rust-proof-harness',
        authority: 'product-runtime',
        status: 'current',
        paths: ['core/fixture-rs/src/lib.rs'],
        method: 'Kani',
        owner: 'test/owner',
        evidencePolicy: 'bounded model of a fixture function',
        ci: { status: 'wired', job: ['kani-fixture'] },
        harnessName: 'proof_fixture_case',
      },
    ],
    researchProgramArtifacts: [
      {
        id: 'monte-fixture',
        kind: 'monte-carlo-simulation',
        status: 'current',
        paths: ['proofs/fixture/simulate.mjs'],
        owner: 'test/owner',
        ci: { status: 'wired', job: ['monte-carlo-fixture'] },
      },
    ],
    ...overrides,
  };
}

test('renderMechanizedClaims sorts rows by id within a method table, independent of manifest order', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  const table = rendered.slice(
    rendered.indexOf('ProVerif artifacts'),
    rendered.indexOf('\\end{tabularx}', rendered.indexOf('ProVerif artifacts')),
  );
  // The manifest lists zzz-last- before aaa-first-; the rendered table must not.
  assert.ok(
    table.indexOf('aaa-first-proverif') === -1,
    'the id must not appear as one literal run (texCode splits it with \\allowbreak)',
  );
  const collapsed = collapseBreakHints(table);
  assert.ok(
    collapsed.indexOf('aaa-first-proverif') < collapsed.indexOf('zzz-last-proverif'),
    'aaa-first-proverif (alphabetically first) must precede zzz-last-proverif in the ProVerif table',
  );
});

test('renderMechanizedClaims escapes TeX specials in prose fields but leaves \\path{} arguments raw', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  // Ampersand and underscore in evidencePolicy prose are escaped. A formal
  // artifact always prints its own evidencePolicy (required by the schema
  // for every formalArtifact, wired or retired) rather than ci.reason.
  // (collapseBreakHints, not just a raw match: evidence-policy prose now
  // also gets a defensive \allowbreak after hyphens/underscores/slashes --
  // see texEscapeBreakable's own comment for the real overfull \hbox, in a
  // DIFFERENT row's prose, that made this necessary.)
  assert.match(collapseBreakHints(rendered), /checked \\& verified, with an under\\_score in it/);
  assert.match(collapseBreakHints(rendered), /first \\& foremost, now retired/);
  // The id itself (the "claim" column) is also escaped even though this
  // fixture's ids happen to use only hyphens, and the Kani harness name's
  // underscore is escaped too.
  assert.match(collapseBreakHints(rendered), /\\texttt\{proof\\_fixture\\_case\}/);
  // But a path, which prints through url.sty's \path{}, keeps its raw
  // underscore -- exactly like the existing \path{harbor_card_v*.pv} usage
  // elsewhere in the whitepaper (once the defensive \path{} splitting for
  // long paths is collapsed back to see the logical, single path).
  assert.match(collapseBreakHints(rendered), /\\path\{analyses\/zzz_last\.pv\}/);
  assert.doesNotMatch(collapseBreakHints(rendered), /zzz\\_last/);
});

test('renderMechanizedClaims emits exactly one table per method, not split by wired/retired', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  const captions = [...rendered.matchAll(/\\captionof\{table\}\{([^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual(
    captions.sort(),
    ['Kani artifacts (1 wired, 0 retired).', 'Monte Carlo artifacts (1 wired, 0 retired).', 'ProVerif artifacts (1 wired, 1 retired).'].sort(),
    'one caption per distinct method, each counting its own wired/retired rows',
  );
  // The single ProVerif table holds both the wired and the retired row.
  const table = collapseBreakHints(rendered.slice(
    rendered.indexOf('ProVerif artifacts'),
    rendered.indexOf('\\end{tabularx}', rendered.indexOf('ProVerif artifacts')),
  ));
  assert.match(table, /aaa-first-proverif/);
  assert.match(table, /zzz-last-proverif/);
});

test('renderMechanizedClaims states the total, wired, and retired counts in its lead paragraph', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  assert.match(
    rendered,
    /4 artifacts in total, 3 wired into continuous integration and 1 retired/,
  );
  assert.match(rendered, /\\path\{whitepaper\/corpus\.json\}/);
});

test('renderMechanizedClaims labels a Kani row with its harness function alongside the path', () => {
  const rendered = collapseBreakHints(renderMechanizedClaims(fixtureManifest()));
  assert.match(
    rendered,
    /\\path\{core\/fixture-rs\/src\/lib\.rs\}\\ \(\\texttt\{proof\\_fixture\\_case\}\)/,
  );
});

test('renderMechanizedClaims prints a shared directory once and stacks the remaining basenames one per line', () => {
  const manifest = fixtureManifest();
  manifest.formalArtifacts.push({
    id: 'multi-path-tla',
    kind: 'state-machine-model',
    authority: 'product-runtime',
    status: 'current',
    paths: ['proofs/multifixture/Model.tla', 'proofs/multifixture/Model.cfg'],
    method: 'TLA+/TLC',
    owner: 'test/owner',
    evidencePolicy: 'CI artifact per run',
    ci: { status: 'wired', job: ['tla-fixture'] },
  });
  const rendered = renderMechanizedClaims(manifest);
  // The shared "proofs/multifixture/" directory is printed once, annotated
  // with the file count, not repeated before every one of the two basenames
  // -- repeating an 18-path row's shared prefix on every line was the actual
  // remaining cause of an overfull \hbox this emitter hit and fixed.
  assert.match(rendered, /\\path\{proofs\/\}\\allowbreak \\path\{multifixture\/\}\\ \\textit\{\(2 files\)\}/);
  // The two basenames follow, joined by a forced \newline (not a wrapped
  // comma list), each still through \path{} for its raw underscore/dot.
  assert.match(rendered, /\\path\{Model\.\}\\allowbreak \\path\{tla\}\\newline\{\}\\path\{Model\.\}\\allowbreak \\path\{cfg\}/);
  assert.doesNotMatch(rendered, /Model\.tla.*,.*Model\.cfg/s);
  // And the shared directory itself appears exactly once in this row, not twice.
  assert.equal((rendered.match(/proofs\/\}\\allowbreak \\path\{multifixture\/\}/g) ?? []).length, 1);
});

test('renderMechanizedClaims falls back to one \\newline per full path when multiple paths share no directory', () => {
  const manifest = fixtureManifest();
  manifest.formalArtifacts.push({
    id: 'multi-path-no-shared-dir',
    kind: 'state-machine-model',
    authority: 'product-runtime',
    status: 'current',
    paths: ['analyses/one.pv', 'proofs/two.tla'],
    method: 'ProVerif',
    owner: 'test/owner',
    evidencePolicy: 'no shared directory between these two',
    ci: { status: 'wired', job: ['fixture-job'] },
  });
  const rendered = collapseBreakHints(renderMechanizedClaims(manifest));
  assert.match(rendered, /\\path\{analyses\/one\.pv\}\\newline\{\}\\path\{proofs\/two\.tla\}/);
  assert.doesNotMatch(rendered, /files\}/);
});

test('renderMechanizedClaims falls back to ci.reason (retired) or an em dash (wired) for research artifacts, which have no evidencePolicy field', () => {
  const manifest = fixtureManifest();
  manifest.researchProgramArtifacts.push({
    id: 'monte-fixture-retired',
    kind: 'monte-carlo-simulation',
    status: 'historical',
    paths: ['proofs/fixture/old-simulate.mjs'],
    owner: 'test/owner',
    ci: { status: 'retired', reason: 'superseded & no longer run' },
  });
  const rendered = collapseBreakHints(renderMechanizedClaims(manifest));
  // Wired research artifact: no evidencePolicy field exists for its kind, so
  // the cell reads the house "not applicable" mark rather than inventing text.
  assert.match(rendered, /\\texttt\{monte-fixture\} & \\path\{proofs\/fixture\/simulate\.mjs\} & \\texttt\{monte-carlo-fixture\} & \\textsc\{current\} & --- \\\\/);
  // Retired research artifact: ci.reason is real, recorded content, so it
  // fills the evidence-policy column instead of a bare dash.
  assert.match(rendered, /superseded \\& no longer run/);
});

test('renderMechanizedClaims fails closed when a required field is missing from a formal artifact', () => {
  const missingEvidencePolicy = fixtureManifest();
  delete missingEvidencePolicy.formalArtifacts[0].evidencePolicy;
  assert.throws(
    () => renderMechanizedClaims(missingEvidencePolicy),
    /zzz-last-proverif.*evidencePolicy must be a non-empty string/s,
  );

  const missingMethod = fixtureManifest();
  delete missingMethod.formalArtifacts[0].method;
  assert.throws(
    () => renderMechanizedClaims(missingMethod),
    /zzz-last-proverif.*method must be a non-empty string/s,
  );
});

test('renderMechanizedClaims fails closed on a malformed or missing ci block', () => {
  const badStatus = fixtureManifest();
  badStatus.formalArtifacts[0].ci = { status: 'flaky' };
  assert.throws(() => renderMechanizedClaims(badStatus), /ci\.status must be "wired" or "retired"/);

  const wiredWithNoJob = fixtureManifest();
  wiredWithNoJob.researchProgramArtifacts[0].ci = { status: 'wired', job: [] };
  assert.throws(() => renderMechanizedClaims(wiredWithNoJob), /job must be a non-empty array/);
});

test('renderMechanizedClaims fails closed when a manifest section is missing or a path is empty', () => {
  assert.throws(
    () => renderMechanizedClaims({ researchProgramArtifacts: fixtureManifest().researchProgramArtifacts }),
    /formalArtifacts must be a non-empty array/,
  );
  assert.throws(
    () => renderMechanizedClaims({ formalArtifacts: fixtureManifest().formalArtifacts }),
    /researchProgramArtifacts must be a non-empty array/,
  );

  const emptyPaths = fixtureManifest();
  emptyPaths.formalArtifacts[0].paths = [];
  assert.throws(() => renderMechanizedClaims(emptyPaths), /paths must be a non-empty array/);
});

test('validateCorpus fails closed on a duplicate id across the two artifact arrays', () => {
  const dup = fixtureManifest();
  dup.researchProgramArtifacts[0].id = dup.formalArtifacts[0].id;
  assert.throws(() => validateCorpus(dup, 'fixture.json'), /duplicate artifact id/);
});

test('loadCorpus fails closed with a clear error when the manifest file is missing', () => {
  assert.throws(
    () => loadCorpus('/nonexistent/whitepaper-corpus-does-not-exist.json'),
    /cannot read the proof-estate manifest/,
  );
});

test('the real whitepaper/corpus.json renders end to end without drift', () => {
  const rendered = renderMechanizedClaims(loadCorpus());
  assert.match(rendered, /\\section\{Mechanized claims\}\\label\{app:mechanized\}/);
  assert.match(rendered, /41 artifacts in total, 36 wired into continuous integration and 5 retired/);
  // Every method actually present in the real manifest gets its own table.
  for (const method of ['ProVerif', 'Kani', 'Z3', 'EasyCrypt', 'Monte Carlo']) {
    assert.match(rendered, new RegExp(`\\\\captionof\\{table\\}\\{${method} artifacts`));
  }
});

test('renderMechanizedClaims keeps every caption on the page of its first table chunk', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  const captionCount = [...rendered.matchAll(/\\captionof\{table\}/g)].length;
  // Each caption opens inside an unbreakable full-width minipage ...
  const opened = [...rendered.matchAll(/\\noindent\\begin\{minipage\}\{\\textwidth\}\n\\captionof\{table\}/g)].length;
  assert.equal(opened, captionCount, 'every caption is preceded by the minipage opener');
  // ... and that minipage closes right after the FIRST chunk's \end{tabularx},
  // so later chunks (marked "(continued)") keep their own page-break points.
  const closed = [...rendered.matchAll(/\\end\{tabularx\}\n\\end\{minipage\}/g)].length;
  assert.equal(closed, captionCount, 'exactly one minipage close per table, after its first chunk');
  assert.doesNotMatch(rendered, /\(continued\)\}\n\n\\begin\{tabularx\}[^]*?\\end\{tabularx\}\n\\end\{minipage\}/, 'a continuation chunk is never inside the minipage');
});
