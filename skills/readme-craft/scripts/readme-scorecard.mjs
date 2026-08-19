#!/usr/bin/env node
/**
 * readme-scorecard.mjs — score a README against the readme-craft rubric.
 *
 * Motivation: the craft rules in SKILL.md are only as good as the reader's memory of
 * them. This turns the checkable subset into a command, so "is this README shippable?"
 * has an answer that does not depend on who is reviewing. It is deliberately
 * project-agnostic — no knowledge of any particular CLI — so it can score any
 * repository's README; the project-specific claim-checking (does this verb exist?)
 * belongs in that project's own accuracy gate.
 *
 * Design philosophy: errors block, warnings inform, and the two never blur. A gate that
 * fails the build over a style preference gets bypassed, and a habitually-bypassed gate
 * stops catching the real defects too. Only findings a reader would call a defect —
 * broken media, broken links, no runnable command near the top — are errors.
 *
 * Usage:
 *   node readme-scorecard.mjs README.md
 *   node readme-scorecard.mjs README.md --json
 *   node readme-scorecard.mjs README.md --ci      # no color; exit 1 on errors only
 *
 * Exit codes: 0 = no errors, 1 = errors found, 2 = file unreadable.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { extractFences } from './extract-examples.mjs';

/** Info strings a reader will paste into a shell. */
const SHELLISH = new Set(['bash', 'sh', 'shell', 'zsh', 'console']);

/** Budget ceilings from SKILL.md step 3. Over these, material belongs in docs/. */
export const BUDGET = {
  linesBeforeFirstCommand: 40,
  totalLines: 600,
  fences: 30,
  topLevelSections: 15,
};

/**
 * Adjectives with no verification path. Each is a claim the reader cannot check, and
 * a README's credibility is the sum of its checkable claims.
 */
export const UNVERIFIABLE = [
  'blazing fast', 'lightning fast', 'blazingly fast', 'high performance',
  'powerful', 'robust', 'comprehensive', 'seamless', 'effortless',
  'enterprise-grade', 'production-ready', 'battle-tested', 'cutting-edge',
  'next-generation', 'state-of-the-art', 'world-class', 'best-in-class',
];

/** Constructions that put an expiry date on the document. */
const TEMPORAL = [
  /\bas of v?\d+\.\d+/i,
  /\b(previously|formerly|used to be) (called|named|known as)\b/i,
  /\b(recently|now) (renamed|changed|replaced)\b/i,
  /\b(an? )?(earlier|previous|prior) (draft|version) (said|claimed|described)\b/i,
  /\bwork in progress\b/i,
];

/**
 * Score a README.
 *
 * @param {string} source Raw markdown.
 * @param {string} filePath Path to the file, used to resolve relative links/images.
 * @returns {{errors: object[], warnings: object[], stats: object}} Findings carry
 *          `{line, rule, message}`; `stats` carries the measured budget numbers so a
 *          caller can report the shape of the document, not only its defects.
 *
 * @example
 * const { errors } = scoreReadme('# T\n\nOne line.\n', 'README.md');
 * // errors[0].rule === 'no-runnable-command'
 */
