#!/usr/bin/env node
/**
 * Build a binder-coverage-spec from the binder itself.
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN JSON. The Architect of Record skill
 * audits a spec; nothing produced one, so the binder had never been through
 * its own framework. A spec typed by hand would be a snapshot of one reading
 * on one day: chapters are added (the binder has grown from 17 documents to
 * 30 since the baseline work packet was written, and that packet's required
 * reading still stops at chapter 16), gates are added and removed, and a
 * stale spec would report a clean binder because nobody re-typed it. This
 * reads the binder every run, so the audit measures the binder that exists.
 *
 * WHAT COUNTS AS A CLAIMED CAPABILITY. Not every sentence — that would be a
 * judgment call dressed as a measurement. The unit is the binder's own
 * convention: a `Gate:` / `Acceptance gates:` / `Human gate:` / `Proof gate:`
 * block is the place a chapter commits to something testable, so each one is
 * a claimed capability named by the heading above it, carrying that gate.
 *
 * A chapter with NO gate block is not therefore gate-free of claims: it is a
 * chapter making claims with nothing testable attached. Those contribute one
 * capability named for the chapter, with no gate — which is exactly the
 * `capability-without-owner-gate-evidence` finding the audit exists to raise,
 * and must not be suppressed to make a score look better.
 *
 * OWNER and EVIDENCE are extracted only where the text actually carries them:
 * an explicit "Owner:"/"Resolution owner:" near the section, and a link to a
 * PR, commit, test path or script. Inferring an owner from a chapter's topic
 * would manufacture the accountability the audit is checking for.
 *
 * Usage:
 *   node scripts/binder/build_coverage_spec.mjs            # write the spec
 *   node scripts/binder/build_coverage_spec.mjs --check    # fail if stale
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BINDER = join(REPO, 'docs/architecture/agent-harbor-technical-binder');
const OUT = join(BINDER, 'binder-coverage-spec.json');

const GATE_RE = /^\s*(Gate|Acceptance gates?|Human gate|Proof gate)s?:\s*$/i;
const HEADING_RE = /^(#{1,4})\s+(.*)$/;
const OWNER_RE = /(?:^|\s)(?:Resolution owner|Owner)\s*:\s*([^.\n]+)/i;
const EVIDENCE_RE =
  /(?:PR\s*#\d+|https?:\/\/\S+|`[^`]*\.(?:ts|tsx|mjs|py|rs|tla|pv|sql)`|\btests?\/\S+)/;

/** The documents in scope: every markdown file in the binder root. */
function binderDocuments() {
  return readdirSync(BINDER)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/**
 * Capabilities in one document.
 *
 * Walks the file once, tracking the most recent heading, and emits a
 * capability at each gate block. The gate's text is the indented lines that
 * follow it, which is how the binder writes them.
 */
function capabilitiesOf(file) {
  const text = readFileSync(join(BINDER, file), 'utf8');
  const lines = text.split('\n');
  const out = [];
  let heading = null;

  for (let i = 0; i < lines.length; i += 1) {
    const h = HEADING_RE.exec(lines[i]);
    if (h) {
      heading = h[2].trim();
      continue;
    }
    if (!GATE_RE.test(lines[i])) continue;

    const body = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const l = lines[j];
      if (l.trim() === '' && body.length) break;
      if (l.trim() === '') continue;
      if (!/^\s/.test(l) && !/^-\s/.test(l)) break;
      body.push(l.trim());
      if (body.length > 6) break;
    }
    const gate = body.join(' ').slice(0, 400);
    if (!gate) continue;

    // Look for an owner and evidence in the section this gate belongs to:
    // the window from the heading down to a few lines past the gate.
    const window = lines.slice(Math.max(0, i - 25), i + 8).join('\n');
    const owner = OWNER_RE.exec(window);
    const evidence = EVIDENCE_RE.exec(window);

    const cap = {
      name: heading ? `${heading}` : `${file} (untitled section)`,
      gate,
      sourceLine: i + 1,
    };
    if (owner) cap.owner = owner[1].trim();
    if (evidence) cap.evidenceLink = evidence[0].replace(/`/g, '');
    out.push(cap);
  }

  if (out.length === 0) {
    // A chapter with no gate block still claims things; recording it as one
    // ungated capability is what makes that visible to the audit instead of
    // letting a silent chapter read as a clean one.
    const title = (text.match(/^#\s+(.*)$/m) || [, basename(file, '.md')])[1];
    out.push({
      name: `${title} (chapter-level claim, no acceptance gate in text)`,
      sourceLine: 1,
    });
  }
  return out;
}

/**
 * Contradictions the binder itself records.
 *
 * Read from chapter 17's interim register rather than restated here, so a
 * contradiction closed in the binder closes in the audit, and one added there
 * appears here without anyone remembering to update a list.
 */
function contradictions() {
  const p = join(BINDER, '17-ambition-archaeology-consistency-proposals.md');
  if (!existsSync(p)) return [];
  const text = readFileSync(p, 'utf8');
  const out = [];
  const re = /^(CR-\d+)\s*\((\w[\w-]*),\s*([^)]*)\):/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, id, rawKind, rawState] = m;
    // The register writes "process" for CR-4, which is not one of the four
    // audit kinds; map it to the nearest ("authority" — who may dispatch a
    // wave without a binder update) rather than dropping the row.
    const kind = ['term', 'authority', 'schema', 'shipped-vs-target'].includes(rawKind)
      ? rawKind
      : 'authority';
    // `resolved` must be anchored: the register writes "unresolved", which
    // CONTAINS "resolved", so an unanchored test marked all four contradictions
    // closed and the audit reported "4/4 resolved" on a binder with three open
    // ones. That is precisely the coverage theater this audit exists to catch,
    // produced by the tool doing the catching.
    const resolved = /^resolved\b/i.test(rawState.trim());
    out.push({ id, kind, resolved, note: rawState.trim() });
  }
  return out;
}

/**
 * The ambition corpus, read from the baseline work packet's required-reading
 * list — the corpus the binder itself says must be swept. Classification is
 * NOT inferred: it is looked up in the sweep file, and anything absent from
 * that file stays null, which is the `ambition-unclassified` finding.
 */
function ambitionCorpus() {
  const packet = join(BINDER, 'work-packets/harbor-architect-baseline-ambition-archaeology.md');
  const sweep = join(BINDER, 'ambition-archaeology-sweep.json');
  const classified = existsSync(sweep)
    ? JSON.parse(readFileSync(sweep, 'utf8'))
    : {};
  if (!existsSync(packet)) return [];
  const text = readFileSync(packet, 'utf8');
  const start = text.indexOf('## Required reading');
  const end = text.indexOf('## Output file');
  const region = text.slice(start, end > start ? end : undefined);
  const names = [...region.matchAll(/^-\s+`([^`]+)`/gm)]
    .map((m) => m[1])
    // The binder's own chapters are the thing being reconciled AGAINST, not
    // ambitions to be reconciled; only the outside corpus is swept.
    .filter((n) => !n.includes('agent-harbor-technical-binder/'));
  return [...new Set(names)].map((name) => ({
    name,
    classification: classified[name] ?? null,
  }));
}

function coverageMatrix() {
  // Read from a file the sweep writes, so these three booleans can never be
  // hand-set to true in the spec to make a run pass. Absent file = not done.
  const p = join(BINDER, 'coverage-matrix.json');
  const empty = {
    customerAxisComplete: false,
    contingencyAxisComplete: false,
    architectureAxisComplete: false,
  };
  if (!existsSync(p)) return empty;
  const m = JSON.parse(readFileSync(p, 'utf8'));
  return {
    customerAxisComplete: m.customerAxisComplete === true,
    contingencyAxisComplete: m.contingencyAxisComplete === true,
    architectureAxisComplete: m.architectureAxisComplete === true,
  };
}

function build() {
  const documents = binderDocuments().map((name) => ({
    name,
    claimedCapabilities: capabilitiesOf(name),
  }));
  return {
    $comment:
      'GENERATED by scripts/binder/build_coverage_spec.mjs from the binder itself. ' +
      'Do not hand-edit: classifications live in ambition-archaeology-sweep.json, ' +
      'matrix booleans in coverage-matrix.json, contradictions in chapter 17.',
    generatedFrom: 'docs/architecture/agent-harbor-technical-binder',
    documents,
    contradictions: contradictions(),
    ambitionCorpus: ambitionCorpus(),
    coverageMatrix: coverageMatrix(),
  };
}

const spec = build();
const json = `${JSON.stringify(spec, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current !== json) {
    console.error(
      'binder-coverage-spec.json is stale. Run: node scripts/binder/build_coverage_spec.mjs',
    );
    process.exit(1);
  }
  console.log('binder-coverage-spec.json is a fresh read of the binder');
} else {
  writeFileSync(OUT, json);
  const caps = spec.documents.reduce((n, d) => n + d.claimedCapabilities.length, 0);
  const gated = spec.documents.reduce(
    (n, d) => n + d.claimedCapabilities.filter((c) => c.gate).length, 0);
  console.log(
    `${spec.documents.length} documents, ${caps} claimed capabilities ` +
    `(${gated} with an acceptance gate, ${caps - gated} without), ` +
    `${spec.contradictions.length} contradictions, ` +
    `${spec.ambitionCorpus.length} ambition families -> ${OUT}`,
  );
}
