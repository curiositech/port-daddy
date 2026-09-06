#!/usr/bin/env node
// Proof-estate manifest checker: every on-disk formal artifact and R-script
// must be WIRED (a real CI job runs it) or explicitly RETIRED (with a
// reason) in whitepaper/corpus.json -- no third state. Dependency-free
// (Node stdlib only), so this job never needs a TLA+/Z3/ProVerif/Kani
// toolchain.
//
// Rescoped in wave-p1/proof-estate from a much larger whitepaper-chapter +
// formal-artifact corpus recovered from origin/codex/whitepaper-corpus-defrag
// (2026-08-31) -- see corpus.json's own scopeNote for why the chapter/mirror
// half of that branch's design was deliberately not carried over.
//
// Born from the same PR #9911 lineage as check_citations.py and
// check_propagated_corrections.py: a checker that exists but that nothing
// runs is worse than no checker.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repoRoot, 'whitepaper/corpus.json');
const corpus = JSON.parse(readFileSync(manifestPath, 'utf8'));
const failures = [];

function fail(message) {
  failures.push(message);
}

function requireFile(path, kind) {
  const absolute = resolve(repoRoot, path);
  if (!existsSync(absolute)) {
    fail(`${kind}: path does not exist: ${path}`);
    return false;
  }
  if (!statSync(absolute).isFile()) {
    fail(`${kind}: path is not a file: ${path}`);
    return false;
  }
  return true;
}

function filesBelow(root, { excludeDirNames = new Set() } = {}) {
  if (!existsSync(root)) return [];
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (excludeDirNames.has(entry.name)) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) found.push(...filesBelow(path, { excludeDirNames }));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

// ---------------------------------------------------------------------------
// 1. Manifest shape (hand-rolled -- see corpus.schema.json for the reference
//    shape; nothing here runs a generic JSON-Schema validator, matching this
//    repo's dependency-free convention for its other checkers).
// ---------------------------------------------------------------------------

