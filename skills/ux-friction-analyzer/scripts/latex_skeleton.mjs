#!/usr/bin/env node
/**
 * LaTeX -> surface-graph skeleton.
 *
 * Turns a LaTeX source tree into a partially-filled graph for
 * scripts/surfer_model.mjs, so auditing a 400-page book is ten minutes of
 * analyst judgement rather than an afternoon of transcription.
 *
 * WHAT IT EXTRACTS (all of it structural, from LaTeX's own control sequences -
 * this is parsing a markup grammar, not keyword-matching prose):
 *   - sectioning commands, in order, as nodes
 *   - word counts per section -> costSeconds at a stated reading rate
 *   - display-math and float counts -> extra reading time, attentionElements
 *   - \label ownership, and every \ref / \eqref / \cref / \autoref
 *
 * The cross-reference graph is the valuable part. A \ref in section 7 pointing
 * at a \label in section 2 is an author-declared dependency with a distance of
 * five sections, and the surfer model already knows what to do with that. So
 * each label is emitted as a concept "introduced" by its owning section and
 * "required" by every section that references it. That makes definition
 * distance, regression pull, and forward references fall out of the source for
 * free, before the analyst has read a word.
 *
 * WHAT IT DOES NOT DO - and what you must still supply by hand:
 *   - `payoff` and `hook`: what a section is worth, and whether its ending
 *     pulls you on. Nothing in the source knows this.
 *   - real `newConcepts` / `requiresConcepts`: the ideas, not just the labels.
 *     Most prerequisites in a book are never \ref'd. See
 *     references/comprehension-debt.md for how to build the concept lists.
 *   - `gestalt` scores: these require looking at the rendered PDF, not the
 *     source. Typeset it first.
 *   - `payoffNodes`: which sections deliver the promised value.
 *
 * A skeleton run straight into surfer_model.mjs will report near-total
 * abandonment, because every section has payoff 0 and hook 0. That output is
 * meaningless. Fill in the TODOs first; the `_todo` array in the output says
 * which.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECTION_LEVELS = ['part', 'chapter', 'section', 'subsection', 'subsubsection'];
const FLOAT_ENVS = ['figure', 'figure*', 'table', 'table*', 'algorithm', 'listing'];
const CLAIM_ENVS = ['theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'example', 'proof'];
const DISPLAY_MATH_ENVS = ['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'eqnarray'];
const REF_COMMANDS = ['ref', 'eqref', 'cref', 'Cref', 'autoref', 'pageref', 'nameref'];

const SECONDS_PER_DISPLAY_EQUATION = 20; // a display equation is not read at prose speed
const SECONDS_PER_FLOAT = 20;            // a figure or table people actually stop at
const MAX_INCLUDE_DEPTH = 6;

/** Read a balanced {...} argument starting at the '{' at `start`. */
function readBracedArg(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
    }
  }
  return null;
}

/** Strip line comments, honouring escaped percent signs. */
function stripComments(text) {
  return text
    .split('\n')
    .map((line) => {
      let out = '';
      for (let i = 0; i < line.length; i += 1) {
        if (line[i] === '\\') { out += line.slice(i, i + 2); i += 1; continue; }
        if (line[i] === '%') break;
        out += line[i];
      }
      return out;
    })
    .join('\n');
}

/**
 * Inline \input{} and \include{} so the whole book reads as one string, with
 * comments stripped. Exported so callers (and tests) exercise the same path
 * the CLI does rather than re-implementing the flattening.
 */
export function flattenLatexSource(path, depth = 0, seen = new Set()) {
  const abs = resolve(path);
  if (depth > MAX_INCLUDE_DEPTH || seen.has(abs)) return '';
  seen.add(abs);
  if (!existsSync(abs)) return '';

  const base = dirname(abs);
  let text = stripComments(readFileSync(abs, 'utf8'));

  for (const cmd of ['input', 'include']) {
    const marker = `\\${cmd}{`;
    let idx = text.indexOf(marker);
    while (idx !== -1) {
      const arg = readBracedArg(text, idx + marker.length - 1);
      if (!arg) break;
      const raw = arg.value.trim();
      const candidate = isAbsolute(raw) ? raw : join(base, raw);
      const target = existsSync(candidate) ? candidate : `${candidate}.tex`;
      const inlined = flattenLatexSource(target, depth + 1, seen);
      text = text.slice(0, idx) + inlined + text.slice(arg.end);
      idx = text.indexOf(marker, idx + inlined.length);
    }
  }
  return text;
}

