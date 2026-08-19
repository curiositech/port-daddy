#!/usr/bin/env node
/**
 * extract-examples.mjs — pull every fenced code block out of a markdown file,
 * with provenance and a declared verification tier.
 *
 * Motivation: an unverified README example is worse than a missing one, because it
 * teaches the reader that the document is decorative and that lesson generalizes to
 * every other claim on the page. Nothing can verify examples until something can
 * reliably *find* them, together with the line numbers needed to report a finding a
 * human can act on. This is that something — deliberately a library first and a CLI
 * second, so the repo's accuracy gate imports `extractFences()` rather than
 * re-implementing fence parsing (and re-implementing its bugs).
 *
 * Design: a real delimiter-tracking parser, not a regex sweep. A block opened with a
 * run of N backticks closes only on a run of >= N backticks at the same or lower
 * indentation. Documentation about markdown routinely nests fences, and a naive
 * /^```/ scan mis-pairs them — silently, producing a parse that looks fine and drops
 * half the file's examples.
 *
 * Verification tiers are declared on the first line inside a block:
 *
 *   # readme-verify: run       execute in CI; non-zero exit is a build failure
 *   # readme-verify: surface   resolve every verb/flag against the CLI registry
 *   # readme-verify: skip — <reason>   deliberately unchecked; reason required
 *
 * Usage:
 *   node extract-examples.mjs README.md            # human-readable table
 *   node extract-examples.mjs README.md --json     # machine-readable
 *   node extract-examples.mjs README.md --tier run # filter to one tier
 *
 * Exit codes: 0 = extracted, 2 = file unreadable or no path given.
 */

import { readFileSync } from 'node:fs';

/** Tiers a block may declare. `surface` is the default for shell blocks. */
export const TIERS = ['run', 'surface', 'skip'];

/** Info strings we treat as shell, and therefore surface-checkable by default. */
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

const VERIFY_RE = /^\s*(?:#|\/\/|<!--)\s*readme-verify:\s*(\w+)\s*(?:[—–-]+\s*(.*?))?\s*(?:-->)?\s*$/;

/**
 * Parse a markdown source into its fenced code blocks.
 *
 * Why it returns objects rather than strings: every downstream consumer (the accuracy
 * gate, the scorecard, an agent fixing findings) needs to point a human at a line, and
 * threading that through as a side channel is how line numbers end up off by the size
 * of the preceding block.
 *
 * @param {string} source Raw markdown text.
 * @param {{defaultTier?: string}} [opts] `defaultTier` applies to shell blocks that
 *        declare nothing; non-shell blocks default to `skip`.
 * @returns {Array<{lang: string, tier: string, reason: string|null, declared: boolean,
 *          startLine: number, endLine: number, code: string, lines: string[]}>}
 *          One entry per fenced block, in document order. `startLine` is 1-indexed and
 *          points at the opening fence.
 *
 * @example
 * extractFences('```bash\npd status\n```\n')
 * // => [{ lang: 'bash', tier: 'surface', declared: false, startLine: 1, ... }]
 */
export function extractFences(source, opts = {}) {
  const defaultTier = opts.defaultTier ?? 'surface';
  const lines = source.split('\n');
  const blocks = [];

  let open = null; // { fenceChar, fenceLen, indent, lang, startLine, body: [] }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);

    if (open) {
      // A closing fence is the same char, at least as long, and carries no info string.
      if (m && m[2][0] === open.fenceChar && m[2].length >= open.fenceLen && m[3].trim() === '') {
        blocks.push(finalize(open, i + 1, defaultTier));
        open = null;
      } else {
        open.body.push(line);
      }
      continue;
    }

    if (m) {
      open = {
        fenceChar: m[2][0],
        fenceLen: m[2].length,
        indent: m[1].length,
        lang: (m[3].trim().split(/\s+/)[0] || '').toLowerCase(),
        startLine: i + 1,
        body: [],
      };
    }
  }

  // An unterminated fence is a markdown bug worth surfacing rather than swallowing.
  if (open) {
    const block = finalize(open, lines.length, defaultTier);
    block.unterminated = true;
    blocks.push(block);
  }

  return blocks;
}

function finalize(open, endLine, defaultTier) {
  const body = open.body;
  let tier = null;
  let reason = null;
  let declared = false;

  if (body.length > 0) {
    const hit = VERIFY_RE.exec(body[0]);
    if (hit && TIERS.includes(hit[1])) {
      tier = hit[1];
      reason = hit[2]?.trim() || null;
      declared = true;
      body.shift();
    }
  }

  if (!tier) {
    tier = SHELL_LANGS.has(open.lang) ? defaultTier : 'skip';
  }

  return {
    lang: open.lang || '(none)',
    tier,
    reason,
    declared,
    startLine: open.startLine,
    endLine,
    code: body.join('\n'),
    lines: body,
    unterminated: false,
  };
}

