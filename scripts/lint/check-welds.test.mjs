// Tests for scripts/lint/check-welds.mjs and the generator's \weld handling.
//
//   node --test scripts/lint/check-welds.test.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bookWeldLabel,
  checkBookWelds,
  checkWelds,
  dependencyMatrix,
  findSections,
  findWelds,
  FOUNDATIONS_PREFIX,
  indexLabels,
  namespaceWeldLabel,
  plainText,
} from './check-welds.mjs';
import { generate, loadTextbook, namespaceLabels } from '../generate-mega-whitepaper.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lint = resolve(repoRoot, 'scripts/lint/check-welds.mjs');

const unit = (prefix, number, text, files = [], global = false) =>
  ({ prefix, number, title: `Unit ${prefix}`, global, text, files: files.map(([path, body]) => ({ path, text: body })) });

test('findWelds reads both arguments and their line, and skips comments', () => {
  const welds = findWelds([
    'See \\weld{he:sec:bond}{exfiltration bond} for the size.',
    '% \\weld{commented:out}{never}',
    'And \\weld {fh:sec:x}',
    '{a {nested} keyword}. 100\\% \\weld{stp:sec:y}{y}',
  ].join('\n'));
  assert.deepEqual(welds.map(({ line, label, keyword }) => ({ line, label, keyword })), [
    { line: 1, label: 'he:sec:bond', keyword: 'exfiltration bond' },
    { line: 3, label: 'fh:sec:x', keyword: 'a {nested} keyword' },
    { line: 4, label: 'stp:sec:y', keyword: 'y' },
  ]);
  assert.equal(findWelds('\\weld{only:one}').at(0).keyword, null);
  assert.deepEqual(findWelds('\\welder{x}{y}'), []);
});

test('a label names a section only when it is attached to the heading', () => {
  const text = [
    '\\section{The Bond}\\label{sec:bond}',
    'The bond is sized from the canary theorem.',
    '\\subsection[Short]{Sizing the Bond}',
    '% a comment between',
    '\\pdstatus{\\Designed}{specified, not built}',
    '\\phantomsection\\label{sec:sizing}',
    'Detection cost times one over power.',
    '\\begin{theorem}\\label{thm:size}A theorem.\\end{theorem}',
    '\\subsection{Next}\\label{sec:next}',
    'Unrelated text.',
    '\\section*{Notes}\\label{sec:notes}',
    'Some notes.',
    '\\section{Last}',
    'Prose first.\\label{sec:late}',
  ].join('\n');
  const labels = indexLabels(text);
  assert.equal(labels.get('sec:bond').kind, 'section');
  assert.equal(labels.get('sec:sizing').kind, 'section');
  assert.equal(labels.get('sec:sizing').command, 'subsection');
  assert.equal(labels.get('thm:size').kind, 'other');
  assert.equal(labels.get('sec:notes').kind, 'unnumbered');
  assert.equal(labels.get('sec:late').kind, 'other');
  // A section's text runs through its subsections to the next \section; a
  // subsection's stops at the next subsection.
  assert.match(labels.get('sec:bond').text, /Unrelated text/);
  assert.doesNotMatch(labels.get('sec:bond').text, /Some notes/);
  assert.match(labels.get('sec:sizing').text, /Detection cost/);
  assert.doesNotMatch(labels.get('sec:sizing').text, /Unrelated/);
  assert.equal(findSections(text).length, 5);
});

test('plainText strips markup, label names and citation keys, so a key cannot satisfy a keyword', () => {
  const plain = plainText('The \\emph{work-unit} rule~\\pdcite{becker1968crime} (\\S\\ref{sec:tombstone}) % tombstone\n');
  assert.equal(plain, 'the work unit rule ( )');
  assert.equal(plain.includes('becker'), false);
  assert.equal(plain.includes('tombstone'), false);
  // Nor can a weld's own keyword, when the weld sits inside its target.
  assert.equal(plainText('x \\weld{sec:a}{omega bond} y'), 'x y');
});

