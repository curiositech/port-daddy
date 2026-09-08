#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const failures = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const files = walk(root);
const markdownFiles = files.filter((file) => file.endsWith('.md'));
const textFiles = files.filter((file) => /\.(?:md|ya?ml|mjs|html)$/.test(file) && !file.includes(`${path.sep}checks${path.sep}`));

for (const file of textFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const transientMarker = new RegExp(`\\b(?:${'file' + 'cite'}|${'mem' + 'cite'})\\b|\\b${'turn'}\\d+\\b`, 'i');
  if (transientMarker.test(text)) {
    failures.push(`${path.relative(root, file)} contains an ephemeral citation`);
  }
}

for (const file of markdownFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const linkPattern = /\[[^\]]+\]\((?!https?:|#|mailto:)([^)#]+)(?:#[^)]+)?\)/g;
  for (const match of text.matchAll(linkPattern)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(target)) {
      failures.push(`${path.relative(root, file)} links to missing ${match[1]}`);
    }
  }
}

const ledgerText = fs.readFileSync(path.join(root, 'ledger.yaml'), 'utf8');
const indexedIds = new Set([...ledgerText.matchAll(/\bGH-[A-Z]+-\d+\b/g)].map((match) => match[0]));
const documentPattern = /^\s+document:\s+([^#\n]+)(?:#([^\n]+))?$/gm;
for (const match of ledgerText.matchAll(documentPattern)) {
  const documentPath = path.join(root, match[1].trim());
  if (!fs.existsSync(documentPath)) {
    failures.push(`ledger.yaml indexes missing ${match[1].trim()}`);
    continue;
  }
  if (match[2]) {
    const expected = match[2].trim().toLowerCase();
    const content = fs.readFileSync(documentPath, 'utf8').toLowerCase();
    const id = expected.replace(/-/g, '-').toUpperCase();
    if (!content.includes(id.toLowerCase())) {
      failures.push(`${match[1].trim()} does not mention indexed anchor ${expected}`);
    }
  }
}

const ids = [];
for (const file of markdownFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^(?:#{1,6}\s+|[-*]\s+\*\*)(GH-[A-Z]+-\d+)\b/gm)) {
    ids.push({ id: match[1], file });
  }
}
const duplicateMap = new Map();
for (const record of ids) {
  const list = duplicateMap.get(record.id) ?? [];
  list.push(record.file);
  duplicateMap.set(record.id, list);
}
for (const [id, duplicateFiles] of duplicateMap) {
  if (new Set(duplicateFiles).size > 1) {
    failures.push(`${id} is declared in multiple files`);
  }
}
for (const { id, file } of ids) {
  if (!indexedIds.has(id)) {
    failures.push(`${path.relative(root, file)} declares unindexed ${id}`);
  }
}

for (const file of markdownFiles.filter((candidate) => candidate.includes(`${path.sep}stubs${path.sep}`) && !candidate.endsWith('README.md'))) {
  if (!fs.readFileSync(file, 'utf8').includes('**Status:** STUB')) {
    failures.push(`${path.relative(root, file)} lacks the STUB marker`);
  }
}

if (failures.length) {
  console.error(`Grand Harbor ledger check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Grand Harbor ledger check passed: ${files.length} files, ${markdownFiles.length} Markdown documents, ${ids.length} stable ID declarations.`);
