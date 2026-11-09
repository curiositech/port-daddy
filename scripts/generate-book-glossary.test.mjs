import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  loadGlossary,
  lookupKeys,
  pluralOf,
  renderGlossary,
  termKey,
  texField,
  writeGlossary,
} from './generate-book-glossary.mjs';

// The two committed fixture files. The chapters' real book/glossary/*.json
// files arrive with the chapter rewrites; these exercise every rule without
// depending on them.
const FIXTURES = resolve('tests/fixtures/book-glossary');
const script = resolve('scripts/generate-book-glossary.mjs');

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), 'book-glossary-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return dir;
}

test('termKey is the TeX key: lower case, one hyphen per run of anything else, trimmed', () => {
  assert.equal(termKey('Single-Writer Kernel'), 'single-writer-kernel');
  assert.equal(termKey('single-writer kernel'), 'single-writer-kernel');
  assert.equal(termKey('  --claim (on work)-- '), 'claim-on-work');
  // Markup contributes its letters, exactly as \detokenize shows it to TeX.
  assert.equal(termKey('\\emph{x} y'), 'emph-x-y');
  assert.equal(termKey('m\\^etis'), 'm-etis');
  assert.equal(termKey('$\\delta^{*}$'), 'delta');
  assert.equal(termKey('δ'), '');
});

