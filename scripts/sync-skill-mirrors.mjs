#!/usr/bin/env node
//
// sync-skill-mirrors.mjs — keep declared agent-surface skill mirrors byte-identical
// to their canonical source under skills/.
//
// A canonical skill declares where it must be mirrored via frontmatter:
//
//   metadata:
//     mirrors:
//       repo: skills/<name>                 # the canonical itself (skipped)
//       codex: .codex/skills/<name>
//       claude: .claude/skills/<name>
//       agents: .agents/skills/<name>
//       gemini-extension: .gemini/extensions/port-daddy/skills/<name>
//
// The mirror is a WHOLE-DIRECTORY copy: every file under the canonical skill dir
// is copied to each declared mirror path, and any file present in the mirror but
// absent from the canonical is deleted, so a mirror can never silently drift or
// keep an orphaned file. The `repo:` entry names the canonical and is never
// written to.
//
// Usage:
//   node scripts/sync-skill-mirrors.mjs            # write: bring all mirrors into sync
//   node scripts/sync-skill-mirrors.mjs --check    # CI: exit 1 if any mirror is out of sync
//   node scripts/sync-skill-mirrors.mjs --json     # machine-readable report
//
import {
  existsSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, rmSync, statSync, copyFileSync,
} from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const SKILLS_DIR = 'skills';
// Mirror keys that point at a real on-disk copy. `repo` is the canonical itself.
const MIRROR_KEYS = ['codex', 'claude', 'agents', 'gemini-extension'];

function parseArgs(argv) {
  const opts = { check: false, json: false };
  for (const arg of argv) {
    if (arg === '--check') opts.check = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    'sync-skill-mirrors — mirror canonical skills/ dirs to their declared agent surfaces\n\n' +
    '  (no flags)   write mode: copy canonical → every declared mirror, prune extras\n' +
    '  --check      verify only; exit 1 if any mirror differs from canonical\n' +
    '  --json       emit a JSON report instead of human text\n',
  );
}

/**
 * Extract the `metadata.mirrors` map from a SKILL.md frontmatter block without a
 * YAML dependency (CI runs this with stdlib Node only). The mirrors block is a
 * flat `key: path` map nested two levels under `metadata:`, e.g.
 *
 *   metadata:
 *     mirrors:
 *       repo: skills/foo
 *       codex: .codex/skills/foo
 *
 * Returns { repo?, codex?, claude?, agents?, 'gemini-extension'? } or null.
 */
function readMirrors(file) {
  const text = readFileSync(file, 'utf8');
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const lines = text.slice(3, end).split('\n');

  let inMirrors = false;
  let mirrorIndent = 0;
  const mirrors = {};
  for (const line of lines) {
    if (line.trim() === '') continue;
    const indent = line.length - line.trimStart().length;
    const m = /^(\s*)mirrors:\s*$/.exec(line);
    if (m) { inMirrors = true; mirrorIndent = m[1].length; continue; }
    if (inMirrors) {
      // A sibling/parent key at or below the mirrors indent ends the block.
      if (indent <= mirrorIndent) { inMirrors = false; }
      else {
        const kv = /^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
        if (kv) mirrors[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
        continue;
      }
    }
  }
  return Object.keys(mirrors).length ? mirrors : null;
}

/** All files (recursive) under a dir, as paths relative to that dir. */
function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const abs = join(cur, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else if (entry.isFile()) out.push(relative(dir, abs));
    }
  }
  return out.sort();
}

function sha(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Compute what would change to make `mirrorAbs` an exact copy of `canonAbs`.
 * Returns { toCopy: [...rel], toDelete: [...rel] }.
 */
function diffMirror(canonAbs, mirrorAbs) {
  const canonFiles = new Set(listFiles(canonAbs));
  const mirrorFiles = existsSync(mirrorAbs) ? new Set(listFiles(mirrorAbs)) : new Set();
  const toCopy = [];
  for (const rel of canonFiles) {
    const m = join(mirrorAbs, rel);
    if (!existsSync(m) || sha(join(canonAbs, rel)) !== sha(m)) toCopy.push(rel);
  }
  const toDelete = [];
  for (const rel of mirrorFiles) {
    if (!canonFiles.has(rel)) toDelete.push(rel);
  }
  return { toCopy: toCopy.sort(), toDelete: toDelete.sort() };
}

function applyMirror(canonAbs, mirrorAbs, diff) {
  for (const rel of diff.toCopy) {
    const dest = join(mirrorAbs, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(canonAbs, rel), dest);
  }
  for (const rel of diff.toDelete) {
    rmSync(join(mirrorAbs, rel), { force: true });
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const skillsAbs = join(ROOT, SKILLS_DIR);
  if (!existsSync(skillsAbs)) {
    throw new Error(`No ${SKILLS_DIR}/ directory at ${ROOT}`);
  }

  const report = []; // { skill, surface, path, copied, deleted, created }
  let driftCount = 0;

  for (const entry of readdirSync(skillsAbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = entry.name;
    const skillAbs = join(skillsAbs, skill);
    const skillMd = join(skillAbs, 'SKILL.md');
    if (!existsSync(skillMd)) continue;

    const mirrors = readMirrors(skillMd);
    if (!mirrors) continue;

    // Sanity: the declared `repo` entry must point at this canonical.
    if (mirrors.repo && mirrors.repo !== `${SKILLS_DIR}/${skill}`) {
      report.push({ skill, surface: 'repo', path: mirrors.repo, error: `repo mirror points at ${mirrors.repo}, expected ${SKILLS_DIR}/${skill}` });
      driftCount += 1;
    }

    for (const key of MIRROR_KEYS) {
      const rel = mirrors[key];
      if (!rel) continue;
      const mirrorAbs = join(ROOT, rel);
      const existed = existsSync(mirrorAbs);
      const diff = diffMirror(skillAbs, mirrorAbs);
      const drift = diff.toCopy.length + diff.toDelete.length;
      const rec = {
        skill, surface: key, path: rel,
        created: !existed,
        copied: diff.toCopy.length,
        deleted: diff.toDelete.length,
      };
      if (drift > 0) {
        driftCount += 1;
        if (!opts.check) applyMirror(skillAbs, mirrorAbs, diff);
      }
      report.push(rec);
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: opts.check ? 'check' : 'write', driftCount, mirrors: report }, null, 2) + '\n');
  } else {
    for (const r of report) {
      if (r.error) { process.stdout.write(`  ERROR  ${r.skill} [${r.surface}] ${r.error}\n`); continue; }
      const n = r.copied + r.deleted;
      const verb = opts.check ? (n ? 'OUT-OF-SYNC' : 'in-sync') : (n ? (r.created ? 'created' : 'synced') : 'in-sync');
      const detail = n ? ` (+${r.copied} copied, -${r.deleted} pruned${r.created ? ', new dir' : ''})` : '';
      process.stdout.write(`  ${verb.padEnd(12)} ${r.skill} → ${r.path}${detail}\n`);
    }
    const skills = new Set(report.map((r) => r.skill)).size;
    process.stdout.write(`\n${report.length} mirror target(s) across ${skills} skill(s); ${driftCount} ${opts.check ? 'out of sync' : 'updated'}.\n`);
  }

  if (opts.check && driftCount > 0) {
    process.stderr.write(`\n✗ ${driftCount} skill mirror(s) are out of sync. Run: node scripts/sync-skill-mirrors.mjs\n`);
    process.exit(1);
  }
}

main();
