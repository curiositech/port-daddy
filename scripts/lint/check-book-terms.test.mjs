import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import { check, maskChunk, readingOrder, termVariants } from './check-book-terms.mjs';

const script = resolve('scripts/lint/check-book-terms.mjs');

// A complete miniature Book, in the order the real generator assembles one:
// the root's front matter, the contents (textbook.json), Chapter 0, each
// chapter between its seams, the solutions, the appendices. Every line that
// a test below names is marked with a comment saying what it exercises.
const FILES = {
  'book/textbook.json': {
    edition: { title: 'A Book About Ledgers' },
    parts: [{
      id: 'p', numeral: 'I', title: 'The Part', blurb: 'This part reaches the escrow account.',
      chapters: ['one'],
    }],
    chapters: [{
      number: 1, id: 'one', prefix: 'one', source: 'book/chapter-one.tex',
      title: 'Chapter One', oneLine: 'A chapter about debts.', question: 'What is owed?',
    }],
  },
  'book/coordination-papers-mega-volume.tex': String.raw`\documentclass{article}
\begin{document}
\section*{Preface}
The preface already speaks of a work unit.
% A comment about the work unit is not prose.
\pdgeneratedinput{../.cache/x/mega-volume-contents.tex}{complete contents}
\input{coordination-papers-mega-volume-chapter-0.tex}
\pdgeneratedinput{../.cache/x/mega-volume-body.tex}{chapter body}
\pdgeneratedinput{../.cache/x/mega-volume-solutions.tex}{solutions}
\input{coordination-papers-mega-volume-appendices.tex}
\end{document}
`,
  'book/coordination-papers-mega-volume-chapter-0.tex': String.raw`\section{Foundations}
Math such as $work unit$ and \ref{sec:work-unit} and \texttt{work unit} is not prose.
The \pdterm{ledger} is the record of who owes what.
\begin{tikzpicture}\node {work unit};\end{tikzpicture}
`,
  'book/coordination-papers-mega-volume-seams.tex': String.raw`\newcommand{\pdchapteropeningone}{%
  \pdbookrail{Q}{The opening seam mentions a bond.}}
\newcommand{\pdchapterhandoffone}{%
  \pdbookrail{Next}{The handoff seam.}}
`,
  'book/chapter-one.tex': String.raw`\documentclass{article}
\begin{document}
\section{The chapter}
We observed it and it was observed.
\ifpdbook
A \pdterm{work unit} is the case file for one task.
\else
A \pdterm{work unit} printed only in the standalone paper.
\fi
Several work units later, the \pdterm{bond} is posted.
\begin{pdsolution}{ex:one}
The answer uses the escrow account early, in a solution.
\end{pdsolution}
An \pdterm{escrow account} holds funds.
The \pdterm{Observed} mode keeps evidence after the act.
A second \pdterm{bond} definition.
\pdterm{orphan term} has no entry.
\input{figures/fig-one}
\end{document}
`,
  'book/figures/fig-one.tex': String.raw`\begin{figure}\caption{A caption that names a ghost entry.}\end{figure}
`,
  'book/coordination-papers-mega-volume-appendices.tex': String.raw`\section{Appendix}
\pdgeneratedinput{../.cache/x/mega-volume-glossary.tex}{glossary}
`,
  'book/glossary/one.json': [
    { term: 'work unit', sort: 'work unit', definition: 'The case file for one task.' },
    { term: 'bond', sort: 'bond', definition: 'Collateral.' },
    { term: 'escrow account', sort: 'escrow account', definition: 'Held funds.' },
    { term: 'Observed', sort: 'Observed (assurance mode)', definition: 'After-the-act evidence only.' },
  ],
  'book/glossary/two.json': [
    { term: 'ledger', sort: 'ledger', definition: 'The record of debts.' },
    { term: 'ghost entry', sort: 'ghost entry', definition: 'Defined nowhere.' },
  ],
};

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'book-terms-'));
  for (const [name, content] of Object.entries(FILES)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
});
after(() => rmSync(root, { recursive: true, force: true }));

function byKind(report, kind) {
  return report.findings.filter((finding) => finding.kind === kind);
}