/**
 * Split a shell block into candidate command invocations.
 *
 * Purpose: surface-checking needs the commands, not the prose. README shell blocks mix
 * commands, comments, printed output, and continuation lines; feeding all of that to a
 * verb resolver produces noise findings, and noise findings are how a gate loses its
 * credibility and starts getting bypassed.
 *
 * @param {string} code The block body.
 * @returns {Array<{line: number, raw: string, argv: string[]}>} Invocations, with
 *          `line` relative to the block body (1-indexed).
 */
export function shellInvocations(code) {
  const out = [];
  const src = code.split('\n');
  let pending = '';
  let pendingLine = 0;

  // When a block uses the `$ ` prompt convention, the author has told us exactly which
  // lines are commands — everything else is captured output. Honor that, or a printed
  // line that happens to start with the tool's name gets parsed as an invocation and
  // checked as if the author had written it.
  const prompted = src.some((l) => /^\s*\$ \S/.test(l));

  for (let i = 0; i < src.length; i++) {
    let line = src[i];
    if (prompted && !pending && !/^\s*\$ \S/.test(line)) continue;

    if (pending) {
      line = `${pending} ${line.trim()}`;
    } else {
      pendingLine = i + 1;
    }

    // Line continuation — join and keep going.
    if (/\\\s*$/.test(line)) {
      pending = line.replace(/\\\s*$/, '').trim();
      continue;
    }
    pending = '';

    const raw = line.trim();
    if (!raw) continue;
    if (raw.startsWith('#')) continue; // comment
    // Output lines conventionally marked with an arrow or a leading glyph.
    if (/^(#|\/\/|→|=>|\.\.\.)/.test(raw)) continue;

    const stripped = raw.replace(/^\$\s+/, '');
    const argv = tokenize(stripped);
    if (argv.length === 0) continue;

    out.push({ line: pendingLine, raw: stripped, argv });
  }

  return out;
}

/**
 * Tokenize a shell-ish command line into argv, dropping the noise a surface checker
 * must not trip on: `sudo`, leading `VAR=value` assignments, and anything after a pipe
 * or `&&` (which is a different command and gets its own entry via the caller).
 *
 * Rationale: this is deliberately not a shell parser. It handles the constructs that
 * actually appear in READMEs and refuses to guess at the rest, because a checker that
 * half-parses `$(...)` produces confident wrong findings.
 *
 * @param {string} cmd A single command line.
 * @returns {string[]} argv with noise removed; empty when nothing checkable remains.
 */
export function tokenize(cmd) {
  // Take only the first segment of a pipeline / list; callers that care about the rest
  // can split first.
  let head = cmd.split(/\s*(?:\|\||&&|\||;)\s*/)[0];

  // Strip a trailing inline comment. README examples annotate almost every line this
  // way, and leaving the `#` in argv makes it look like a subcommand — which produces
  // confident nonsense findings ("`pd attention #` is not a known subcommand"). Only
  // strip a `#` that starts a token, so `--tag=#1` survives.
  head = head.replace(/(^|\s)#.*$/, '').trim();

  const parts = head.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  const argv = [];

  for (const part of parts) {
    if (argv.length === 0) {
      if (part === 'sudo' || part === 'command' || part === 'exec') continue;
      if (/^[A-Z_][A-Z0-9_]*=/.test(part)) continue; // env prefix
    }
    argv.push(part.replace(/^["']|["']$/g, ''));
  }

  return argv;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const path = argv.find((a) => !a.startsWith('-'));
  if (!path) {
    console.error('usage: extract-examples.mjs <file.md> [--json] [--tier run|surface|skip]');
    process.exit(2);
  }

  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`extract-examples: cannot read ${path}: ${err.message}`);
    process.exit(2);
  }

  const tierIdx = argv.indexOf('--tier');
  const wanted = tierIdx >= 0 ? argv[tierIdx + 1] : null;

  let blocks = extractFences(source);
  if (wanted) blocks = blocks.filter((b) => b.tier === wanted);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ file: path, count: blocks.length, blocks }, null, 2));
    return;
  }

  console.log(`${path}: ${blocks.length} fenced block(s)\n`);
  for (const b of blocks) {
    const mark = b.declared ? '' : ' (inferred)';
    const why = b.reason ? ` — ${b.reason}` : '';
    console.log(`  L${String(b.startLine).padStart(4)}  ${b.lang.padEnd(10)} ${b.tier}${mark}${why}`);
    if (b.unterminated) console.log('        !! unterminated fence');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
