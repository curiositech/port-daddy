#!/usr/bin/env node
/**
 * Record the doc → derived items → emitted PR plan walkthrough as a webm —
 * headless (visual-evidence.md rung 1), zero desktop footprint.
 *
 * Honesty contract / purpose: every frame is a typeset view of the verbatim
 * transcripts capture.sh recorded from the REAL CLI against the REAL daemon
 * (the same .txt files committed in this directory, plus the source doc
 * itself). The motion is only a guided scroll through those real captures in
 * pipeline order — planning doc → chomp preview → write + emitted PR plan →
 * derived row with source_refs_json — no synthesized output anywhere.
 *
 * Usage:
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   NODE_PATH=<dir containing the playwright package> \
 *   node docs/reports/roadmap-doc-chomp/record-walkthrough.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = join(DIR, '..', '..', '..');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slide = (title, body, cap = 90) => {
  const lines = body.split('\n').slice(0, cap).join('\n');
  return `<section><h1>${esc(title)}</h1><pre>${esc(lines)}</pre></section>`;
};

const stages = [
  slide('1 · The planning doc (V4-DAG.md — real repo file)',
    readFileSync(join(REPO, 'V4-DAG.md'), 'utf8'), 60),
  slide('2 · pd roadmap chomp — preview of the exact item tree (nothing written)',
    readFileSync(join(DIR, 't01-preview.txt'), 'utf8')),
  slide('3 · --emit-pr-plan — THE write act + emitted PR artifacts',
    readFileSync(join(DIR, 't04-write-emit-pr-plan.txt'), 'utf8')),
  slide('4 · Emitted PR plan: docs removed + receipt + snapshot',
    readFileSync(join(DIR, 't08-pr-plan-artifacts.txt'), 'utf8')),
  slide('5 · Derived row provenance: source_refs_json (doc + commit)',
    readFileSync(join(DIR, 't07-item-source-refs.txt'), 'utf8')),
];

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#0d1117;color:#c9d1d9;font-family:ui-monospace,'DejaVu Sans Mono',monospace}
  section{display:none;padding:26px}
  section.on{display:block}
  h1{font-size:16px;color:#e6edf3;border-bottom:1px solid #30363d;padding-bottom:8px}
  pre{font-size:12px;line-height:1.4;white-space:pre-wrap}
</style><body>${stages.join('\n')}</body>`;
const page1 = join(DIR, '.walkthrough.html');
writeFileSync(page1, html);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1180, height: 720 },
  recordVideo: { dir: DIR, size: { width: 1180, height: 720 } },
});
const pg = await ctx.newPage();
await pg.goto(pathToFileURL(page1).href);
const n = stages.length;
for (let i = 0; i < n; i += 1) {
  await pg.evaluate((idx) => {
    document.querySelectorAll('section').forEach((s, j) => s.classList.toggle('on', j === idx));
    window.scrollTo(0, 0);
  }, i);
  await pg.waitForTimeout(1600);
  // Scroll through the real content so long transcripts are actually shown.
  await pg.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < Math.min(h, 2600); y += 130) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
  });
  await pg.waitForTimeout(600);
}
await ctx.close();
await browser.close();
const video = readdirSync(DIR).find((f) => f.endsWith('.webm') && f !== 'walkthrough.webm');
if (video) renameSync(join(DIR, video), join(DIR, 'walkthrough.webm'));
rmSync(page1);
console.log('wrote', join(DIR, 'walkthrough.webm'));
