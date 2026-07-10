#!/usr/bin/env node
/**
 * detect-eureka-arcs — CLI proof for the eureka arc detector (WS-2).
 *
 * Scans Claude Code / Workflow session transcripts and prints candidate
 * "failure → failure → success" arcs as JSON. Pure structured detection — no
 * keyword NLP (see lib/session-intel/eureka-arc-detector.js).
 *
 * Usage:
 *   node tools/session-intel/detect-eureka-arcs.js [options] [file-or-dir ...]
 *
 * With no path args it scans ~/.claude/projects (all sessions on this machine).
 *
 * Options:
 *   --min-failures N   min failures before the breakthrough (default 2)
 *   --sim N            Jaccard similarity threshold, 0..1 (default 0.6)
 *   --limit N          only scan the N biggest transcripts (default: all)
 *   --top N            print only the first N arcs (default: all)
 *   --pretty           indent the JSON output
 *   --count            print only { files, arcs } summary
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectArcsFromText } from '../../lib/session-intel/eureka-arc-detector.js';

function parseArgs(argv) {
  const opts = { minFailures: 2, sim: 0.6, limit: Infinity, top: Infinity, pretty: false, count: false, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--min-failures') opts.minFailures = Number(argv[++i]);
    else if (a === '--sim') opts.sim = Number(argv[++i]);
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else if (a === '--top') opts.top = Number(argv[++i]);
    else if (a === '--pretty') opts.pretty = true;
    else if (a === '--count') opts.count = true;
    else if (a === '-h' || a === '--help') { printHelp(); process.exit(0); }
    else if (a.startsWith('--')) { console.error('unknown option: ' + a); process.exit(2); }
    else opts.paths.push(a);
  }
  return opts;
}

function printHelp() {
  console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').filter((l) => l.startsWith(' *')).map((l) => l.slice(3)).join('\n'));
}

/** Recursively collect .jsonl transcripts under a file or directory path. */
function collectTranscripts(p) {
  let st;
  try { st = fs.statSync(p); } catch { return []; }
  if (st.isFile()) return p.endsWith('.jsonl') ? [p] : [];
  if (st.isDirectory()) {
    const out = [];
    for (const entry of fs.readdirSync(p)) out.push(...collectTranscripts(path.join(p, entry)));
    return out;
  }
  return [];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const roots = opts.paths.length ? opts.paths : [path.join(os.homedir(), '.claude', 'projects')];

  let files = [];
  for (const r of roots) files.push(...collectTranscripts(r));
  // Biggest first (most tool traffic) so --limit samples the richest sessions.
  files = [...new Set(files)]
    .map((f) => ({ f, size: (() => { try { return fs.statSync(f).size; } catch { return 0; } })() }))
    .sort((a, b) => b.size - a.size)
    .map((x) => x.f);
  if (Number.isFinite(opts.limit)) files = files.slice(0, opts.limit);

  const arcs = [];
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const sid = path.basename(f, '.jsonl');
    let found = [];
    try { found = detectArcsFromText(text, { fallbackSessionId: sid, minFailures: opts.minFailures, simThreshold: opts.sim }); }
    catch (e) { console.error(`! ${f}: ${e.message}`); continue; }
    for (const a of found) { a.sourceFile = f; arcs.push(a); }
  }

  if (opts.count) {
    process.stdout.write(JSON.stringify({ files: files.length, arcs: arcs.length }) + '\n');
    return;
  }
  const out = Number.isFinite(opts.top) ? arcs.slice(0, opts.top) : arcs;
  process.stdout.write(JSON.stringify(out, null, opts.pretty ? 2 : 0) + '\n');
  process.stderr.write(`scanned ${files.length} transcript(s) → ${arcs.length} candidate arc(s)\n`);
}

main();
