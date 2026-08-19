#!/usr/bin/env node
/**
 * check-readme-accuracy.mjs — release-blocking gate: is README.md still TRUE?
 *
 * Motivation. The repo already has a README *freshness* gate
 * (scripts/check-readme-freshness.mjs): it fires when a watched source file changes
 * without a README change, and it answers "did you *consider* the README?". That is a
 * different question from "is the README correct?", and it has a known blind spot —
 * README drift mostly happens through renames and removals somewhere else, in commits
 * that never touch a watched path and therefore never trip it. It also has a known
 * side effect: because the cheapest way to satisfy it is to add a paragraph, it drives
 * the front door to grow without bound. A 1,000-line README is what that looks like.
 *
 * This gate answers the other question, and supplies the missing counterweight. It
 * parses README.md and checks its claims against the code:
 *
 *   1. every `pd` verb and subcommand in an example resolves against the authoritative
 *      registry in cli/permission-tiers.ts;
 *   2. every long flag still exists somewhere in the CLI sources (see loadFlagCorpus()
 *      for why the check is corpus-wide rather than per-verb, and what that costs);
 *   3. every image and relative link resolves on disk;
 *   4. the document stays inside its length/fence/section budget.
 *
 * Design philosophy. Errors block; warnings inform; a check that could not run is
 * reported as unresolved and never silently counted as a pass — a gate that reports
 * green for work it did not do is worse than no gate, because it launders an unknown
 * into a guarantee. The same reason `pd attest` always lists what it could not verify.
 *
 * Usage:
 *   node scripts/check-readme-accuracy.mjs             # human-readable
 *   node scripts/check-readme-accuracy.mjs --json      # machine-readable (for agents)
 *   node scripts/check-readme-accuracy.mjs --ci        # no color; exit non-zero on errors
 *   node scripts/check-readme-accuracy.mjs --run       # also execute `readme-verify: run` blocks
 *
 * Exit codes: 0 = accurate, 1 = errors found, 2 = cannot run (missing registry/file).
 */

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript is the precise way to read the registry literal, but this gate also runs
// on a blank machine in the fresh-install smoke, where node_modules does not exist and
// installing it would cost more than the parse is worth. Optional import with a
// bounded regex fallback; both paths refuse to return an implausibly small surface
// rather than degrade into a vacuous pass.
let ts = null;
try { ts = (await import('typescript')).default; } catch { /* fallback parser below */ }

import { extractFences, shellInvocations } from '../skills/readme-craft/scripts/extract-examples.mjs';
import { scoreReadme } from '../skills/readme-craft/scripts/readme-scorecard.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const TIERS_TS = join(ROOT, 'cli', 'permission-tiers.ts');

const argv = new Set(process.argv.slice(2));
const CI = argv.has('--ci');
const JSON_OUT = argv.has('--json');
const DO_RUN = argv.has('--run');

/**
 * Read the authoritative command surface out of cli/permission-tiers.ts.
 *
 * Why parse the TypeScript rather than keep a list here: a hand-maintained mirror of
 * the verb registry is one more thing that drifts, and a drift-detector that drifts is
 * the joke telling itself. The registry file is the same one `resolveTier()` dispatches
 * on, so if this parse succeeds the gate is checking against what the CLI actually does.
 *
 * @returns {{verbs: Set<string>, subcommands: Map<string, Set<string>>}}
 *          `verbs` is every top-level `pd <verb>`; `subcommands` maps a verb to the
 *          subcommands the registry explicitly refines.
 * @throws {Error} When neither object literal can be found — a silent empty result
 *         would turn every check below into a vacuous pass.
 */
export function loadCommandSurface(tsPath = TIERS_TS) {
  const src = readFileSync(tsPath, 'utf8');
  const literals = ts ? parseWithTypeScript(tsPath, src) : parseWithRegex(src);

  const top = literals.get('TIER_REGISTRY');
  const subs = literals.get('SUBCOMMAND_TIERS');
  if (!top || top.length < 50) {
    throw new Error(`read only ${top?.length ?? 0} verbs from TIER_REGISTRY in ${tsPath} — refusing to report a vacuous pass`);
  }

  const verbs = new Set(top);
  const subcommands = new Map();
  for (const key of subs ?? []) {
    const [verb, ...rest] = key.split(/\s+/);
    if (rest.length === 0) continue;
    if (!subcommands.has(verb)) subcommands.set(verb, new Set());
    subcommands.get(verb).add(rest.join(' '));
    verbs.add(verb);
  }
  return { verbs, subcommands };
}