test('the TeX side derives the key with the same three steps', () => {
  // A drift here would make every glossary page reference silently vanish,
  // because the lookup finds no label and prints no page (by design).
  const pedagogy = readFileSync(resolve('book/figures/pd-pedagogy.tex'), 'utf8');
  assert.match(pedagogy, /\\str_set:Nx #1 \{ \\str_lowercase:n \{#2\} \}/);
  assert.match(pedagogy, /\\regex_const:Nn \\c__pd_term_nonword_regex \{ \[\^a-z0-9\]\+ \}/);
  assert.match(pedagogy, /\\regex_const:Nn \\c__pd_term_edge_regex \{ \\A\\-\+ \| \\-\+\\Z \}/);
  assert.match(pedagogy, /\\label \{ pdterm: \\l__pd_term_sortkey_str \}/);
  assert.match(pedagogy, /\\label \{ pdterm: \\l__pd_term_key_str \}/);
  assert.match(pedagogy, /\\cs_if_exist:cT \{ r@pdterm:##1 \}/);
});

test('lookups add the simple plural of each key after the keys themselves', () => {
  assert.equal(pluralOf('vector-clock'), 'vector-clocks');
  assert.equal(pluralOf('process'), 'processes');
  assert.equal(pluralOf('policy'), 'policies');
  assert.equal(pluralOf('day'), 'days');
  assert.deepEqual(lookupKeys({ term: 'Observed', sort: 'Observed (assurance mode)' }),
    ['observed-assurance-mode', 'observed', 'observed-assurance-modes', 'observeds']);
});

test('the fixture glossary loads, sorts by sort key and renders every field safely', () => {
  const { entries, errors, warnings, files } = loadGlossary(FIXTURES);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(files.length, 2);
  assert.equal(entries.length, 7);
  const tex = renderGlossary(entries);
  const order = [...tex.matchAll(/\\pdglossaryentry\{([^\n]*?)\}\{/g)].map((match) => match[1]);
  // "$\delta^{*}$ threshold" sorts under its sort key, "delta threshold".
  assert.deepEqual(order, ['admission', '$\\delta^{*}$ threshold', 'Observed', 'single-writer kernel',
    'unprinted fixture term', 'vector clock', 'work unit']);
  assert.deepEqual([...tex.matchAll(/\\pdglossarygroup\{([^}]+)\}/g)].map((match) => match[1]),
    ['A', 'D', 'O', 'S', 'U', 'V', 'W']);
  assert.match(tex, /checked against 100\\% of the stated rules before the change touches the shared record \\& its copies\./);
  assert.match(tex, /\{single-writer-kernel,single-writer-kernels\}\n/);
  assert.match(tex, /^\\clearpage\n\\pdbackmatterheaders\{Glossary\}\n\\phantomsection\\label\{book:glossary\}\n\\section\*\{Glossary\}$/m);
});

test('plain fields escape TeX specials; $...$ is math; a backslash means TeX as written', () => {
  assert.equal(texField('50% of A & B_c #1 {x} ~ ^'),
    '50\\% of A \\& B\\_c \\#1 \\{x\\} \\textasciitilde{} \\textasciicircum{}');
  assert.equal(texField('the $k$-of-$n$ rule costs $5 and $10'), 'the $k$-of-$n$ rule costs \\$5 and \\$10');
  assert.equal(texField('an \\emph{effect}'), 'an \\emph{effect}');
  assert.equal(texField('\u201cquoted\u201d \u2014 and \u2013'), "``quoted'' --- and --");
});

test('an empty glossary prints nothing, the same rule as the solutions appendix', () => {
  const dir = scratch({});
  try {
    assert.equal(renderGlossary(loadGlossary(dir).entries),
      '% No entries in book/glossary/*.json; nothing to print in the glossary.\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('malformed glossaries fail with file:line and the reason', () => {
  const dir = scratch({
    'a.json': [
      { term: 'kernel', sort: 'kernel', definition: 'One.' },
      { term: 'ledger', sort: 'ledger', definition: '' },
      { term: 'grant', sort: 'grant', definition: 'Has an extra field.', see: 'card' },
      { term: '\\emph{broken', sort: 'broken', definition: 'Unbalanced.' },
      { term: 'δ', sort: '∗', definition: 'Nothing to key by.' },
    ],
    'b.json': [{ term: 'Kernel', sort: 'kernel', definition: 'Collides with a.json.' }],
    'c.json': '{"term": "not a list"}',
    'd.json': '[{',
  });
  try {
    const { errors, warnings, entries } = loadGlossary(dir);
    const text = errors.join('\n');
    assert.match(text, /a\.json:\d+: "definition" must be a non-empty string/);
    assert.match(text, /a\.json:\d+: "term" of "\\emph\{broken" would break TeX \(unbalanced braces\)/);
    assert.match(text, /a\.json:\d+: "δ" has no letters or digits to key it by/);
    assert.match(text, /b\.json:2: "Kernel" collides with "kernel" \(.*a\.json:2\) on key "kernel"/);
    assert.match(text, /c\.json: must be a JSON list/);
    assert.match(text, /d\.json: invalid JSON/);
    assert.match(warnings.join('\n'), /a\.json:\d+: ignored field\(s\) "see"/);
    assert.deepEqual(entries.map((entry) => entry.term), ['kernel', 'grant', 'Kernel']);
    assert.throws(() => writeGlossary({ dir, out: join(dir, 'out') }), /book\/glossary is malformed/);
    const run = spawnSync(process.execPath, [script, '--check', '--glossary-dir', dir], { encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /defect\(s\) in 4 file\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--check passes the fixtures and writing produces the appendix file', () => {
  const run = spawnSync(process.execPath, [script, '--check', '--glossary-dir', FIXTURES], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /7 entries in 2 file\(s\), all well-formed/);
  const out = mkdtempSync(join(tmpdir(), 'book-glossary-out-'));
  try {
    const { path, entries } = writeGlossary({ dir: FIXTURES, out });
    assert.equal(entries, 7);
    assert.match(readFileSync(path, 'utf8'), /\\pdglossaryentry\{work unit\}/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the Book prints the glossary after the appendices and before any bibliography, and the index last', () => {
  const appendices = readFileSync(resolve('book/coordination-papers-mega-volume-appendices.tex'), 'utf8');
  const players = appendices.indexOf('\\input{additions/app-players}');
  const glossary = appendices.indexOf('mega-volume-glossary.tex}{glossary}');
  const bibliography = appendices.indexOf('mega-volume-bibliography.tex}{bibliography}');
  assert.ok(players > 0 && glossary > players && bibliography > glossary);
  const root = readFileSync(resolve('book/coordination-papers-mega-volume.tex'), 'utf8');
  const index = root.indexOf('\\pdprintbookindex');
  assert.ok(index > root.indexOf('\\input{coordination-papers-mega-volume-appendices.tex}'));
  assert.ok(index < root.indexOf('\\endgroup', index));
  assert.equal(root.slice(root.indexOf('\\endgroup', index)).trim(), '\\endgroup\n\\end{document}');
  const generator = readFileSync(resolve('scripts/generate-mega-whitepaper.mjs'), 'utf8');
  assert.match(generator, /writeFileSync\(resolve\(out, 'mega-volume-glossary\.tex'\), renderGlossary\(glossary\.entries\)/);
});
