#!/usr/bin/env node
/**
 * audit-hook-bypass.mjs — the binary-agnostic-wall auditor (pd-spark #2).
 *
 * ADR-0053 ("Out-of-Band Enforcement") and its lineage (ADR-0037 git access
 * control; ADR-0102 no-agent-mintable-escape) draw one bright line:
 *
 *     A git HOOK is the binary-agnostic wall. git runs `.git/hooks/*`
 *     regardless of which `git` binary invoked it, so a hook is the one
 *     enforcement surface an agent cannot dodge by choosing a different
 *     binary, rewriting PATH, or linking libgit2. Therefore a hook MUST NOT
 *     stand down on an in-band environment variable. If setting `FOO=1` in
 *     the agent's own shell makes the hook `exit 0`, the wall is not a wall —
 *     it is advisory, and the agent mints its own escape for free.
 *
 * The pre-push hook installer even says so in its own header ("this hook
 * survives PD_SHIM_OFF=1 because git always runs pre-push hooks") — yet the
 * body it generated honored `PD_SHIM_OFF=1 -> exit 0`, silently, with no
 * audit. That contradiction is exactly the shape this auditor exists to catch.
 *
 * WHAT IT SCANS
 *   1. Installed hooks:  <git-common-dir>/hooks/*  (skips *.sample and
 *      *.pd-bak.* backups). These are the live wall on this machine.
 *   2. Tracked source:   the shim/hook *installers* and embedded hook
 *      templates under scripts/ and cli/ (install-pre-push-hook.sh,
 *      cli/commands/guard.ts, cli/commands/init.ts, cli/utils/git-shim.ts …).
 *      These generate the hooks, so a bypass baked into a template ships to
 *      every repo that runs the installer.
 *
 * WHAT IT FLAGS — the *structural* stand-down shape, not a keyword list
 *   A finding is an environment-variable-gated neutralization of a hook: a
 *   conditional whose test is (primarily) an env-var comparison and whose body
 *   short-circuits enforcement via `exit 0` or `exec <real-binary>`. Concretely
 *   the three canonical shapes (see BYPASS_PATTERNS for the exact regexes):
 *     a) if [ "${VAR:-}" = "1" ]; then exit 0        # posix test -> exit 0
 *     b) [ -n "$VAR" ] && exit 0    (or `&& exec …`)  # && short-circuit
 *     c) [[ -n "$VAR" ]] then exec "$real_git" …      # env-gated exec passthrough
 *   The detector requires BOTH an env-var reference in the guard AND an
 *   enforcement-neutralizing body, so quality/UX gates that merely `exit 1`
 *   (e.g. the README-freshness `PD_README_OK` message, which is an echo + an
 *   `exit 1`, and whose env check lives in a *node* script, not the hook body)
 *   do not false-positive.
 *
 * ALLOWLIST — structured, commented, ADR-referenced (see ALLOWLIST)
 *   The git SHIM (`cli/utils/git-shim.ts`, installed as ~/.port-daddy/bin/git)
 *   is NOT a git hook — it is the PATH-wrapper binary, i.e. the very thing an
 *   agent bypasses by picking a different `git`. ADR-0053 designates the shim
 *   as the in-band *advisory tripwire* whose `PD_SHIM_OFF=1` escape is
 *   deliberate AND audited (it appends to ~/.port-daddy/destructive-ops.log
 *   before exec-ing real git). The binary-agnostic-wall rule is about hooks,
 *   so the shim's env bypass is allowlisted with that rationale. Any other
 *   env-gated stand-down is a violation.
 *
 * OUTPUT / EXIT CODES
 *   Prints a human report (or --json). Exit 0 when there are zero
 *   non-allowlisted findings; exit 1 when any hook stands down on an env var;
 *   exit 2 on an operational error (bad path, cannot read git dir).
 *
 * USAGE
 *   node scripts/audit-hook-bypass.mjs                 # scan this repo
 *   node scripts/audit-hook-bypass.mjs --json          # machine-readable
 *   node scripts/audit-hook-bypass.mjs --no-installed   # tracked source only
 *   node scripts/audit-hook-bypass.mjs --root /path/to/repo
 *
 * Wire it into CI as a required check — see
 * docs/adr/0053-out-of-band-enforcement.md ("Hook-bypass auditor").
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';

/**
 * Structural bypass shapes. Each entry documents the exact code shape it
 * matches. `env` captures the environment variable name so the report can name
 * it. These are intentionally narrow: they require an env-var guard adjacent to
 * an enforcement-neutralizing body (`exit 0` / `exec`).
 *
 * Regex notes:
 *  - `\\\\?` tolerates the single backslash that appears when a bash hook is
 *    embedded as a JS/TS template literal (`\${VAR}` inside a `` `...` ``
 *    string), so we catch bypasses in `git-shim.ts`-style source too.
 *  - We anchor on the env-var reference so plain `exit 0` (a normal hook
 *    success at end-of-script) never matches on its own.
 */