/** Precise path: walk the AST for every exported object-literal's keys. */
function parseWithTypeScript(tsPath, src) {
  const sf = ts.createSourceFile(tsPath, src, ts.ScriptTarget.Latest, true);
  const literals = new Map(); // const name -> string[] of keys

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name && node.initializer) {
      const name = node.name.getText(sf);
      let init = node.initializer;
      if (ts.isAsExpression(init) || ts.isTypeAssertionExpression?.(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        const keys = [];
        for (const prop of init.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const k = prop.name;
          if (ts.isIdentifier(k)) keys.push(k.text);
          else if (ts.isStringLiteral(k)) keys.push(k.text);
        }
        literals.set(name, keys);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return literals;
}

/**
 * Fallback path for machines without node_modules: slice each `export const NAME
 * ... = { ... }` literal by brace depth, then read its keys. Both registries in
 * cli/permission-tiers.ts are flat `key: 'tier'` maps, which is exactly the shape this
 * handles; anything nested would need the AST, and the caller's minimum-size guard is
 * what stops a bad slice from passing silently.
 */
export function parseWithRegex(src) {
  const literals = new Map();
  for (const name of ['TIER_REGISTRY', 'SUBCOMMAND_TIERS']) {
    const start = src.search(new RegExp(`export const ${name}\\b[^=]*=\\s*\\{`));
    if (start < 0) continue;
    let i = src.indexOf('{', start);
    let depth = 0, end = -1;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(i + 1, end);
    const keys = [];
    for (const m of body.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/gm)) {
      keys.push(m[1] ?? m[2] ?? m[3]);
    }
    literals.set(name, keys);
  }
  return literals;
}

/** Levenshtein distance, for did-you-mean on an unknown verb. */
function distance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function nearest(word, candidates) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = distance(word, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return bestD <= Math.max(2, Math.floor(word.length / 3)) ? best : null;
}

/**
 * Every long flag the CLI mentions anywhere, harvested from the command sources.
 *
 * Scope, stated plainly because a gate that overstates its reach is worse than one
 * that admits its limits: the CLI has no per-verb flag declaration — `pd <verb> --help`
 * prints the global help for every verb — so there is nothing to check a flag against
 * *per verb*. What this corpus proves is narrower and still worth having: the flag
 * exists somewhere in the CLI. That catches the dominant real drift, a flag renamed or
 * deleted while the README kept naming it. It does not catch a flag that is real but
 * belongs to a different verb.
 *
 * If per-verb flag declarations ever land, narrow this to the verb and delete this note.
 *
 * @param {string[]} dirs Source directories to harvest.
 * @returns {Set<string>} Long flags including leading `--`.
 * @throws {Error} When the harvest is implausibly small, which means the layout moved
 *         and every flag check below would otherwise report a vacuous failure.
 */
export function loadFlagCorpus(dirs = ['cli', 'bin', 'lib']) {
  const found = new Set();
  for (const dir of dirs) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    let out = '';
    try {
      out = execFileSync('grep', ['-rohE', '--include=*.ts', '--include=*.js', '--', '--[a-z][a-z0-9-]+', abs], {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      });
    } catch {
      continue; // grep exits 1 on no matches
    }
    for (const f of out.split('\n')) if (f.trim()) found.add(f.trim());
  }
  if (found.size < 50) {
    throw new Error(`flag corpus harvested only ${found.size} flags from ${dirs.join(', ')} — the CLI layout moved; refusing to report every flag as unknown`);
  }
  return found;
}

/** Placeholder tokens an author writes deliberately; not a real flag or subcommand. */
const PLACEHOLDER = /^(<.*>|\[.*\]|\.\.\.|\$\{?\w+\}?)$/;

