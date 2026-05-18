#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = JSON.parse(readFileSync(join(ROOT_DIR, 'package.json'), 'utf8'));
const OUT_DIR = join(ROOT_DIR, 'public', 'samples');
const FILES_DIR = join(OUT_DIR, 'files');
const SOURCES = ['examples', 'templates'];
const ALLOWED_EXTENSIONS = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.py',
  '.sh',
  '.toml',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);
const SKIP_DIRS = new Set(['.git', '.portdaddy', 'node_modules', '__pycache__']);
const SKIP_FILES = new Set(['.DS_Store']);
const ALLOWED_FILENAMES = new Set(['post-commit-hook']);

function extname(file) {
  const index = file.lastIndexOf('.');
  return index >= 0 ? file.slice(index) : '';
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (!ALLOWED_FILENAMES.has(entry.name) && !ALLOWED_EXTENSIONS.has(extname(entry.name))) continue;
    files.push(path);
  }
  return files;
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(FILES_DIR, { recursive: true });

const manifestFiles = [];
for (const source of SOURCES) {
  const sourceRoot = join(ROOT_DIR, source);
  if (!existsSync(sourceRoot)) continue;
  for (const absolutePath of walk(sourceRoot)) {
    const repoPath = relative(ROOT_DIR, absolutePath);
    const outputPath = join(FILES_DIR, repoPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(absolutePath, outputPath);
    const stats = statSync(absolutePath);
    manifestFiles.push({
      path: repoPath,
      url: `/samples/files/${repoPath}`,
      bytes: stats.size,
      sha256: sha256(absolutePath),
    });
  }
}

manifestFiles.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
  version: 1,
  packageVersion: PACKAGE_JSON.version,
  sources: SOURCES,
  count: manifestFiles.length,
  files: manifestFiles,
}, null, 2)}\n`);

console.log(`Bundled ${manifestFiles.length} public sample file(s) into ${OUT_DIR}`);
