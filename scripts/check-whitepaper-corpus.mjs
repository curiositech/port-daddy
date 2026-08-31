#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'whitepaper/corpus.json');
const corpus = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

function requirePath(path, kind = 'path') {
  const absolute = resolve(repoRoot, path);
  if (!existsSync(absolute)) {
    failures.push(`${kind} is missing: ${path}`);
  }
  return absolute;
}

function requireFile(path, kind = 'file') {
  const absolute = requirePath(path, kind);
  if (existsSync(absolute) && !statSync(absolute).isFile()) {
    failures.push(`${kind} is not a file: ${path}`);
  }
}

function filesBelow(root) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

if (corpus.canonicalRoot !== 'whitepaper') {
  failures.push(`canonicalRoot must be whitepaper, got ${corpus.canonicalRoot}`);
}
if (corpus.chapters.length !== 7) {
  failures.push(`expected exactly seven chapters, got ${corpus.chapters.length}`);
}

const ids = new Set();
const chapterNumbers = new Set();
const sources = new Set();
const publications = new Set();
for (const chapter of corpus.chapters) {
  if (ids.has(chapter.id)) failures.push(`duplicate chapter id: ${chapter.id}`);
  if (chapterNumbers.has(chapter.chapter)) failures.push(`duplicate chapter number: ${chapter.chapter}`);
  if (sources.has(chapter.source)) failures.push(`duplicate chapter source: ${chapter.source}`);
  if (publications.has(chapter.published)) failures.push(`duplicate chapter publication: ${chapter.published}`);
  ids.add(chapter.id);
  chapterNumbers.add(chapter.chapter);
  sources.add(chapter.source);
  publications.add(chapter.published);
  requireFile(chapter.source, `source for ${chapter.id}`);
  requireFile(chapter.published, `publication for ${chapter.id}`);
}

requireFile(corpus.collectedVolume.source, 'collected-volume source');
requireFile(corpus.collectedVolume.published, 'collected-volume publication');
for (const path of corpus.collectedVolume.supportingSources) requireFile(path, 'collected-volume support');
for (const publication of corpus.researchPublications) requireFile(publication.source, `research publication ${publication.id}`);
requireFile(corpus.currentReview.critical, 'current critical review');
requirePath(corpus.currentReview.exposition, 'current exposition review directory');
for (const path of Object.values(corpus.currentProof)) requireFile(path, 'current visual proof');
for (const atlas of corpus.atlases) {
  requireFile(atlas.path, `atlas ${atlas.id}`);
  if (atlas.checker) requireFile(atlas.checker, `atlas checker ${atlas.id}`);
}
for (const satellite of corpus.platformSatellites) requireFile(satellite, 'platform satellite');
requireFile('whitepaper/corpus.schema.json', 'corpus schema');

for (const legacyRoot of corpus.forbiddenLegacyRoots) {
  if (existsSync(resolve(repoRoot, legacyRoot))) failures.push(`forbidden legacy root still exists: ${legacyRoot}`);
}

const publicWhitepaperDir = resolve(repoRoot, 'website-v2/public/whitepaper');
const publicResearchDir = resolve(repoRoot, 'website-v2/public/research');
const authoredMirrorFiles = [publicWhitepaperDir, publicResearchDir]
  .flatMap(filesBelow)
  .filter((path) => /\.(?:tex|bib|py|md)$/u.test(path));
if (authoredMirrorFiles.length > 0) {
  failures.push(`authored files exist in generated deployment mirrors: ${authoredMirrorFiles.map((path) => path.slice(repoRoot.length + 1)).join(', ')}`);
}

const mirrorPairs = [
  ...corpus.chapters.map((chapter) => [chapter.published, chapter.publicPath]),
  [corpus.collectedVolume.published, corpus.collectedVolume.publicPath],
  ...corpus.researchPublications.map((publication) => [publication.source, publication.publicPath]),
];
const mirrorRepoPaths = mirrorPairs.map(([, publicPath]) => `website-v2/public/${publicPath.replace(/^\//u, '')}`);
const trackedMirrors = execFileSync('git', ['ls-files', '--', ...mirrorRepoPaths], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim().split('\n').filter(Boolean);
if (trackedMirrors.length > 0) {
  failures.push(`generated deployment mirrors are tracked: ${trackedMirrors.join(', ')}`);
}
for (const [source, publicPath] of mirrorPairs) {
  const sourcePath = resolve(repoRoot, source);
  const mirrorPath = resolve(repoRoot, 'website-v2/public', publicPath.replace(/^\//u, ''));
  if (existsSync(mirrorPath) && digest(sourcePath) !== digest(mirrorPath)) {
    failures.push(`generated mirror drift: ${publicPath} differs from ${source}`);
  }
}

const buildScript = readFileSync(resolve(repoRoot, 'scripts/build-whitepapers.sh'), 'utf8');
for (const source of sources) {
  const basename = source.slice(source.lastIndexOf('/') + 1);
  if (!buildScript.includes(basename)) failures.push(`build table does not mention ${basename}`);
}
if (!buildScript.includes('whitepaper/source') || !buildScript.includes('whitepaper/published')) {
  failures.push('build script does not use the canonical source and publication directories');
}

if (failures.length > 0) {
  console.error('Whitepaper corpus contract failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`Whitepaper corpus contract passed: ${corpus.chapters.length} chapters, 1 collected volume, ${corpus.researchPublications.length} public research papers.`);