export function scoreReadme(source, filePath) {
  const errors = [];
  const warnings = [];
  const lines = source.split('\n');
  const root = dirname(resolve(filePath));
  const err = (line, rule, message) => errors.push({ line, rule, message });
  const warn = (line, rule, message) => warnings.push({ line, rule, message });

  const blocks = extractFences(source);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) headings.push({ line: i + 1, level: m[1].length, text: m[2].trim() });
  }
  // Headings inside fences are code, not structure.
  const inFence = (line) => blocks.some((b) => line > b.startLine && line < b.endLine);
  const realHeadings = headings.filter((h) => !inFence(h.line));

  const stats = {
    totalLines: lines.length,
    fences: blocks.length,
    topLevelSections: realHeadings.filter((h) => h.level === 2).length,
    // The two-minute gate measures when a reader first meets something they can
    // copy, not when they meet something CI verifies. An install block marked
    // `skip` still gets pasted into a terminal, and it still counts.
    firstCommandLine: blocks.find((b) => SHELLISH.has(b.lang))?.startLine ?? null,
    undeclaredFences: blocks.filter((b) => !b.declared && b.tier !== 'skip').length,
    unreasonedSkips: blocks.filter((b) => b.declared && b.tier === 'skip' && !b.reason).length,
  };

  // ── The ten-second and two-minute gates ────────────────────────────────────
  if (stats.firstCommandLine === null) {
    err(1, 'no-runnable-command', 'No runnable example anywhere. A reader cannot reach a first success.');
  } else if (stats.firstCommandLine > BUDGET.linesBeforeFirstCommand) {
    err(
      stats.firstCommandLine,
      'command-too-deep',
      `First runnable command is at line ${stats.firstCommandLine}; the two-minute gate wants it within ${BUDGET.linesBeforeFirstCommand}.`,
    );
  }

  // ── Media and links must resolve ───────────────────────────────────────────
  for (const ref of collectRefs(lines, blocks)) {
    if (/^(https?:|mailto:|#)/.test(ref.target)) continue;
    const clean = ref.target.split('#')[0].split('?')[0];
    if (!clean) continue;
    const abs = join(root, clean);
    if (existsSync(abs)) continue;
    const rule = ref.kind === 'image' ? 'broken-image' : 'broken-link';
    const msg =
      ref.kind === 'image'
        ? `Image does not resolve: ${ref.target} — renders as a broken-image icon.`
        : `Link target does not exist: ${ref.target}`;
    err(ref.line, rule, msg);
  }

  // ── Budget ─────────────────────────────────────────────────────────────────
  if (stats.totalLines > BUDGET.totalLines) {
    warn(stats.totalLines, 'over-budget-length',
      `${stats.totalLines} lines exceeds the ${BUDGET.totalLines}-line ceiling. Reference material belongs in docs/.`);
  }
  if (stats.fences > BUDGET.fences) {
    warn(1, 'over-budget-fences', `${stats.fences} code blocks exceeds the ${BUDGET.fences} ceiling.`);
  }
  if (stats.topLevelSections > BUDGET.topLevelSections) {
    warn(1, 'over-budget-sections',
      `${stats.topLevelSections} top-level sections exceeds the ${BUDGET.topLevelSections} ceiling.`);
  }

  // ── Verification hygiene ───────────────────────────────────────────────────
  for (const b of blocks) {
    if (b.unterminated) err(b.startLine, 'unterminated-fence', 'Fence is never closed.');
    if (b.declared && b.tier === 'skip' && !b.reason) {
      warn(b.startLine, 'unreasoned-skip', 'readme-verify: skip without a stated reason.');
    }
  }

  // ── Structure ──────────────────────────────────────────────────────────────
  const toc = realHeadings.find((h) => /^(table of )?contents$/i.test(h.text.replace(/[^\w ]/g, '').trim()));
  if (toc && stats.firstCommandLine !== null && toc.line < stats.firstCommandLine) {
    warn(toc.line, 'toc-before-pitch',
      'Table of contents appears before the first example. A reader who has not decided to stay does not want a directory.');
  }
  const license = realHeadings.filter((h) => h.level === 2).slice(-1)[0];
  if (license && !/licen[cs]e/i.test(license.text)) {
    warn(license.line, 'license-not-last', `Last section is "${license.text}"; license should be the final section.`);
  }

  // ── Voice ──────────────────────────────────────────────────────────────────
  // Measured at the section level: a stray emoji in a sub-heading is voice, but emoji
  // on most top-level sections is a bullet system pretending to be one.
  const emojiRe = /\p{Extended_Pictographic}/u;
  const sections = realHeadings.filter((h) => h.level === 2);
  const emojiSections = sections.filter((h) => emojiRe.test(h.text));
  if (sections.length >= 6 && emojiSections.length / sections.length > 0.5) {
    warn(emojiSections[0].line, 'emoji-bullet-system',
      `${emojiSections.length}/${sections.length} top-level sections carry emoji. Emoji are an accent, not a bullet system — they defeat scanning and screen readers announce each by name.`);
  }
  for (const h of realHeadings) {
    const words = h.text.replace(/[^\w\s-]/g, '').trim().split(/\s+/).filter(Boolean);
    const titleCased = words.filter((w) => /^[A-Z][a-z]{2,}$/.test(w)).length;
    if (words.length >= 3 && titleCased >= words.length - 1) {
      warn(h.line, 'title-case-heading', `Heading "${h.text}" is Title Case; use sentence case.`);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    if (inFence(i + 1)) continue;
    const lower = lines[i].toLowerCase();
    for (const adj of UNVERIFIABLE) {
      if (lower.includes(adj)) {
        warn(i + 1, 'unverifiable-claim', `"${adj}" is a claim the reader cannot check. Replace with a number or delete.`);
      }
    }
    for (const re of TEMPORAL) {
      if (re.test(lines[i])) {
        warn(i + 1, 'temporal-narration',
          'Version-scoped or revision-history narration. Write every version as if it is the first anyone has seen.');
        break;
      }
    }
  }

  return { errors, warnings, stats };
}

/** Collect image and link references outside code fences, with line numbers. */
function collectRefs(lines, blocks) {
  const refs = [];
  const inFence = (line) => blocks.some((b) => line > b.startLine && line < b.endLine);
  for (let i = 0; i < lines.length; i++) {
    if (inFence(i + 1)) continue;
    const line = lines[i];
    for (const m of line.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) refs.push({ line: i + 1, kind: 'image', target: m[1] });
    for (const m of line.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)/g)) refs.push({ line: i + 1, kind: 'link', target: m[1] });
    for (const m of line.matchAll(/<img[^>]+src=["']([^"']+)["']/g)) refs.push({ line: i + 1, kind: 'image', target: m[1] });
  }
  return refs;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const path = argv.find((a) => !a.startsWith('-')) ?? 'README.md';
  const ci = argv.includes('--ci');
  const jsonOut = argv.includes('--json');

  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch (e) {
    console.error(`readme-scorecard: cannot read ${path}: ${e.message}`);
    process.exit(2);
  }

  const { errors, warnings, stats } = scoreReadme(source, path);

  if (jsonOut) {
    console.log(JSON.stringify({ file: path, ok: errors.length === 0, stats, errors, warnings }, null, 2));
    process.exit(errors.length ? 1 : 0);
  }

  const c = ci ? { r: '', y: '', g: '', d: '', x: '' }
              : { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', x: '\x1b[0m' };

  console.log(`${c.d}${path} — ${stats.totalLines} lines, ${stats.fences} fences, ${stats.topLevelSections} sections, first command at line ${stats.firstCommandLine ?? 'n/a'}${c.x}\n`);

  for (const e of errors) console.log(`${c.r}error${c.x}  L${e.line}  ${c.d}${e.rule}${c.x}  ${e.message}`);
  for (const w of warnings) console.log(`${c.y}warn ${c.x}  L${w.line}  ${c.d}${w.rule}${c.x}  ${w.message}`);

  console.log();
  if (errors.length === 0 && warnings.length === 0) console.log(`${c.g}scorecard: clean${c.x}`);
  else console.log(`scorecard: ${errors.length} error(s), ${warnings.length} warning(s)`);

  process.exit(errors.length ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