if (corpus.version !== 2) fail(`version must be 2, got ${corpus.version}`);
if (typeof corpus.scopeNote !== 'string' || corpus.scopeNote.length === 0) {
  fail('scopeNote must be a non-empty string');
}
if (!corpus.forbiddenLegacyRoots || typeof corpus.forbiddenLegacyRoots !== 'object') {
  fail('forbiddenLegacyRoots must be an object');
} else {
  const { enabled, reason, roots } = corpus.forbiddenLegacyRoots;
  if (typeof enabled !== 'boolean') fail('forbiddenLegacyRoots.enabled must be a boolean');
  if (typeof reason !== 'string' || reason.length === 0) fail('forbiddenLegacyRoots.reason must be a non-empty string');
  if (!Array.isArray(roots)) fail('forbiddenLegacyRoots.roots must be an array');
  else if (enabled) {
    for (const legacyRoot of roots) {
      if (existsSync(resolve(repoRoot, legacyRoot))) fail(`forbidden legacy root still exists: ${legacyRoot}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Every CI job a "wired" entry names must actually exist in some workflow.
// ---------------------------------------------------------------------------

function discoverWorkflowJobIds() {
  const workflowsDir = resolve(repoRoot, '.github/workflows');
  const ids = new Set();
  if (!existsSync(workflowsDir)) return ids;
  for (const entry of readdirSync(workflowsDir)) {
    if (!/\.ya?ml$/u.test(entry)) continue;
    const text = readFileSync(resolve(workflowsDir, entry), 'utf8');
    const lines = text.split('\n');
    let inJobs = false;
    for (const line of lines) {
      if (/^jobs:\s*$/u.test(line)) {
        inJobs = true;
        continue;
      }
      if (!inJobs) continue;
      // A top-level key (0 leading spaces) ends the jobs: block.
      if (/^\S/u.test(line)) {
        inJobs = false;
        continue;
      }
      // A job id is a 2-space-indented "name:" line under jobs:.
      const match = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

const knownJobIds = discoverWorkflowJobIds();

function checkCi(ci, label) {
  if (!ci || typeof ci !== 'object') {
    fail(`${label}: ci must be an object`);
    return;
  }
  if (ci.status === 'wired') {
    if (!Array.isArray(ci.job) || ci.job.length === 0) {
      fail(`${label}: ci.job must be a non-empty array when ci.status is "wired"`);
      return;
    }
    for (const job of ci.job) {
      if (!knownJobIds.has(job)) {
        fail(`${label}: ci.job names "${job}", which is not a job id in any .github/workflows/*.yml file`);
      }
    }
  } else if (ci.status === 'retired') {
    if (typeof ci.reason !== 'string' || ci.reason.length === 0) {
      fail(`${label}: ci.reason must be a non-empty string when ci.status is "retired"`);
    }
  } else {
    fail(`${label}: ci.status must be "wired" or "retired", got ${JSON.stringify(ci.status)} -- no third state`);
  }
}

// ---------------------------------------------------------------------------
// 3. formalArtifacts: shape, path existence, and coverage of every on-disk
//    formal-extension file plus every #[kani::proof] occurrence.
// ---------------------------------------------------------------------------

const FORMAL_EXTENSIONS = /\.(?:tla|cfg|z3|smt2|pv|ec|spthy|als|thy)$/iu;
const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git', '.claude', '.cache']);

const formalArtifactIds = new Set();
const registeredFormalPaths = new Set();
const registeredKaniHarnesses = new Set(); // "path::harnessName"

for (const artifact of corpus.formalArtifacts ?? []) {
  const label = `formalArtifact ${artifact.id ?? '(missing id)'}`;
  if (!artifact.id) fail(`${label}: missing id`);
  else if (formalArtifactIds.has(artifact.id)) fail(`duplicate formalArtifact id: ${artifact.id}`);
  formalArtifactIds.add(artifact.id);

  if (!Array.isArray(artifact.paths) || artifact.paths.length === 0) {
    fail(`${label}: paths must be a non-empty array`);
  } else {
    for (const path of artifact.paths) {
      requireFile(path, label);
      if (artifact.method === 'Kani') {
        if (!artifact.harnessName) fail(`${label}: method is Kani but harnessName is missing`);
        else registeredKaniHarnesses.add(`${path}::${artifact.harnessName}`);
      } else {
        registeredFormalPaths.add(path);
      }
    }
  }
  checkCi(artifact.ci, label);
}

// 3a. Every formal-extension file outside the excluded dirs must be declared.
const discoveredFormalFiles = filesBelow(repoRoot, { excludeDirNames: EXCLUDED_DIR_NAMES })
  .filter((path) => FORMAL_EXTENSIONS.test(path))
  .map((path) => path.slice(repoRoot.length + 1).replace(/\\/gu, '/'));

const undeclaredFormalFiles = discoveredFormalFiles.filter((path) => !registeredFormalPaths.has(path));
if (undeclaredFormalFiles.length > 0) {
  fail(
    `on-disk formal artifact(s) not declared in any formalArtifacts entry (WIRED or RETIRED): ${undeclaredFormalFiles.join(', ')}`,
  );
}
const declaredButMissingFormalFiles = [...registeredFormalPaths].filter((path) => !discoveredFormalFiles.includes(path));
if (declaredButMissingFormalFiles.length > 0) {
  fail(
    `formalArtifacts declare path(s) that the discovery scan did not find (extension mismatch or wrong path): ${declaredButMissingFormalFiles.join(', ')}`,
  );
}

// 3b. Every #[kani::proof] harness must be declared.
function discoverKaniHarnesses() {
  const rsFiles = execFileSync(
    'grep',
    ['-rl', '--include=*.rs', 'kani::proof', repoRoot],
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean);

  const found = new Set();
  for (const absPath of rsFiles) {
    const rel = absPath.slice(repoRoot.length + 1).replace(/\\/gu, '/');
    const lines = readFileSync(absPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes('#[kani::proof]')) continue;
      let j = i + 1;
      while (j < lines.length && lines[j].trim().startsWith('#[')) j += 1;
      const match = j < lines.length ? /fn\s+(\w+)/u.exec(lines[j]) : null;
      if (!match) {
        fail(`could not find a harness fn name after #[kani::proof] at ${rel}:${i + 1}`);
        continue;
      }
      found.add(`${rel}::${match[1]}`);
    }
  }
  return found;
}

const discoveredKaniHarnesses = discoverKaniHarnesses();
for (const harness of discoveredKaniHarnesses) {
  if (!registeredKaniHarnesses.has(harness)) {
    const [path, name] = harness.split('::');
    fail(`#[kani::proof] harness not declared in any formalArtifacts entry: ${name} in ${path}`);
  }
}
for (const harness of registeredKaniHarnesses) {
  if (!discoveredKaniHarnesses.has(harness)) {
    const [path, name] = harness.split('::');
    fail(`formalArtifacts declares Kani harness "${name}" in ${path}, but no #[kani::proof] with that function name was found there`);
  }
}

// ---------------------------------------------------------------------------
// 4. researchProgramArtifacts: shape, path existence, ci, and coverage of the
//    known research-script directories (a narrower, curated discovery scan --
//    not every .py/.mjs in the repo is a "research program artifact").
// ---------------------------------------------------------------------------

const researchArtifactIds = new Set();
const registeredResearchPaths = new Set();

for (const artifact of corpus.researchProgramArtifacts ?? []) {
  const label = `researchProgramArtifact ${artifact.id ?? '(missing id)'}`;
  if (!artifact.id) fail(`${label}: missing id`);
  else if (researchArtifactIds.has(artifact.id)) fail(`duplicate researchProgramArtifact id: ${artifact.id}`);
  researchArtifactIds.add(artifact.id);

  if (!Array.isArray(artifact.paths) || artifact.paths.length === 0) {
    fail(`${label}: paths must be a non-empty array`);
  } else {
    for (const path of artifact.paths) {
      requireFile(path, label);
      registeredResearchPaths.add(path);
    }
  }
  checkCi(artifact.ci, label);
}

const RESEARCH_DISCOVERY_ROOTS = ['skills/harbor-results/scripts', 'proofs/bonded/pareto'];
for (const root of RESEARCH_DISCOVERY_ROOTS) {
  const absRoot = resolve(repoRoot, root);
  if (!existsSync(absRoot)) continue;
  const files = filesBelow(absRoot)
    .filter((path) => /\.(?:py|mjs)$/u.test(path))
    .map((path) => path.slice(repoRoot.length + 1).replace(/\\/gu, '/'));
  for (const path of files) {
    if (!registeredResearchPaths.has(path)) {
      fail(`on-disk research script not declared in any researchProgramArtifacts entry: ${path}`);
    }
  }
}

// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error('Proof-estate manifest check failed:\n');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `Proof-estate manifest check passed: ${corpus.formalArtifacts.length} formal artifacts `
  + `(${discoveredFormalFiles.length} files + ${discoveredKaniHarnesses.size} Kani harnesses), `
  + `${corpus.researchProgramArtifacts.length} research-program artifacts, all WIRED or RETIRED.`,
);