test('reading order is the assembled Book, with solutions after the chapters', () => {
  const { chunks, warnings } = readingOrder({ root });
  assert.deepEqual(warnings, []);
  const files = chunks.map((chunk) => chunk.file);
  const first = (file) => files.indexOf(file);
  assert.ok(first('book/coordination-papers-mega-volume.tex') === 0);
  assert.ok(first('book/textbook.json') < first('book/coordination-papers-mega-volume-chapter-0.tex'));
  assert.ok(first('book/coordination-papers-mega-volume-chapter-0.tex') < first('book/coordination-papers-mega-volume-seams.tex'));
  assert.ok(first('book/coordination-papers-mega-volume-seams.tex') < first('book/chapter-one.tex'));
  assert.ok(first('book/figures/fig-one.tex') > first('book/chapter-one.tex'));
  const solution = chunks.findIndex((chunk) => chunk.text.slice(chunk.start, chunk.end).includes('in a solution'));
  assert.ok(solution > files.lastIndexOf('book/coordination-papers-mega-volume-seams.tex'));
  assert.ok(solution < first('book/coordination-papers-mega-volume-appendices.tex'));
  // The standalone-only branch is not in the Book.
  assert.ok(!chunks.some((chunk) => chunk.text.slice(chunk.start, chunk.end).includes('standalone paper')));
});

test('comments, math, references, code and TikZ are masked; captions are prose', () => {
  const text = 'A $x y$ and \\ref{a b} and \\texttt{c d} % e f\nand \\caption{g h} \\pdterm[s t]{u v}.';
  const { masked, terms } = maskChunk({ text, start: 0, end: text.length, kind: 'tex' });
  for (const hidden of ['x y', 'a b', 'c d', 'e f', 's t']) assert.ok(!masked.includes(hidden), hidden);
  for (const shown of ['g h', 'u v']) assert.ok(masked.includes(shown), shown);
  assert.equal(masked.length, text.length);
  assert.deepEqual(terms.map(({ sort, term }) => ({ sort, term })), [{ sort: 's t', term: 'u v' }]);
});

test('the key to the symbols is a reference, and its rows are not uses', () => {
  const text = 'A k l.\n\\begin{pdsymbols}{Chapter 1}\n$K$ & m n\\\\\n\\end{pdsymbols}\nAn o p.';
  const { masked } = maskChunk({ text, start: 0, end: text.length, kind: 'tex' });
  assert.ok(!masked.includes('m n'));
  for (const shown of ['k l', 'o p']) assert.ok(masked.includes(shown), shown);
  assert.equal(masked.length, text.length);
});

test('terms match whole words, the last word in simple plurals', () => {
  assert.deepEqual(termVariants('work unit'), [['work', 'unit'], ['work', 'units']]);
  assert.deepEqual(termVariants('policy'), [['policy'], ['policies']]);
  assert.deepEqual(termVariants('single-writer kernel'), [['single', '-', 'writer', 'kernel'], ['single', '-', 'writer', 'kernels']]);
});

test('the four findings, at file:line, in the miniature Book', () => {
  const report = check({ root });
  assert.deepEqual(report.glossaryErrors, []);
  const early = byKind(report, 'early-use');
  const earlyTerms = Object.fromEntries(early.map((finding) => [finding.term, finding]));
  // The preface uses "work unit" before chapter one defines it; the plural in
  // chapter one is after the definition and does not count. Masked uses in
  // chapter 0 (math, \ref, \texttt, TikZ) and the comment do not count.
  assert.equal(earlyTerms['work unit'].file, 'book/coordination-papers-mega-volume.tex');
  assert.equal(earlyTerms['work unit'].line, 4);
  assert.equal(earlyTerms['work unit'].count, 1);
  assert.equal(earlyTerms['work unit'].definedAt, 'book/chapter-one.tex:6');
  // The part blurb (contents) and the opening seam come before the body.
  assert.equal(earlyTerms['escrow account'].file, 'book/textbook.json');
  assert.equal(earlyTerms['escrow account'].count, 1);
  assert.equal(earlyTerms.bond.file, 'book/coordination-papers-mega-volume-seams.tex');
  assert.equal(earlyTerms.bond.line, 2);
  // "observed" in lower case is a verb, not the capitalized assurance mode.
  assert.equal(earlyTerms.Observed, undefined);
  // The ledger is defined in Chapter 0 before any use.
  assert.equal(earlyTerms.ledger, undefined);
  assert.equal(early.length, 3);

  assert.deepEqual(byKind(report, 'duplicate').map(({ file, line, term }) => `${file}:${line} ${term}`),
    ['book/chapter-one.tex:16 bond']);
  assert.deepEqual(byKind(report, 'unlisted').map(({ file, line, term }) => `${file}:${line} ${term}`),
    ['book/chapter-one.tex:17 orphan term']);
  assert.deepEqual(byKind(report, 'undefined').map(({ file, line, term }) => `${file}:${line} ${term}`),
    ['book/glossary/two.json:7 ghost entry']);
});

