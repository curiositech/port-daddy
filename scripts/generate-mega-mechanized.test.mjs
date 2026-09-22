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
    rendered.indexOf('\\end{xltabular}', rendered.indexOf('ProVerif artifacts')),
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
  const captions = [...rendered.matchAll(/\\caption\{([^}]*)\}/g)].map((m) => m[1]);
  assert.deepEqual(
    captions.sort(),
    ['Kani artifacts (1 wired, 0 retired).', 'Monte Carlo artifacts (1 wired, 0 retired).', 'ProVerif artifacts (1 wired, 1 retired).'].sort(),
    'one caption per distinct method, each counting its own wired/retired rows',
  );
  // The single ProVerif table holds both the wired and the retired row.
  const table = collapseBreakHints(rendered.slice(
    rendered.indexOf('ProVerif artifacts'),
    rendered.indexOf('\\end{xltabular}', rendered.indexOf('ProVerif artifacts')),
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

test('renderMechanizedClaims keeps short path groups together in wide labeled rows', () => {
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
  const rendered = collapseBreakHints(renderMechanizedClaims(manifest));
  assert.match(rendered, /Artifact & \\path\{proofs\/multifixture\/Model\.tla\} \\\\\*\nArtifact & \\path\{proofs\/multifixture\/Model\.cfg\} \\\\\*/);
  assert.doesNotMatch(rendered, /\\footnotesize|\\scriptsize|\\tiny/);
});

test('renderMechanizedClaims retains full paths even when directories differ', () => {
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
  assert.match(rendered, /Artifact & \\path\{analyses\/one\.pv\} \\\\\*\nArtifact & \\path\{proofs\/two\.tla\} \\\\\*/);
  assert.doesNotMatch(rendered, /files\}/);
});

test('renderMechanizedClaims states retirement reasons without inventing or repeating evidence policies', () => {
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
  // A missing evidencePolicy is omitted, not replaced with invented text.
  assert.match(rendered, /\\texttt\{monte-fixture\}/);
  assert.match(rendered, /Status & \\textsc\{current\} \\\\\*/);
  assert.match(rendered, /Artifact & \\path\{proofs\/fixture\/simulate\.mjs\}/);
  assert.ok(rendered.includes('CI & \\texttt{monte-carlo-fixture} \\\\'));
  assert.doesNotMatch(rendered, /Evidence & ---/);
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
    assert.match(rendered, new RegExp(`\\\\caption\\{${method} artifacts`));
  }
});

test('renderMechanizedClaims uses one caption and first head for each page-breaking record table', () => {
  const rendered = renderMechanizedClaims(fixtureManifest());
  const tables = rendered.split('\\begin{xltabular}').slice(1);
  assert.equal(tables.length, 3);
  for (const table of tables) {
    assert.equal((table.match(/\\caption\{/g) ?? []).length, 1);
    assert.ok(table.indexOf('\\caption{') < table.indexOf('\\endfirsthead'));
    assert.match(table, /\\endhead/);
    assert.match(table, /\\textbf\{Field\} & \\textbf\{Artifact record\}/);
  }
  assert.doesNotMatch(rendered, /\\begin\{minipage\}|\\captionof/);
});

test('record layout retains every manifest field without ordinary word fragmentation', () => {
  const manifest = fixtureManifest();
  manifest.formalArtifacts[0].evidencePolicy = 'Verification establishes only the stated boundary.';
  const rendered = collapseBreakHints(renderMechanizedClaims(manifest));
  for (const row of [...manifest.formalArtifacts, ...manifest.researchProgramArtifacts]) {
    assert.ok(rendered.includes(row.id));
    for (const path of row.paths) assert.ok(rendered.includes(path));
    if (row.ci.status === 'wired') {
      for (const job of row.ci.job) assert.ok(rendered.includes(job));
    }
    assert.ok(rendered.includes(`\\textsc{${row.status}}`));
  }
  assert.match(rendered, /retired --- superseded \\& no longer run/);
  assert.ok(renderMechanizedClaims(manifest).includes('Verification establishes only the stated boundary.'));
  assert.ok(renderMechanizedClaims(manifest).includes('foremost'));
});