const BYPASS_PATTERNS = [
  {
    id: 'test-eq-then-block',
    why: 'env-var equality test opens a `then` block that neutralizes enforcement (`exit 0`/`exec`) before its `fi`',
    // if [ "${VAR:-}" = "1" ]; then <body-without-fi> exit 0|exec
    // The `(?!\bfi\b)` gate keeps the neutralizer INSIDE this then-block, so a
    // benign env test followed much later by a normal end-of-hook `exit 0`
    // (past its own `fi`) does not match.
    re: /(?:if\s+)?\[\[?\s*"?\\?\$\{?([A-Z_][A-Z0-9_]*)(?::-[^}"\]]*)?\}?"?\s*(?:==?|!=)\s*"?[^"\]]*"?\s*\]\]?\s*;?\s*then\b(?:(?!\bfi\b)[\s\S]){0,400}?\b(exit\s+0|exec\b)/,
  },
  {
    id: 'test-n-then-block',
    why: 'non-empty env-var test opens a `then` block that stands the hook down (`exit 0`/`exec`)',
    // if [ -n "$VAR" ]; then <body-without-fi> exit 0|exec
    re: /(?:if\s+)?\[\[?\s*-n\s+"?\\?\$\{?([A-Z_][A-Z0-9_]*)(?::-[^}"\]]*)?\}?"?\s*\]\]?\s*;?\s*then\b(?:(?!\bfi\b)[\s\S]){0,400}?\b(exit\s+0|exec\b)/,
  },
  {
    id: 'env-shortcircuit',
    why: 'env-var test short-circuits (`&&`) straight into `exit 0`/`exec` — presence of the flag skips the hook',
    // [ -n "$VAR" ] && exit 0   /   [ "${VAR:-}" = "1" ] && exec ...
    re: /\[\[?\s*(?:-n\s+)?"?\\?\$\{?([A-Z_][A-Z0-9_]*)(?::-[^}"\]]*)?\}?"?\s*(?:(?:==?|!=)\s*"?[^"\]]*"?\s*)?\]\]?\s*&&\s*(exit\s+0|exec\b)/,
  },
];

/**
 * Structured allowlist of KNOWN, deliberate env bypasses that are NOT
 * binary-agnostic-wall violations. Keyed by repo-relative path. A match is
 * suppressed only when the captured env var is in `envVars` AND the rationale
 * is recorded here. Keep this list tiny and adr-referenced; a hook bypass does
 * not belong here.
 */
const ALLOWLIST = [
  {
    path: 'cli/utils/git-shim.ts',
    envVars: ['PD_SHIM_OFF'],
    adr: 'ADR-0053 (Out-of-Band Enforcement) §"the reframe" / §"loud tripwire"',
    reason:
      'The git shim is the PATH-wrapper binary, not a git hook — it is the ' +
      'in-band advisory tripwire, and PD_SHIM_OFF is its deliberate, AUDITED ' +
      'operator escape (it appends to ~/.port-daddy/destructive-ops.log before ' +
      'exec-ing real git). The binary-agnostic-wall rule constrains hooks, not ' +
      'the shim it wraps. See tests/unit/git-shim-verbs.test.js.',
  },
];

/** Known git hook basenames — used to classify installed files and templates. */
const HOOK_NAMES = new Set([
  'applypatch-msg', 'pre-applypatch', 'post-applypatch', 'pre-commit',
  'pre-merge-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit',
  'pre-rebase', 'post-checkout', 'post-merge', 'pre-push', 'pre-receive',
  'update', 'post-receive', 'post-update', 'push-to-checkout', 'pre-auto-gc',
  'post-rewrite', 'sendemail-validate', 'fsmonitor-watchman', 'reference-transaction',
]);

/**
 * Tracked source files that either install git hooks or carry hook/shim
 * templates. These are scanned from version control so a bypass baked into a
 * template is caught before it ships. Missing files are skipped silently.
 */
const SOURCE_TARGETS = [
  'scripts/install-pre-push-hook.sh',
  'cli/commands/guard.ts',
  'cli/commands/init.ts',
  'cli/utils/git-shim.ts',
  'cli/utils/post-commit-hook.ts',
];

function parseArgs(argv) {
  const opts = { json: false, installed: true, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--no-installed') opts.installed = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  if (opts.root && !isAbsolute(opts.root)) opts.root = join(process.cwd(), opts.root);
  return opts;
}

/** Resolve <git-common-dir>/hooks for a repo root, or null if not a git repo. */
function installedHooksDir(root) {
  try {
    const common = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root, encoding: 'utf8',
    }).trim();
    const dir = isAbsolute(common) ? common : join(root, common);
    const hooks = join(dir, 'hooks');
    return existsSync(hooks) ? hooks : null;
  } catch {
    return null;
  }
}

