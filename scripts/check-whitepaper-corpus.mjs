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
for (const [name, path] of Object.entries(corpus.directories)) {
  requirePath(path, `corpus directory ${name}`);
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
const formalArtifactIds = new Set();
const registeredFormalRoots = [];
for (const artifact of corpus.formalArtifacts) {
  if (formalArtifactIds.has(artifact.id)) failures.push(`duplicate formal artifact id: ${artifact.id}`);
  formalArtifactIds.add(artifact.id);
  const artifactPath = requirePath(artifact.path, `formal artifact ${artifact.id}`);
  registeredFormalRoots.push(artifactPath);
  for (const chapterId of artifact.chapterIds) {
    if (!ids.has(chapterId)) failures.push(`formal artifact ${artifact.id} names unknown chapter: ${chapterId}`);
  }
  for (const test of artifact.conformanceTests ?? []) requireFile(test, `conformance test for ${artifact.id}`);
}
const researchArtifactIds = new Set();
const registeredResearchRoots = [];
for (const artifact of corpus.researchProgramArtifacts) {
  if (researchArtifactIds.has(artifact.id)) failures.push(`duplicate research artifact id: ${artifact.id}`);
  researchArtifactIds.add(artifact.id);
  registeredResearchRoots.push(requirePath(artifact.path, `research-program artifact ${artifact.id}`));
}
const skillSatelliteIds = new Set();
for (const satellite of corpus.skillSatellites) {
  if (skillSatelliteIds.has(satellite.id)) failures.push(`duplicate skill satellite id: ${satellite.id}`);
  skillSatelliteIds.add(satellite.id);
  const satellitePath = requirePath(satellite.path, `skill satellite ${satellite.id}`);
  requireFile(`${satellite.path}/${satellite.contracts.entrypoint}`, `entrypoint for skill satellite ${satellite.id}`);
  for (const chapterId of satellite.scope.chapterIds) {
    if (!ids.has(chapterId)) failures.push(`skill satellite ${satellite.id} names unknown chapter: ${chapterId}`);
  }
  for (const stalePath of satellite.currentness.stalePaths) {
    failures.push(`skill satellite ${satellite.id} still declares stale path: ${stalePath}`);
  }
  for (const placeholderPath of satellite.currentness.placeholderPaths) {
    if (placeholderPath.startsWith('/') || placeholderPath.includes('..')) {
      failures.push(`skill satellite ${satellite.id} has non-repository placeholder path: ${placeholderPath}`);
    }
  }
  for (const example of satellite.examples ?? []) {
    requireFile(`${satellite.path}/${example.path}`, `example for skill satellite ${satellite.id}`);
  }
  if (existsSync(satellitePath) && satellite.status === 'current' && satellite.classification === 'D-historical') {
    failures.push(`current skill satellite ${satellite.id} cannot be classified as historical`);
  }
}
for (const atlas of corpus.atlases) {
  requireFile(atlas.path, `atlas ${atlas.id}`);
  if (atlas.checker) requireFile(atlas.checker, `atlas checker ${atlas.id}`);
}
for (const satellite of corpus.platformSatellites) requireFile(satellite, 'platform satellite');
requireFile('whitepaper/corpus.schema.json', 'corpus schema');

const formalDiscoveryRoots = [
  corpus.directories.formal,
  'apps/relay/formal',
  'core/kernel/pd-anchor/formal',
  'lib/agent-harbor/formal',
].map((path) => resolve(repoRoot, path));
const formalExtensions = /\.(?:pv|tla|cfg|ec|z3|smt2)$/u;
const unregisteredFormalFiles = formalDiscoveryRoots
  .flatMap(filesBelow)
  .filter((path) => formalExtensions.test(path))
  .filter((path) => !registeredFormalRoots.some((root) => path === root || path.startsWith(`${root}/`)));
if (unregisteredFormalFiles.length > 0) {
  failures.push(`unregistered formal artifacts: ${unregisteredFormalFiles.map((path) => path.slice(repoRoot.length + 1)).join(', ')}`);
}

const simulationRoot = resolve(repoRoot, corpus.directories.researchProgram, 'simulations');
const unregisteredSimulationFiles = filesBelow(simulationRoot)
  .filter((path) => /\.(?:mjs|py|ipynb)$/u.test(path))
  .filter((path) => !registeredResearchRoots.some((root) => path === root || path.startsWith(`${root}/`)));
if (unregisteredSimulationFiles.length > 0) {
  failures.push(`unregistered research simulations: ${unregisteredSimulationFiles.map((path) => path.slice(repoRoot.length + 1)).join(', ')}`);
}

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

console.log(`Whitepaper corpus contract passed: ${corpus.chapters.length} chapters, 1 collected volume, ${corpus.researchPublications.length} public research papers, ${corpus.formalArtifacts.length} formal artifact groups, ${corpus.researchProgramArtifacts.length} research-program groups, ${corpus.skillSatellites.length} skill satellites.`);