/** Count prose words, with math and control sequences removed rather than counted. */
function countWords(segment) {
  const withoutMath = segment
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ');
  const withoutCommands = withoutMath
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}\\&~^_#]/g, ' ');
  return withoutCommands.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w)).length;
}

function countEnvironments(segment, names) {
  let total = 0;
  for (const name of names) {
    const escaped = name.replace(/[*]/g, '\\*');
    total += (segment.match(new RegExp(`\\\\begin\\{${escaped}\\}`, 'g')) ?? []).length;
  }
  return total;
}

/** Collect every `\cmd{a,b}` argument for the given commands, comma-split. */
function collectArgs(segment, commands) {
  const found = [];
  for (const cmd of commands) {
    const marker = `\\${cmd}`;
    let idx = segment.indexOf(marker);
    while (idx !== -1) {
      // Reject a longer command that merely starts with this one (\reflect vs \ref).
      const after = segment[idx + marker.length];
      if (after === '{' || after === '[') {
        const brace = segment.indexOf('{', idx + marker.length);
        const arg = brace === -1 ? null : readBracedArg(segment, brace);
        if (arg) for (const part of arg.value.split(',')) {
          const key = part.trim();
          if (key) found.push(key);
        }
      }
      idx = segment.indexOf(marker, idx + marker.length);
    }
  }
  return found;
}

/**
 * Build a surface-graph skeleton from a flattened LaTeX string.
 *
 * @param {string} text - flattened LaTeX source
 * @param {{level?: string, wpm?: number, readerMode?: string}} options
 */
