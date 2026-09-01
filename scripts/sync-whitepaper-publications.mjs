#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'whitepaper/corpus.json');
const corpus = JSON.parse(readFileSync(manifestPath, 'utf8'));

function copyPublication(source, publicPath) {
  if (!publicPath.startsWith('/whitepaper/') && !publicPath.startsWith('/research/')) {
    throw new Error(`refusing publication path outside declared mirrors: ${publicPath}`);
  }
  const sourcePath = resolve(repoRoot, source);
  const destination = resolve(repoRoot, 'website-v2/public', publicPath.replace(/^\//, ''));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(sourcePath, destination);
  console.log(`${source} -> ${destination.slice(repoRoot.length + 1)}`);
}

const publications = [
  ...corpus.chapters.map((chapter) => [chapter.published, chapter.publicPath]),
  [corpus.collectedVolume.published, corpus.collectedVolume.publicPath],
  ...corpus.researchPublications.map((publication) => [publication.source, publication.publicPath]),
];
const expectedDestinations = new Set(publications.map(([, publicPath]) => (
  resolve(repoRoot, 'website-v2/public', publicPath.replace(/^\//u, ''))
)));

for (const mirror of corpus.generatedMirrors) {
  const directory = resolve(repoRoot, mirror.destination);
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.pdf')) continue;
    const path = resolve(directory, entry.name);
    if (!expectedDestinations.has(path)) {
      unlinkSync(path);
      console.log(`removed stale generated mirror ${path.slice(repoRoot.length + 1)}`);
    }
  }
}

for (const [source, publicPath] of publications) {
  copyPublication(source, publicPath);
}
