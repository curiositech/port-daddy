#!/usr/bin/env node
/**
 * Render the captured chomp transcripts to PNGs — headless, per the
 * sanctioned capture ladder (skills/port-daddy-agent-skill/references/
 * visual-evidence.md, rung 1: headless browser, zero desktop footprint).
 *
 * Honesty contract / why this exists: the CLI output was captured verbatim
 * by capture.sh into the .txt transcripts committed in this directory. This
 * script only typesets those bytes in a terminal-styled monospace <pre> and
 * screenshots the result with headless Playwright — a faithful rendering of
 * real output (what a terminal would draw), never a mockup: the pixels are
 * derivable from the committed transcripts by re-running this script.
 *
 * Usage: node docs/reports/roadmap-doc-chomp/render.mjs
 * Requires: PLAYWRIGHT_BROWSERS_PATH pointing at installed browsers (uses
 * `npx playwright screenshot`, chromium, dark scheme, full page).
 */
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));

const TITLES = {
  't01-preview.txt': 'pd roadmap chomp — preview (default: nothing written)',
  't02-empty-states.txt': 'Empty states — no ingestible structure / missing doc',
  't03-enrich-honest.txt': '--enrich with no LLM backend — honest deterministic degradation',
  't04-write-emit-pr-plan.txt': '--emit-pr-plan — THE write act + emitted PR artifacts',
  't05-idempotent-rerun.txt': 'Idempotent re-run — 0 new, all rows protected',
  't06-roadmap-list.txt': 'Derived items read back from roadmap_items',
  't07-item-source-refs.txt': 'Derived row detail — source_refs_json provenance (doc + commit)',
  't08-pr-plan-artifacts.txt': 'Emitted PR-plan artifacts (git-rm list, receipt, snapshot)',
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.txt'))) {
  const text = readFileSync(join(DIR, file), 'utf8');
  // Clamp extremely long transcripts for the PNG (the FULL text stays in the
  // committed .txt); the clamp is announced inside the image itself.
  const lines = text.split('\n');
  const MAX = 120;
  const shown = lines.length > MAX
    ? [...lines.slice(0, MAX), '', `… ${lines.length - MAX} more lines — full transcript committed as ${file}`]
    : lines;
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d1117;">
  <div style="padding:28px;font-family:ui-monospace,'DejaVu Sans Mono',Menlo,monospace;">
    <div style="color:#e6edf3;font-size:15px;font-weight:700;padding-bottom:10px;border-bottom:1px solid #30363d;margin-bottom:14px;">
      ${esc(TITLES[file] ?? file)}
      <span style="float:right;color:#7d8590;font-weight:400;font-size:11px;">real captured output · ${esc(file)}</span>
    </div>
    <pre style="color:#c9d1d9;font-size:12.5px;line-height:1.45;margin:0;white-space:pre-wrap;">${esc(shown.join('\n'))}</pre>
  </div></body>`;
  const htmlPath = join(DIR, file.replace(/\.txt$/, '.html'));
  writeFileSync(htmlPath, html);
  const png = join(DIR, file.replace(/\.txt$/, '.png'));
  execFileSync('npx', [
    'playwright', 'screenshot', '--browser', 'chromium', '--full-page',
    '--color-scheme', 'dark', '--viewport-size', '1180,700',
    pathToFileURL(resolve(htmlPath)).href, png,
  ], { stdio: 'inherit' });
  rmSync(htmlPath); // the .txt is the committed source of truth, not the wrapper
  console.log(`rendered ${png}`);
}