test('the generator namespaces a weld label exactly as it namespaces a \\ref', () => {
  const prefixes = ['swk', 'he', 'fh'];
  assert.equal(namespaceWeldLabel('sec:own', 'he', prefixes), 'he:sec:own');
  assert.equal(namespaceWeldLabel('fh:sec:x', 'he', prefixes), 'fh:sec:x');
  assert.equal(namespaceWeldLabel(`${FOUNDATIONS_PREFIX}:sec:prereq-lineage`, 'he', prefixes), 'prereq:sec:prereq-lineage');
  assert.equal(
    namespaceLabels('See \\weld{sec:own}{own} and \\weld{fh:sec:x}{x} and \\weld{prereq:sec:p}{p}.', 'he', prefixes),
    'See \\weld{he:sec:own}{own} and \\weld{fh:sec:x}{x} and \\weld{prereq:sec:p}{p}.',
  );
  // The keyword is prose: a colon in it is not a label.
  assert.equal(namespaceLabels('\\weld{sec:a}{ratio: 3}', 'he', prefixes), '\\weld{he:sec:a}{ratio: 3}');
});

test('the label TeX looks up drops the Chapter 0 prefix, whoever points', () => {
  const chapter = { prefix: 'he', global: false };
  const foundations = { prefix: FOUNDATIONS_PREFIX, global: true };
  assert.equal(bookWeldLabel('prereq:sec:prereq-lineage', chapter, ['he']), 'sec:prereq-lineage');
  assert.equal(bookWeldLabel('prereq:sec:prereq-lineage', foundations, ['he']), 'sec:prereq-lineage');
  assert.equal(bookWeldLabel('he:sec:x', foundations, ['he']), 'he:sec:x');
  assert.equal(bookWeldLabel('sec:x', chapter, ['he']), 'he:sec:x');
});

test('checkWelds names every broken weld by file, line and reason, and counts the good ones', () => {
  const units = [
    unit('prereq', 0, '\\section{Two Traditions}\\label{sec:prereq-lineage}\nBDI agents and coding agents.', [], true),
    unit('he', 6, [
      '\\section{Bonds}\\label{he:sec:bonds}',
      'The exfiltration bond is sized here.',
      '\\begin{theorem}\\label{he:thm:t}x\\end{theorem}',
      '\\section*{Notes}\\label{he:sec:notes}',
    ].join('\n'), [['/b/he.tex', '\\weld{prereq:sec:prereq-lineage}{coding agents}']]),
    unit('fh', 8, '\\section{Transfer}\\label{fh:sec:xfer}\nThe four-message ceremony.', [['/b/fh.tex', [
      '\\weld{he:sec:bonds}{exfiltration bond}',
      '\\weld{he:sec:missing}{x}',
      '\\weld{he:thm:t}{x}',
      '\\weld{he:sec:notes}{x}',
      '\\weld{he:sec:bonds}{tombstone}',
      '\\weld{app:volume-status}{boundary}',
      '\\weld{chap:he}{economy}',
      '\\weld{sec:xfer}{four message}',
      '\\weld{he:sec:bonds}{}',
    ].join('\n')]]),
    unit('appendices', null, '\\section{Boundary}\\label{app:volume-status}\nThe implementation boundary.', [], true),
  ];
  const { findings, welds, matrix } = checkWelds(units, { root: '/' });
  assert.deepEqual(findings.map((f) => `${f.at} ${f.kind}`), [
    'b/fh.tex:2 missing',
    'b/fh.tex:3 not-section',
    'b/fh.tex:4 not-section',
    'b/fh.tex:5 keyword',
    'b/fh.tex:6 missing',
    'b/fh.tex:7 not-section',
    'b/fh.tex:9 malformed',
  ]);
  assert.match(findings[4].message, /volume appendices are not namespaced/);
  assert.match(findings[2].message, /unnumbered/);
  assert.match(findings[3].message, /does not contain "tombstone"/);
  assert.deepEqual(welds.map((w) => `${w.from}->${w.to} ${w.label}`), [
    'he->prereq sec:prereq-lineage',
    'fh->he he:sec:bonds',
    'fh->fh fh:sec:xfer',
  ]);
  assert.deepEqual(matrix.units.map((u) => u.prefix), ['prereq', 'he', 'fh', 'appendices']);
  assert.deepEqual(matrix.matrix, [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ]);
});

test('dependencyMatrix keeps Book order and an empty Book is an all-zero matrix', () => {
  const m = dependencyMatrix([unit('a', 1, ''), unit('b', 2, '')], []);
  assert.deepEqual(m.matrix, [[0, 0], [0, 0]]);
  assert.equal(m.generatedBy, 'scripts/lint/check-welds.mjs');
});