function main() {
  if (!existsSync(README)) {
    console.error('check-readme-accuracy: README.md not found');
    process.exit(2);
  }

  let surface, flagCorpus;
  try {
    surface = loadCommandSurface();
    flagCorpus = loadFlagCorpus();
  } catch (e) {
    console.error(`check-readme-accuracy: ${e.message}`);
    process.exit(2);
  }

  const source = readFileSync(README, 'utf8');
  const errors = [];
  const warnings = [];
  const unresolved = [];
  const err = (line, rule, message) => errors.push({ line, rule, message });
  const warn = (line, rule, message) => warnings.push({ line, rule, message });

  // ── 1-3. Structural findings from the shared scorecard ─────────────────────
  // Broken images, broken links, budget, fence hygiene. Reused rather than
  // reimplemented so the craft rules and the gate cannot disagree.
  const card = scoreReadme(source, README);
  errors.push(...card.errors);
  warnings.push(...card.warnings);

  // ── 4. Surface-check every checkable block ─────────────────────────────────
  const blocks = extractFences(source);
  const checkable = blocks.filter((b) => b.tier === 'surface' || b.tier === 'run');
  let commandsChecked = 0;
  let flagsChecked = 0;
  const cliAvailable = (() => {
    try { execFileSync('pd', ['--version'], { stdio: 'ignore', timeout: 10_000 }); return true; }
    catch { return false; }
  })();

  for (const block of checkable) {
    for (const inv of shellInvocations(block.code)) {
      if (inv.argv[0] !== 'pd' && inv.argv[0] !== 'port-daddy') continue;
      const line = block.startLine + inv.line;
      const verb = inv.argv[1];
      if (!verb || PLACEHOLDER.test(verb)) continue;
      commandsChecked++;

      if (!surface.verbs.has(verb)) {
        const hint = nearest(verb, surface.verbs);
        err(line, 'unknown-verb',
          `\`pd ${verb}\` is not in cli/permission-tiers.ts${hint ? ` — did you mean \`pd ${hint}\`?` : ''}`);
        continue;
      }

      // Subcommand, when the registry refines this verb and the next token looks
      // like one. A verb the registry does not refine is left alone: absence of a
      // SUBCOMMAND_TIERS entry means "not tier-refined", not "has no subcommands".
      const next = inv.argv[2];
      const known = surface.subcommands.get(verb);
      if (known && next && !next.startsWith('-') && !PLACEHOLDER.test(next)) {
        const twoWord = inv.argv[3] && !inv.argv[3].startsWith('-') ? `${next} ${inv.argv[3]}` : null;
        if (!known.has(next) && !(twoWord && known.has(twoWord))) {
          warn(line, 'unknown-subcommand',
            `\`pd ${verb} ${next}\` is not tier-refined in SUBCOMMAND_TIERS. Confirm the subcommand still exists.`);
        }
      }

      // Long flags, against the corpus. See loadFlagCorpus() for what this proves.
      const used = inv.argv.slice(2).filter((t) => /^--[a-z]/i.test(t)).map((t) => t.split('=')[0]);
      for (const f of used) {
        flagsChecked++;
        if (!flagCorpus.has(f)) {
          const hint = nearest(f, flagCorpus);
          err(line, 'unknown-flag',
            `\`pd ${verb} ${f}\` — no such flag anywhere in the CLI sources${hint ? ` — did you mean \`${hint}\`?` : ''}`);
        }
      }
    }
  }

  unresolved.push({
    line: 0, rule: 'flags-not-verb-scoped',
    message: `${flagsChecked} flag(s) were checked for existence anywhere in the CLI, not for belonging to their verb — the CLI declares no per-verb flags. See loadFlagCorpus().`,
  });

  // ── 5. run-tier blocks ─────────────────────────────────────────────────────
  const runBlocks = blocks.filter((b) => b.tier === 'run');
  let ran = 0;
  if (DO_RUN) {
    for (const block of runBlocks) {
      for (const inv of shellInvocations(block.code)) {
        if (inv.argv[0] !== 'pd' && inv.argv[0] !== 'port-daddy') continue;
        const line = block.startLine + inv.line;
        try {
          execFileSync(inv.argv[0], inv.argv.slice(1), {
            encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'],
          });
          ran++;
        } catch (e) {
          err(line, 'run-failed', `\`${inv.raw}\` exited ${e.status ?? '?'}: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
        }
      }
    }
  } else if (runBlocks.length > 0) {
    unresolved.push({
      line: runBlocks[0].startLine, rule: 'run-not-executed',
      message: `${runBlocks.length} \`readme-verify: run\` block(s) were surface-checked but not executed. Pass --run against a live daemon to execute them.`,
    });
  }

  const stats = {
    ...card.stats,
    blocks: blocks.length,
    checkableBlocks: checkable.length,
    commandsChecked,
    flagsChecked,
    flagCorpusSize: flagCorpus.size,
    runBlocks: runBlocks.length,
    runExecuted: ran,
    cliAvailable,
  };

  // ── Report ─────────────────────────────────────────────────────────────────
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: errors.length === 0, stats, errors, warnings, unresolved }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  const c = CI ? { r: '', y: '', b: '', g: '', d: '', x: '' }
               : { r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[34m', g: '\x1b[32m', d: '\x1b[2m', x: '\x1b[0m' };

  console.log(`${c.d}README.md — ${stats.totalLines} lines, ${stats.blocks} blocks (${stats.checkableBlocks} checkable), ${stats.commandsChecked} commands resolved against cli/permission-tiers.ts${c.x}\n`);

  for (const e of errors) console.log(`${c.r}error${c.x}  L${e.line}  ${c.d}${e.rule}${c.x}  ${e.message}`);
  for (const w of warnings) console.log(`${c.y}warn ${c.x}  L${w.line}  ${c.d}${w.rule}${c.x}  ${w.message}`);
  for (const u of unresolved) console.log(`${c.b}unres${c.x}  L${u.line}  ${c.d}${u.rule}${c.x}  ${u.message}`);

  console.log();
  if (errors.length === 0) {
    console.log(`${c.g}readme-accuracy: PASS${c.x} — ${warnings.length} warning(s), ${unresolved.length} unresolved.`);
    if (unresolved.length) console.log(`${c.d}Unresolved checks are NOT passes. They are what this run could not verify.${c.x}`);
  } else {
    console.log(`${c.r}readme-accuracy: FAIL${c.x} — ${errors.length} error(s). The front door is making claims the code does not support.`);
    console.log(`${c.d}Fix the examples, not the gate. See skills/readme-craft/SKILL.md.${c.x}`);
  }

  process.exit(errors.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