/** 1-based line number for a character offset. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** Compact single-line excerpt for the report. */
function excerptAt(text, index, span) {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index + span);
  if (end === -1) end = text.length;
  return text.slice(start, Math.min(end, start + 160)).trim();
}

/**
 * Scan one file's text for the structural bypass shapes. Returns an array of
 * raw findings ({ patternId, why, envVar, line, excerpt }). Runs each pattern
 * globally so multiple bypasses in one file are all reported.
 */
function scanText(text) {
  const found = [];
  for (const pat of BYPASS_PATTERNS) {
    const g = new RegExp(pat.re.source, 'g');
    let m;
    while ((m = g.exec(text)) !== null) {
      found.push({
        patternId: pat.id,
        why: pat.why,
        envVar: m[1],
        line: lineOf(text, m.index),
        excerpt: excerptAt(text, m.index, m[0].length),
      });
      if (m.index === g.lastIndex) g.lastIndex++; // avoid zero-width loop
    }
  }
  return found;
}

function allowlistMatch(relPath, envVar) {
  return ALLOWLIST.find((a) => a.path === relPath && a.envVars.includes(envVar)) || null;
}

/** Scan a single file, classify + allowlist findings. */
function scanFile(absPath, relPath, kind) {
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return [];
  }
  return scanText(text).map((f) => {
    const allow = allowlistMatch(relPath, f.envVar);
    return { ...f, file: relPath, kind, allow };
  });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(readFileSync(new URL(import.meta.url)).toString().split('\n')
      .filter((l) => l.startsWith(' *') || l.startsWith('/**') || l.startsWith(' */'))
      .join('\n'));
    process.exit(0);
  }
  const root = opts.root;
  if (!existsSync(root)) {
    console.error(`audit-hook-bypass: root does not exist: ${root}`);
    process.exit(2);
  }

  const findings = [];

  // 1. Tracked source installers + templates.
  for (const rel of SOURCE_TARGETS) {
    const abs = join(root, rel);
    if (existsSync(abs)) findings.push(...scanFile(abs, rel, 'installer'));
  }

  // 2. Installed hooks (best-effort; the live wall on this machine).
  if (opts.installed) {
    const hooksDir = installedHooksDir(root);
    if (hooksDir) {
      for (const name of readdirSync(hooksDir)) {
        if (name.endsWith('.sample')) continue;      // git's inert examples
        if (name.includes('.pd-bak.')) continue;     // our own timestamped backups
        const abs = join(hooksDir, name);
        try { if (!statSync(abs).isFile()) continue; } catch { continue; }
        // Only scan things that are (or look like) git hooks.
        const base = name.split('.')[0];
        if (!HOOK_NAMES.has(base) && !HOOK_NAMES.has(name)) continue;
        const rel = relative(root, abs);
        findings.push(...scanFile(abs, rel, 'installed-hook'));
      }
    }
  }

  const violations = findings.filter((f) => !f.allow);
  const allowed = findings.filter((f) => f.allow);

  if (opts.json) {
    console.log(JSON.stringify({
      ok: violations.length === 0,
      violations, allowed, scannedRoot: root,
    }, null, 2));
    process.exit(violations.length === 0 ? 0 : 1);
  }

  // Human report.
  const bar = '─'.repeat(70);
  console.log(bar);
  console.log('  Hook bypass auditor — binary-agnostic-wall (ADR-0053 / ADR-0102)');
  console.log(bar);
  if (violations.length === 0) {
    console.log('  PASS — no hook stands down on an in-band environment variable.');
  } else {
    console.log(`  FAIL — ${violations.length} hook bypass finding(s):\n`);
    for (const v of violations) {
      console.log(`  ✗ ${v.file}:${v.line}  [${v.kind}]`);
      console.log(`      env var : ${v.envVar}`);
      console.log(`      pattern : ${v.patternId} — ${v.why}`);
      console.log(`      code    : ${v.excerpt}`);
      console.log(`      why bad : a git hook is the one wall an agent cannot dodge by`);
      console.log(`                swapping the git binary; honoring ${v.envVar} in-band`);
      console.log(`                lets the agent mint its own escape. Remove the`);
      console.log(`                env-gated stand-down (git's native --no-verify remains`);
      console.log(`                the only, universal, non-mintable skip).\n`);
    }
  }
  if (allowed.length) {
    console.log(`  ${allowed.length} allowlisted (documented, not a hook wall):`);
    for (const a of allowed) {
      console.log(`    • ${a.file}:${a.line}  ${a.envVar} — ${a.allow.adr}`);
    }
  }
  console.log(bar);
  process.exit(violations.length === 0 ? 0 : 1);
}

// Export the pure pieces so tests can exercise detection without spawning.
export { scanText, scanFile, allowlistMatch, BYPASS_PATTERNS, ALLOWLIST, SOURCE_TARGETS };

// Run as a CLI only when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] &&
  (process.argv[1].endsWith('audit-hook-bypass.mjs') || process.argv[1] === new URL(import.meta.url).pathname);
if (invokedDirectly) main();