test('the whole path, source file to namespaced body to finding, on a fixture Book', () => {
  const root = mkdtempSync(join(tmpdir(), 'check-welds-'));
  try {
    mkdirSync(join(root, 'book/figures'), { recursive: true });
    const write = (rel, text) => writeFileSync(join(root, rel), text, 'utf8');
    write('book/coordination-papers-mega-volume-chapter-0.tex', '\\section{Ground}\\label{sec:prereq-ground}\nGround rules.\n');
    write('book/coordination-papers-mega-volume-appendices.tex', '\\section{Atlas}\\label{app:atlas}\n');
    write('book/a.tex', '\\section{Alpha}\\label{sec:alpha}\nSee \\weld{b:sec:beta}{tombstones}.\n\\input{figures/fig-a}\n');
    write('book/figures/fig-a.tex', 'A caption that points at \\weld{sec:alpha}{omega}.\n');
    write('book/b.tex', '\\section{Beta}\\label{sec:beta}\nTombstones travel on revocation. \\weld{prereq:sec:prereq-ground}{ground}\n');
    const textbook = { chapters: [
      { id: 'a', prefix: 'a', number: 1, title: 'A', source: 'book/a.tex' },
      { id: 'b', prefix: 'b', number: 2, title: 'B', source: 'book/b.tex' },
    ] };
    const read = (rel) => readFileSync(join(root, rel), 'utf8');
    const chapterBodies = new Map([
      ['a', namespaceLabels(read('book/a.tex') + read('book/figures/fig-a.tex'), 'a', ['a', 'b'])],
      ['b', namespaceLabels(read('book/b.tex'), 'b', ['a', 'b'])],
    ]);
    const { findings, welds } = checkBookWelds({ textbook, chapterBodies, root });
    assert.deepEqual(findings.map((f) => `${f.at} ${f.kind}`), ['book/figures/fig-a.tex:1 keyword']);
    assert.deepEqual(welds.map((w) => `${w.file}:${w.line} ${w.from}->${w.to}`), [
      'book/a.tex:2 a->b',
      'book/b.tex:2 b->prereq',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real Book: the lint runs clean and writes the matrix the generator writes', () => {
  const out = mkdtempSync(join(tmpdir(), 'check-welds-matrix-'));
  try {
    const run = spawnSync(process.execPath, [lint, '--matrix', join(out, 'welds.json')], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /0 finding\(s\)/);
    const matrix = JSON.parse(readFileSync(join(out, 'welds.json'), 'utf8'));
    const textbook = loadTextbook();
    assert.deepEqual(matrix.units.map((u) => u.prefix), ['prereq', ...textbook.chapters.map((c) => c.prefix), 'appendices']);
    assert.equal(matrix.matrix.length, textbook.chapters.length + 2);

    generate({ textbook, out: join(out, 'book') });
    const generated = JSON.parse(readFileSync(join(out, 'book/mega-volume-welds.json'), 'utf8'));
    assert.deepEqual(generated, matrix);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('the Book preamble loads the macro, and the macro is the one the lint describes', () => {
  const preamble = readFileSync(resolve(repoRoot, 'book/coordination-papers-mega-volume-preamble.tex'), 'utf8');
  assert.match(preamble, /\\pdbooktrue[\s\S]*\\input\{figures\/pd-weld\}/);
  const macro = readFileSync(resolve(repoRoot, 'book/figures/pd-weld.tex'), 'utf8');
  assert.match(macro, /\\NewDocumentCommand \\weld \{ m m \}/);
  assert.match(macro, /\\int_const:Nn \\c__pd_weld_far_int \{ 3 \}/);
  assert.match(macro, new RegExp(`\\\\tl_const:Nn \\\\c__pd_weld_foundations_tl \\{ ${FOUNDATIONS_PREFIX} \\}`));
  // Chapter 0 really is the prereq chapter the prefix names.
  const foundations = readFileSync(resolve(repoRoot, 'book/coordination-papers-mega-volume-chapter-0.tex'), 'utf8');
  assert.match(foundations, new RegExp(`\\\\pdchapter\\{0\\}\\{[\\s\\S]*?\\}\\{${FOUNDATIONS_PREFIX}\\}`));
  assert.ok(existsSync(lint));
});