export function buildLatexSkeleton(source, options = {}) {
  if (typeof source !== 'string') throw new Error('source must be a string');
  let text = source;

  const level = options.level ?? 'section';
  const levelIndex = SECTION_LEVELS.indexOf(level);
  if (levelIndex === -1) {
    throw new Error(`level must be one of: ${SECTION_LEVELS.join(', ')}`);
  }
  const wpm = Math.max(1, Number(options.wpm) || 120);
  const kept = SECTION_LEVELS.slice(0, levelIndex + 1);

  // Only the document body counts. Preambles routinely define macros whose
  // bodies contain \section*{...} (a generated "Solutions" heading, a running
  // head), and those are not sections of the document. Dropping everything
  // before \begin{document} removes that whole class of phantom node.
  const bodyStart = text.indexOf('\\begin{document}');
  if (bodyStart !== -1) text = text.slice(bodyStart);

  // Locate every sectioning command at or above the chosen level.
  const marks = [];
  for (const name of kept) {
    for (const suffix of ['{', '*{', '['] ) {
      const marker = `\\${name}${suffix}`;
      let idx = text.indexOf(marker);
      while (idx !== -1) {
        const brace = text.indexOf('{', idx + `\\${name}`.length);
        const arg = brace === -1 ? null : readBracedArg(text, brace);
        marks.push({
          at: idx,
          level: name,
          title: arg ? arg.value.replace(/\\[a-zA-Z@]+\*?/g, '').replace(/[{}]/g, '').trim() : name,
          bodyStart: arg ? arg.end : idx + marker.length,
        });
        idx = text.indexOf(marker, idx + marker.length);
      }
    }
  }
  marks.sort((a, b) => a.at - b.at);

  if (marks.length === 0) {
    throw new Error(
      `no \\${kept.join('/\\')} commands found - check --input points at the main .tex file, or lower --level`
    );
  }

  // Slice the document into one segment per sectioning mark.
  const slugCounts = new Map();
  const nodes = marks.map((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const segment = text.slice(mark.bodyStart, end);

    const words = countWords(segment);
    const displayMath =
      countEnvironments(segment, DISPLAY_MATH_ENVS) +
      (segment.match(/\\\[/g) ?? []).length;
    const floats = countEnvironments(segment, FLOAT_ENVS);
    const claims = countEnvironments(segment, CLAIM_ENVS);

    const baseSlug =
      mark.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || mark.level;
    const seen = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, seen + 1);

    return {
      id: seen === 0 ? baseSlug : `${baseSlug}-${seen + 1}`,
      label: `${mark.title || mark.level}`,
      level: mark.level,
      words,
      displayMath,
      floats,
      claims,
      labels: collectArgs(segment, ['label']),
      refs: collectArgs(segment, REF_COMMANDS),
      costSeconds: Math.round(
        (words / wpm) * 60 + displayMath * SECONDS_PER_DISPLAY_EQUATION + floats * SECONDS_PER_FLOAT
      ),
    };
  });

  // Label ownership: first section to declare a label owns it.
  const owner = new Map();
  nodes.forEach((node, i) => {
    for (const label of node.labels) if (!owner.has(label)) owner.set(label, i);
  });

  const forwardReferences = [];
  const danglingReferences = [];

  const graphNodes = nodes.map((node, i) => {
    const required = [];
    for (const ref of node.refs) {
      const at = owner.get(ref);
      if (at === undefined) {
        danglingReferences.push({ from: node.id, ref });
        continue;
      }
      if (at === i) continue; // self-reference within the section costs nothing
      if (at > i) forwardReferences.push({ from: node.id, to: nodes[at].id, ref, distance: at - i });
      required.push(`label:${ref}`);
    }

    return {
      id: node.id,
      label: node.label,
      kind: node.claims > 0 ? 'theorem' : node.floats > 0 ? 'figure' : 'prose',
      costSeconds: Math.max(5, node.costSeconds),
      newConcepts: node.labels.map((l) => `label:${l}`),
      requiresConcepts: [...new Set(required)],
      // Analyst must replace these. Left at 0 so a premature run reads as
      // obviously-unfilled rather than plausibly-wrong.
      payoff: 0,
      hook: 0,
      attentionElements: Math.min(12, 1 + node.floats + Math.min(3, Math.ceil(node.displayMath / 4))),
      _extracted: {
        level: node.level,
        words: node.words,
        displayMath: node.displayMath,
        floats: node.floats,
        claimEnvironments: node.claims,
      },
      links: i + 1 < nodes.length ? [{ to: nodes[i + 1].id, kind: 'sequential', weight: 1 }] : [],
    };
  });

  const totalSeconds = graphNodes.reduce((s, n) => s + n.costSeconds, 0);

  return {
    surfaceKind: 'latex-book',
    readerMode: options.readerMode ?? 'skim',
    entryNodes: [graphNodes[0].id],
    payoffNodes: [],
    nodes: graphNodes,
    _todo: [
      'Set payoffNodes: which sections actually deliver the value the book promises.',
      'Set payoff (0-1) on every node: how much of that value this section delivers.',
      'Set hook (0-1) on every node: does its ending pull the reader onward?',
      'Add real newConcepts/requiresConcepts. Only \\label-ed cross-references were extracted; most prerequisites in a book are never \\ref-ed. See references/comprehension-debt.md.',
      'Add gestalt scores per node from the TYPESET PDF, not the source. See references/gestalt-operators.md.',
      'Set patienceBudget.seconds for the reading occasion you are modelling, and say where the number came from.',
      'Add mid-document entryNodes if readers arrive from search or a shared link.',
    ],
    _extraction: {
      sectioningLevel: level,
      wordsPerMinute: wpm,
      sections: graphNodes.length,
      totalWords: nodes.reduce((s, n) => s + n.words, 0),
      estimatedReadingSeconds: totalSeconds,
      estimatedReadingHours: Number((totalSeconds / 3600).toFixed(2)),
      labelsDeclared: owner.size,
      forwardReferences,
      danglingReferences,
      note:
        'Structural extraction only. Nothing here is a judgement about the book. ' +
        'A skeleton run through surfer_model.mjs before the _todo items are filled in ' +
        'will report near-total abandonment purely because payoff and hook are 0.',
      caveats: [
        'Only \\label{} declares a label here. A document that mints labels through a custom environment argument (\\begin{myexercise}{ex:foo}) will show those as danglingReferences even though they resolve when typeset. Check before reporting one.',
        'Only \\input and \\include are followed. A label defined in a file reached another way reads as dangling.',
        'Node order is source order. If the typeset order differs (appendices, \\frontmatter, floats), reorder the nodes by hand before running the surfer model, because node order IS reading order.',
      ],
    },
  };
}

function parseArgs(argv) {
  const opts = { input: null, level: 'section', wpm: 120, readerMode: 'skim' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') opts.input = argv[++i];
    else if (arg === '--level') opts.level = argv[++i];
    else if (arg === '--wpm') opts.wpm = Number(argv[++i]);
    else if (arg === '--mode') opts.readerMode = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.input) {
    throw new Error('usage: latex_skeleton.mjs --input <main>.tex [--level chapter|section|subsection] [--wpm 120] [--mode skim|scan|study|task]');
  }
  return opts;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (!existsSync(opts.input)) throw new Error(`no such file: ${opts.input}`);
    const flattened = flattenLatexSource(opts.input);
    const skeleton = buildLatexSkeleton(flattened, opts);
    process.stdout.write(`${JSON.stringify(skeleton, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`latex_skeleton: ${error.message}\n`);
    process.exit(1);
  }
}
