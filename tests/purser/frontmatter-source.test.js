import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  resolve('website-v2/public/whitepaper/coordination-papers-mega-frontmatter.tex'),
  'utf8',
);

test('title page carries the collected-volume identity and publication metadata', () => {
  assert.match(source, /\\begin\{titlepage\}/);
  assert.match(source, /The Harbor, the Person,\\\\\[0\.15cm\]and the Economy/);
  assert.match(source, /The Collected Coordination Papers/);
  assert.match(source, /Erich Owens.*Version 1\.0/s);
  assert.match(source, /engineering@portdaddy\.dev/);
});

test('abstract states the seven-paper assurance progression without overclaiming', () => {
  assert.match(source, /\\begin\{abstract\}/);
  assert.match(source, /single local writer decides what is true/);
  assert.match(source, /legibility layer lets the\s+operator see and revoke/s);
  assert.match(source, /continuity turns an ephemeral\s+spawn into an accountable participant/s);
  assert.match(source, /separates running mechanisms from partial integrations,\s+precise specifications, and research proposals/s);
});

test('global navigation includes contents, figures, tables, and the reading guide', () => {
  assert.match(source, /\\section\*\{How to use this volume\}/);
  assert.match(source, /\\addcontentsline\{toc\}\{section\}\{How to use this volume\}/);
  assert.match(source, /\\tableofcontents/);
  assert.match(source, /\\listoffigures/);
  assert.match(source, /\\listoftables/);
});

test('claim discipline defines all four maturity grades in reader-facing prose', () => {
  for (const marker of ['\\Built{}', '\\BuiltWeak{}', '\\Designed{}', '\\Vision{}']) {
    assert.ok(source.includes(marker), `missing maturity marker ${marker}`);
  }
  assert.match(source, /A closed model result\s+is never silently promoted to a whole-runtime guarantee/s);
});

test('argument map names all seven chapters and its assurance semantics', () => {
  for (const chapter of [
    'I. Legible Swarm',
    'II. Single-Writer Kernel',
    'III. Spawn to Person',
    'IV. Harbor Economy',
    'V. Anchor Protocol',
    'VI. Bonded Commons',
    'VII. Federated Harbor',
  ]) {
    assert.ok(source.includes(chapter), `missing argument-map chapter ${chapter}`);
  }
  assert.match(source, /The volume's argument and assurance spine/);
  assert.match(source, /Solid arrows build upward;\s+dashed cobalt arrows discharge or delimit a load-bearing obligation/s);
});

test('front matter transitions from roman to arabic pages and restores anchors', () => {
  const roman = source.indexOf('\\pagenumbering{roman}');
  const arabic = source.indexOf('\\pagenumbering{arabic}');
  assert.ok(roman >= 0 && arabic > roman);
  assert.match(source, /\\hypersetup\{pageanchor=false\}/);
  assert.match(source, /\\hypersetup\{pageanchor=true\}/);
});
