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

// The forbidden ephemeral-citation markers are the profile's to define, not
// this file's. They were written out twice -- once here as a regex and once in
// completeness-profile.yaml, which the README calls the contract for a stronger
// validator -- and two copies of one rule drift. Read from the profile, and
// fail rather than pass if the list cannot be read: a check whose rule list is
// empty is a check that finds nothing and says everything is fine.
const profileText = fs.readFileSync(path.join(root, 'checks', 'completeness-profile.yaml'), 'utf8');
const profileMarkers = (profileText.match(/^forbidden_ephemeral_citations:\n((?:\s+-\s+\S+\n)+)/m) ?? [])[1];
const forbiddenMarkers = (profileMarkers ?? '')
  .split('\n')
  .map((line) => line.replace(/^\s*-\s*/, '').trim())
  .filter(Boolean);
if (forbiddenMarkers.length === 0) {
  console.error('check-ledger: could not read forbidden_ephemeral_citations from completeness-profile.yaml');
  process.exit(1);
}
const transientMarker = new RegExp(
  `\\b(?:${forbiddenMarkers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b|\\bturn\\d+\\b`,
  'i',
);

for (const file of textFiles) {
  const text = fs.readFileSync(file, 'utf8');
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

// Every kind a record declares must be in the ledger's own vocabulary. There
// was no vocabulary: `registers:` lists the ID-bearing documents, which is a
// different thing, so a record could introduce a kind -- or misspell one --
// and nothing would notice. (A review bot read the two lists as one and called
// program_cut structurally invalid; it is not, but the absence it was pointing
// at is real.)
const declaredKinds = new Set(
  [...(((ledgerText.match(/^record_kinds:\n((?:\s+-\s+\S+\n)+)/m) ?? [])[1]) ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)],
);
if (declaredKinds.size === 0) {
  failures.push('ledger.yaml declares no record_kinds vocabulary, so any kind would pass');
} else {
  // No allowlist. There was one -- ['question','tension','hypothesis','proof',
  // 'archive','ux'] -- and it exempted precisely the kinds record_kinds had
  // failed to declare, so the check reported a vocabulary as enforced while
  // four of the registers below used kinds outside it. A gate carrying a
  // hardcoded pass for its own subject is not a gate. The vocabulary is
  // complete now; anything new has to be declared like everything else.
  // "- kind: question" as well as "  kind: question". The registers spell it
  // the first way and the old pattern required whitespace immediately before
  // "kind:", so it matched 39 lines elsewhere in the file and not one of the
  // six registers -- the check validated a set that was never in question
  // while the set that was went unread. That is why the allowlist above went
  // unnoticed: nothing it exempted was ever being tested.
  for (const match of ledgerText.matchAll(/^\s*(?:-\s+)?kind:\s+(\S+)\s*$/gm)) {
    if (!declaredKinds.has(match[1])) {
      failures.push(`ledger.yaml record kind '${match[1]}' is not in record_kinds`);
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