test('advisory by default, failing with --strict, machine-readable with --json', () => {
  const advisory = spawnSync(process.execPath, [script, '--root', root], { encoding: 'utf8' });
  assert.equal(advisory.status, 0, advisory.stderr);
  assert.match(advisory.stdout, /book\/coordination-papers-mega-volume\.tex:4: \[early-use\] "work unit" is used before its definition at book\/chapter-one\.tex:6/);
  assert.match(advisory.stdout, /3 term\(s\) used before their definition/);
  assert.match(advisory.stdout, /advisory: exit 0/);
  const strict = spawnSync(process.execPath, [script, '--root', root, '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 1);
  const json = spawnSync(process.execPath, [script, '--root', root, '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).findings.length, 6);
  const broken = spawnSync(process.execPath, [script, '--root', join(root, 'missing')], { encoding: 'utf8' });
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /could not run/);
});

test('a clean Book reports nothing and passes --strict', () => {
  const clean = mkdtempSync(join(tmpdir(), 'book-terms-clean-'));
  try {
    for (const [name, content] of Object.entries(FILES)) {
      const path = join(clean, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
    writeFileSync(join(clean, 'book/coordination-papers-mega-volume.tex'), String.raw`\begin{document}
A \pdterm{work unit} is a case file; an \pdterm{escrow account} holds funds.
\pdgeneratedinput{../.cache/x/mega-volume-contents.tex}{complete contents}
\end{document}
`);
    writeFileSync(join(clean, 'book/glossary/one.json'), JSON.stringify([
      { term: 'work unit', sort: 'work unit', definition: 'A case file.' },
      { term: 'escrow account', sort: 'escrow account', definition: 'Held funds.' },
    ]));
    rmSync(join(clean, 'book/glossary/two.json'));
    const run = spawnSync(process.execPath, [script, '--root', clean, '--strict'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout);
    assert.match(run.stdout, /no findings/);
  } finally {
    rmSync(clean, { recursive: true, force: true });
  }
});

// Things the reader never meets as a use of a term: another meaning of the
// same words (other_senses), a chapter title (in textbook.json or in a
// \pdchapref), a book-reference registration, and the abstract and Keywords
// line the assembler strips from every chapter.
test('other senses, titles, references and stripped matter are not early uses', () => {
  const small = mkdtempSync(join(tmpdir(), 'book-terms-senses-'));
  const files = {
    'book/textbook.json': {
      parts: [{ id: 'p', title: 'Ground Rules', blurb: 'A part.', chapters: ['one'] }],
      chapters: [{ number: 1, id: 'one', prefix: 'one', source: 'book/chapter-one.tex', title: 'The Ground Floor' }],
    },
    'book/coordination-papers-mega-volume.tex': String.raw`\begin{document}
\pdgeneratedinput{../.cache/x/mega-volume-contents.tex}{contents}
\input{coordination-papers-mega-volume-chapter-0.tex}
\pdgeneratedinput{../.cache/x/mega-volume-body.tex}{body}
\end{document}
`,
    'book/coordination-papers-mega-volume-chapter-0.tex': String.raw`Ground truth comes first, and the grounds for it.
See \pdchapref{one}{The Ground Floor}.
\pdbookreference{k}{1}{A. Author. \emph{On Ground}. Press, 1999.}{Author 1999}
`,
    'book/chapter-one.tex': String.raw`\begin{document}
\begin{abstract}A ground rule, in the standalone abstract.\end{abstract}
\noindent\textbf{Keywords:} ground, rules
\section{Rules}
A rule is \pdterm{ground} when no variable is left.
\end{document}
`,
    'book/glossary/one.json': [
      { term: 'ground', sort: 'ground', definition: 'With no variables.', other_senses: ['ground truth', 'grounds'] },
    ],
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      const path = join(small, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    }
    const report = check({ root: small });
    assert.deepEqual(report.glossaryErrors, []);
    assert.deepEqual(byKind(report, 'early-use'), []);
    // Without other_senses, "Ground truth" in Chapter 0 is an early use again.
    writeFileSync(join(small, 'book/glossary/one.json'),
      JSON.stringify([{ term: 'ground', sort: 'ground', definition: 'With no variables.' }]));
    const plain = byKind(check({ root: small }), 'early-use');
    assert.equal(plain.length, 1);
    assert.equal(plain[0].file, 'book/coordination-papers-mega-volume-chapter-0.tex');
    assert.equal(plain[0].line, 1);
  } finally {
    rmSync(small, { recursive: true, force: true });
  }
});
