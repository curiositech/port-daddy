#!/usr/bin/env node
/**
 * check-readme-freshness.mjs — commit-time README freshness gate.
 *
 * The README rotted from v3.13 to v3.23 because nothing at commit time asked
 * "did you change the operator-facing surface without telling the README?".
 * This gate closes that hole. It runs from the pre-commit hook (installed by
 * scripts/install-readme-freshness-hook.mjs) and FAILS the commit when staged
 * changes touch a surface the README documents but README.md itself is not
 * part of the same commit.
 *
 * Trigger surfaces are exact paths / path prefixes (structured fields — no
 * content heuristics):
 *
 *   cli/permission-tiers.ts   the authoritative CLI verb registry — a new or
 *                             retiered verb is by definition README material
 *   cli/commands/* (ADDED)    a brand-new command file = a brand-new verb
 *   mcp/server.ts             the MCP tool surface
 *   docs/openapi.yaml         the HTTP API contract
 *   pd-fleet.yml              the dogfooded fleet topology the README describes
 *
 * Escape hatches, in order of preference:
 *   1. Stage a README.md update in the same commit (the point of the gate).
 *   2. PD_README_OK=1 git commit …   — "I looked; this change is genuinely
 *      internal and alters nothing the README says." Recorded to stderr so the
 *      bypass shows up in shell logs.
 *   3. git commit --no-verify        — skips every hook; last resort.
 *
 * Usage:
 *   node scripts/check-readme-freshness.mjs --staged        # hook / default
 *   node scripts/check-readme-freshness.mjs --staged --json # machine-readable
 *
 * Exit codes: 0 = fresh or bypassed, 1 = README update required, 2 = cannot
 * determine staged files (not a git repo, git missing).
 */

import { execFileSync } from 'node:child_process';

const argv = new Set(process.argv.slice(2));
const JSON_OUT = argv.has('--json');

// Exact-path triggers: any staged modification requires a staged README.
const TRIGGER_FILES = [
  'cli/permission-tiers.ts',
  'mcp/server.ts',
  'docs/openapi.yaml',
  'pd-fleet.yml',
];

// Prefix triggers that only fire on ADDED files (a new file under
// cli/commands/ is a new verb; edits to existing command files are usually
// internal and would make the gate cry wolf).
const TRIGGER_ADDED_PREFIXES = ['cli/commands/'];

if (process.env.PD_README_OK === '1') {
  console.error('readme-freshness: bypassed via PD_README_OK=1 (operator asserts no README-visible surface changed)');
  process.exit(0);
}

let stagedRaw;
try {
  stagedRaw = execFileSync('git', ['diff', '--cached', '--name-status', '--no-renames'], {
    encoding: 'utf-8',
  });
} catch (e) {
  console.error(`readme-freshness: cannot read staged files (${e.message ?? e}); skipping gate.`);
  process.exit(2);
}

/** [{ status: 'A'|'M'|'D'|…, path }] */
const staged = stagedRaw
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status: status.trim()[0], path: rest.join('\t') };
  });

const readmeStaged = staged.some((f) => f.path === 'README.md');

const hits = [];
for (const f of staged) {
  if (TRIGGER_FILES.includes(f.path)) {
    hits.push({ path: f.path, reason: 'documented surface changed' });
    continue;
  }
  if (f.status === 'A' && TRIGGER_ADDED_PREFIXES.some((p) => f.path.startsWith(p))) {
    hits.push({ path: f.path, reason: 'new CLI command file (new verb)' });
  }
}

const report = { readmeStaged, hits, fresh: readmeStaged || hits.length === 0 };

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));

if (report.fresh) {
  if (!JSON_OUT && hits.length > 0) {
    console.log(`readme-freshness: ✓ surface change(s) staged together with README.md`);
  }
  process.exit(0);
}

console.error('\n✗ README FRESHNESS — staged changes touch the operator-facing surface, but README.md is not in this commit:');
for (const h of hits) {
  console.error(`    ${h.path}  (${h.reason})`);
}
console.error(`
  The README documents these surfaces. Keep it truthful:

    1. Update the affected README.md section (verbs, tiers, MCP tools, API,
       fleet), then \`git add README.md\` and commit again.
    2. If this change is genuinely internal (refactor, comment, bug fix that
       alters nothing the README claims), re-run with:
           PD_README_OK=1 git commit …
       The bypass is logged so it leaves a trail.
`);
process.exit(1);
