#!/usr/bin/env tsx
/**
 * capture-roadmap-jira-items.ts — the reproducible capture harness behind
 * `docs/reports/roadmap-jira-items/`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Jira-grade roadmap slice (roster-validated durable owner, tags, typed
 * pr/doc/file/media links, planned-vs-actual, and the full detail card) is an
 * OPERATOR SURFACE: what it is worth is what the operator sees in a terminal.
 * A green test suite proves the shapes are right; it does not show the card.
 * So this script stands up the REAL stack and photographs the REAL output —
 * no mockups, no hand-written "expected" text.
 *
 * WHAT IS REAL HERE (and what is not — read this before trusting a frame)
 * ----------------------------------------------------------------------
 *   REAL: the SQL schema (`initDatabase` runs the actual boot migrations, so
 *         tags_json / actual / completed_at land through the real PRAGMA-guarded
 *         ALTER path), `lib/roadmap-items.ts`, `lib/graph-edges.ts`,
 *         `lib/planner-edges.ts`, `lib/durable-agent-roster.ts`, the real
 *         Fastify route plugins (`routes/roadmap.ts`,
 *         `routes/durable-agent-roster.ts`) served over a real loopback TCP
 *         port, and the real CLI (`bin/port-daddy-cli.ts`) invoked as a child
 *         process that talks to that port over HTTP like any other client.
 *         Every byte of terminal text in the artifacts is captured stdout/stderr.
 *   FIXTURE: the database is `:memory:` and freshly seeded by this script (it
 *         is NOT the operator's live registry), and the durable-agent roster is
 *         constructed with a stub embedding resolver + a stub gitleaks runner so
 *         the harness needs no model download and no gitleaks binary. Roster
 *         identity, the event ledger, and owner validation are otherwise real.
 *
 * That labelling is the whole point: fixture-backed is fine, pretending is not.
 * `docs/reports/roadmap-jira-items/MANIFEST.md` repeats it per artifact.
 *
 * RENDERING
 * ---------
 * Captured ANSI is converted to HTML and screenshotted with headless Chromium
 * (rung 1 of skills/port-daddy-agent-skill/references/visual-evidence.md — no
 * window is ever opened, so the operator's session is never interrupted). The
 * motion artifact is built from the same frames: GIF via Pillow, WebM via the
 * ffmpeg that ships with Playwright's browser bundle.
 *
 * USAGE
 * -----
 *   npx tsx scripts/capture-roadmap-jira-items.ts [--out <dir>] [--no-motion]
 *   npx tsx scripts/capture-roadmap-jira-items.ts --replay   # re-render only
 *
 * Prerequisites: `npm ci`, a Playwright chromium under $PLAYWRIGHT_BROWSERS_PATH
 * (or a global `playwright` install), python3 with Pillow (GIF only).
 */
import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import Fastify from 'fastify';

import { initDatabase, closeDatabase } from '../lib/db.js';
import { createTupleSpace } from '../lib/tuples.js';
import { createRoadmapItems } from '../lib/roadmap-items.js';
import { createGraphEdges } from '../lib/graph-edges.js';
import { createDurableAgentRoster } from '../lib/durable-agent-roster.js';
import { roadmapPlugin } from '../routes/roadmap.js';
import { durableAgentRosterPlugin } from '../routes/durable-agent-roster.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ── args ────────────────────────────────────────────────────────────────────

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const OUT_DIR = resolve(arg('--out', join(REPO, 'docs', 'reports', 'roadmap-jira-items')));
const WANT_MOTION = !process.argv.includes('--no-motion');
const REPLAY = process.argv.includes('--replay');
const FRAME_DIR = join(OUT_DIR, '.frames');
/**
 * Captured stdout/stderr for the whole session, committed alongside the images.
 *
 * The design intent is auditability: a reviewer who distrusts a rendered frame
 * can diff the PNG against these raw bytes, and `--replay` re-renders from
 * exactly this file rather than re-running the daemon.
 */
const SESSION_FILE = join(OUT_DIR, 'capture-session.json');

// ── ANSI → HTML ─────────────────────────────────────────────────────────────

const BASE16 = [
  '#1c2128', '#f47067', '#57ab5a', '#c69026', '#539bf5', '#b083f0', '#39c5cf', '#adbac7',
  '#545d68', '#ff938a', '#6bc46d', '#daaa3f', '#6cb6ff', '#dcbdfb', '#56d4dd', '#cdd9e5',
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface Style { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean }

function xterm256(n: number): string {
  if (n < 16) return BASE16[n];
  if (n < 232) {
    const i = n - 16;
    const lv = [0, 95, 135, 175, 215, 255];
    return `rgb(${lv[Math.floor(i / 36) % 6]},${lv[Math.floor(i / 6) % 6]},${lv[i % 6]})`;
  }
  const g = 8 + (n - 232) * 10;
  return `rgb(${g},${g},${g})`;
}

/**
 * Convert captured terminal bytes (SGR escape sequences included) into HTML
 * spans that reproduce what the operator's terminal would have shown.
 *
 * Why a hand-rolled parser instead of a dependency: the capture harness must
 * run from a bare `npm ci` checkout with no extra install step, and the CLI
 * only emits the SGR subset handled here (reset/bold/dim/italic/underline,
 * the 16 basic colors, 256-color, and truecolor).
 *
 * @param raw - Raw stdout/stderr text, possibly containing ANSI sequences.
 * @returns HTML markup for a `<pre>` block.
 */
function ansiToHtml(raw: string): string {
  // Drop cursor/erase/OSC noise that carries no color meaning.
  const text = raw
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;]*[A-HJKSTfsu]/g, '')
    .replace(/\r(?!\n)/g, '');
  let out = '';
  let style: Style = {};
  let open = false;

  const flush = () => {
    if (open) { out += '</span>'; open = false; }
  };
  const start = () => {
    const css: string[] = [];
    if (style.fg) css.push(`color:${style.fg}`);
    if (style.bg) css.push(`background:${style.bg}`);
    if (style.bold) css.push('font-weight:700');
    if (style.dim) css.push('opacity:.62');
    if (style.italic) css.push('font-style:italic');
    if (style.underline) css.push('text-decoration:underline');
    if (css.length) { out += `<span style="${css.join(';')}">`; open = true; }
  };

  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const emit = (chunk: string) => { if (chunk) out += esc(chunk); };

  while ((m = re.exec(text)) !== null) {
    emit(text.slice(last, m.index));
    last = m.index + m[0].length;
    flush();
    const codes = (m[1] || '0').split(';').map((c) => Number.parseInt(c || '0', 10));
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) { style.bold = false; style.dim = false; }
      else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c === 39) style.fg = undefined;
      else if (c === 49) style.bg = undefined;
      else if (c >= 30 && c <= 37) style.fg = BASE16[c - 30];
      else if (c >= 90 && c <= 97) style.fg = BASE16[c - 90 + 8];
      else if (c >= 40 && c <= 47) style.bg = BASE16[c - 40];
      else if (c >= 100 && c <= 107) style.bg = BASE16[c - 100 + 8];
      else if (c === 38 || c === 48) {
        const mode = codes[i + 1];
        const target = c === 38 ? 'fg' : 'bg';
        if (mode === 5) { style[target] = xterm256(codes[i + 2] ?? 7); i += 2; }
        else if (mode === 2) { style[target] = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`; i += 4; }
      }
    }
    start();
  }
  emit(text.slice(last));
  flush();
  return out;
}

// ── the captured session ────────────────────────────────────────────────────

interface Block {
  /** Displayed command line, or an HTTP request line for route reads. */
  cmd: string;
  kind: 'cli' | 'http' | 'note';
  out: string;
  exitCode?: number;
}

const blocks: Block[] = [];
/** Named indices into `blocks`, so each artifact can slice the run it needs. */
const marks: Record<string, number> = {};
let baseUrl = '';

/**
 * Run the real CLI as a child process against the harness daemon and record
 * its captured output as a session block.
 *
 * @param argv - Arguments after `pd` (e.g. `['roadmap', 'links', 'x']`).
 * @returns The recorded block, so callers can assert on the exit code.
 */
function pd(...argv: string[]): Promise<Block> {
  // MUST be async. The harness daemon runs in THIS process, so a synchronous
  // spawn would block the event loop for the whole child run — the CLI's own
  // HTTP request would then never be served and every command would capture a
  // "Request timed out" instead of the surface under test.
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(REPO, 'bin', 'port-daddy-cli.ts'), ...argv],
      {
        cwd: REPO,
        env: {
          ...process.env,
          PORT_DADDY_URL: baseUrl,
          PORT_DADDY_FORCE_TCP: '1',
          PORT_DADDY_SOCK: '',
          FORCE_COLOR: '3',
          PD_HARBOR: 'fleet',
          // Keep the capture deterministic: no plane banner probe, no update nag.
          PD_SUPPRESS_PLANE_BANNER: '1',
          PORT_DADDY_NO_UPDATE_CHECK: '1',
        },
      },
    );
    let buf = '';
    child.stdout.on('data', (c: Buffer) => { buf += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { buf += c.toString('utf8'); });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      const block: Block = { cmd: `pd ${argv.join(' ')}`, kind: 'cli', out: buf.replace(/\n+$/, ''), exitCode: code ?? 0 };
      blocks.push(block);
      console.log(`[capture]   pd ${argv.slice(0, 3).join(' ')} → exit ${code}`);
      resolvePromise(block);
    });
  });
}

/**
 * One-shot HTTP call to the harness daemon with keep-alive disabled.
 *
 * Why not global `fetch`: each CLI child process takes seconds, so minutes pass
 * between the harness's own requests. undici happily reuses a pooled socket the
 * server has already closed on its keep-alive timeout, which surfaces as a
 * spurious ECONNRESET mid-capture. `agent: false` gives every call a fresh
 * connection, which is what a capture harness wants anyway — determinism over
 * throughput.
 *
 * @param method - HTTP method.
 * @param path - Route path with query string.
 * @param payload - Optional JSON body.
 * @returns The status code and parsed JSON body.
 */
function request(method: string, path: string, payload?: unknown): Promise<{ status: number; body: unknown }> {
  const url = new URL(`${baseUrl}${path}`);
  const data = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest(
      {
        host: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        agent: false,
        headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body: unknown = text;
          try { body = JSON.parse(text); } catch { /* keep the raw text */ }
          resolvePromise({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', rejectPromise);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Read a daemon route directly and record the JSON body as a session block.
 *
 * The detail card has no CLI verb yet — `GET /roadmap/items/:slug` IS the
 * surface — so it is captured as an explicit HTTP block, visually distinct
 * from shell blocks so no reviewer mistakes it for a command that exists.
 *
 * @param path - Route path with query string.
 * @returns The recorded block.
 */
async function http(path: string): Promise<Block> {
  const res = await request('GET', path);
  const block: Block = {
    cmd: `GET ${path}  →  ${res.status}`,
    kind: 'http',
    out: JSON.stringify(res.body, null, 2),
    exitCode: res.status >= 200 && res.status < 300 ? 0 : 1,
  };
  blocks.push(block);
  return block;
}

/** Record a narration line (rendered as a caption, never as fake output). */
function note(text: string): Block {
  const block: Block = { cmd: text, kind: 'note', out: '' };
  blocks.push(block);
  return block;
}

// ── HTML shell + Playwright render ──────────────────────────────────────────

const FONT_STACK = "'DejaVu Sans Mono','Liberation Mono','Menlo','Consolas',monospace";

/**
 * Wrap a run of session blocks in the terminal-window chrome used by every
 * artifact, so stills and motion frames read as one set.
 *
 * @param title - Window title bar text.
 * @param subtitle - Provenance strip under the title (kept on every frame).
 * @param picked - Blocks to render, in order.
 * @param opts - Fixed frame geometry for motion frames.
 * @returns A complete HTML document.
 */
function page(title: string, subtitle: string, picked: Block[], opts: { fixedHeight?: number } = {}): string {
  const body = picked.map((b) => {
    if (b.kind === 'note') return `<div class="note">${esc(b.cmd)}</div>`;
    const bad = (b.exitCode ?? 0) !== 0;
    const head = b.kind === 'http'
      ? `<div class="cmd http${bad ? ' bad' : ''}"><span class="verb">HTTP</span> ${esc(b.cmd)}</div>`
      : `<div class="cmd${bad ? ' bad' : ''}"><span class="dollar">$</span> ${esc(b.cmd)}</div>`;
    const out = b.out ? `<pre class="out">${ansiToHtml(b.out)}</pre>` : '';
    const code = bad ? `<div class="exit">exit ${b.exitCode}</div>` : '';
    return `<section class="block">${head}${out}${code}</section>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0b0e13;font-family:${FONT_STACK};padding:26px;}
  .win{background:#12161d;border:1px solid #263041;border-radius:10px;overflow:hidden;
       box-shadow:0 18px 50px rgba(0,0,0,.55);width:1148px;
       ${opts.fixedHeight ? `height:${opts.fixedHeight}px;display:flex;flex-direction:column;` : ''}}
  .bar{background:#1a2029;border-bottom:1px solid #263041;padding:10px 14px;display:flex;align-items:center;gap:9px;flex:0 0 auto}
  .dot{width:11px;height:11px;border-radius:50%}
  .r{background:#f47067}.y{background:#daaa3f}.g{background:#57ab5a}
  .title{color:#adbac7;font-size:12.5px;margin-left:7px;letter-spacing:.02em}
  .prov{margin-left:auto;color:#636e7b;font-size:11px}
  .scroll{padding:16px 18px 20px;${opts.fixedHeight ? 'flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;' : ''}}
  .block{margin-bottom:15px}
  .block:last-child{margin-bottom:0}
  .cmd{color:#6cb6ff;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-break:break-all}
  .cmd .dollar{color:#57ab5a;font-weight:700;margin-right:6px}
  .cmd.http{color:#dcbdfb}
  .cmd.http .verb{background:#3c2f52;color:#dcbdfb;border-radius:3px;padding:1px 6px;font-size:11px;margin-right:7px}
  .cmd.bad{color:#ff938a}
  .out{color:#adbac7;font-size:12.7px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin-top:5px}
  .exit{color:#ff938a;font-size:11.5px;margin-top:4px}
  .note{color:#768390;font-size:12px;font-style:italic;margin:2px 0 13px;
        border-left:2px solid #2d3748;padding-left:9px}
</style></head><body>
  <div class="win">
    <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span>
      <span class="title">${esc(title)}</span><span class="prov">${esc(subtitle)}</span></div>
    <div class="scroll">${body}</div>
  </div>
</body></html>`;
}

/**
 * Resolve Playwright's chromium from either a local install or the global
 * node_modules the container ships, so the harness runs in CI and here.
 *
 * @returns The playwright module's chromium launcher.
 */
async function loadChromium(): Promise<any> {
  const candidates = [
    'playwright',
    'playwright-core',
    '/opt/node22/lib/node_modules/playwright/index.mjs',
    '/usr/lib/node_modules/playwright/index.mjs',
  ];
  for (const c of candidates) {
    try {
      const mod = c.startsWith('/') ? await import(c) : await import(require.resolve(c, { paths: [REPO] }));
      if (mod.chromium) return mod.chromium;
    } catch { /* try the next candidate */ }
  }
  throw new Error('playwright not found — install it or set PLAYWRIGHT_BROWSERS_PATH with a global playwright');
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(FRAME_DIR, { recursive: true, force: true });
  mkdirSync(FRAME_DIR, { recursive: true });

  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  const prov = `${branch} @ ${sha.slice(0, 12)} · seeded in-memory registry`;

  // Replay: re-render the artifacts from a previously captured session without
  // re-seeding. The session file holds the EXACT captured bytes, so a replay
  // render is the same evidence — it just skips the (slow) daemon+CLI run while
  // the layout is being tuned.
  if (REPLAY && existsSync(SESSION_FILE)) {
    const saved = JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as { blocks: Block[]; marks: Record<string, number> };
    blocks.push(...saved.blocks);
    Object.assign(marks, saved.marks);
    console.log(`[capture] replaying ${blocks.length} captured blocks from ${SESSION_FILE}`);
    await renderAll(prov);
    return;
  }

  // ── real stack ────────────────────────────────────────────────────────────
  const db = initDatabase({ inMemory: true });
  const tuples = createTupleSpace(db);
  const roadmapItems = createRoadmapItems({ db, tuples });
  const graphEdges = createGraphEdges(db);
  const logger = { info: () => {}, error: () => {}, warn: () => {} };
  const durableAgentRoster = createDurableAgentRoster(db, {
    // Stub embedder + gitleaks: the roster's identity/ledger/validation paths are
    // real; only the model download and the secret scanner are stood down so the
    // harness runs offline. Declared in MANIFEST.md — never claimed as live.
    resolver: { modelId: 'capture-harness-stub', embed: async () => [0.5, 0.5] },
    gitleaksRunner: () => ({ findings: [] }),
    logger,
  });

  const app = Fastify();
  await app.register(roadmapPlugin, {
    deps: { roadmapItems, roadmapPromote: { promoteFromFeedback: () => { throw new Error('unused'); } }, graphEdges, durableAgentRoster, repoRoot: REPO } as any,
  });
  await app.register(durableAgentRosterPlugin, {
    deps: { durableAgentRoster, episodicMemory: { get: () => null }, metrics: { errors: 0 }, logger } as any,
  });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  console.log(`[capture] harness daemon on ${baseUrl}`);

  // ── ACT 0 — the error/validation state, BEFORE any owner exists ───────────
  note('Nothing is registered yet. Assigning an owner that is not on the durable-agent roster:');
  await pd('roadmap', 'upsert', 'relay-retry-storms',
    '--summary', 'Bound relay retry storms behind a token bucket',
    '--assignee', 'nobody-here', '--harbor', 'fleet');

  // ── ACT 1 — register real owners through the real roster route ────────────
  await pd('roster', 'create', 'portdaddy-relay-steward',
    '--remit', 'Own relay reliability end to end.',
    '--instructions', 'Keep retry storms bounded; verify both ends after every write.');
  await pd('roster', 'create', 'portdaddy-board-cartographer',
    '--remit', 'Keep the planner board legible.',
    '--instructions', 'Every roadmap item renders with owner, estimate and evidence.');

  // ── ACT 2 — seed a populated roadmap through the real CLI ─────────────────
  await pd('roadmap', 'upsert', 'relay-retry-storms',
    '--summary', 'Bound relay retry storms behind a token bucket',
    '--status', 'now', '--kind', 'story', '--priority', '2',
    '--estimate', '5', '--due', '+14d',
    '--assignee', 'portdaddy-relay-steward',
    '--tag', 'reliability', '--tag', 'relay', '--harbor', 'fleet');
  await pd('roadmap', 'upsert', 'token-bucket-primitive',
    '--summary', 'Shared token-bucket primitive the relay and the queue both use',
    '--status', 'now', '--kind', 'task', '--estimate', '3',
    '--assignee', 'portdaddy-relay-steward',
    '--tag', 'reliability', '--harbor', 'fleet');
  await pd('roadmap', 'upsert', 'board-owner-column',
    '--summary', 'Render the durable owner column on the planner board',
    '--status', 'now', '--kind', 'task', '--priority', '4', '--estimate', '2',
    '--assignee', 'portdaddy-board-cartographer',
    '--tag', 'board', '--harbor', 'fleet');
  await pd('roadmap', 'upsert', 'relay-backpressure-adr',
    '--summary', 'ADR for relay backpressure semantics',
    '--status', 'backlog', '--kind', 'epic', '--priority', '2', '--estimate', '8',
    '--tag', 'reliability', '--harbor', 'fleet');
  // The null-state item: deliberately no owner, no tags, no estimate, no links.
  await pd('roadmap', 'upsert', 'unowned-inbox-triage',
    '--summary', 'Triage the unrouted inbox pile (nobody owns this yet)',
    '--status', 'now', '--harbor', 'fleet');

  // Dependencies are authored truth (dependencies_json retired → graph_edges).
  await request('POST', '/roadmap/items', {
    slug: 'relay-retry-storms', summaryMd: 'Bound relay retry storms behind a token bucket',
    harbor: 'fleet', dependencies: ['token-bucket-primitive'],
  });
  await request('POST', '/roadmap/items', {
    slug: 'board-owner-column', summaryMd: 'Render the durable owner column on the planner board',
    harbor: 'fleet', dependencies: ['relay-retry-storms'],
  });
  // Hierarchy edges (planner:hierarchy / parent_of) — same scope routes/roadmap.ts reads.
  graphEdges.remember({
    scope: 'planner:hierarchy', sourceType: 'roadmap:item', sourceId: 'relay-backpressure-adr',
    edgeType: 'parent_of', targetType: 'roadmap:item', targetId: 'relay-retry-storms',
  });
  graphEdges.remember({
    scope: 'planner:hierarchy', sourceType: 'roadmap:item', sourceId: 'relay-retry-storms',
    edgeType: 'parent_of', targetType: 'roadmap:item', targetId: 'token-bucket-primitive',
  });

  marks.listBlock = blocks.length;
  await pd('roadmap', '--status', 'all', '--limit', '12', '--harbor', 'fleet');
  await pd('roadmap', '--status', 'all', '--tag', 'reliability', '--harbor', 'fleet');

  // ── ACT 3 — typed artifact links ──────────────────────────────────────────
  marks.linksStart = blocks.length;
  await pd('roadmap', 'link', 'relay-retry-storms', '--pr', '9641',
    '--title', 'Jira-grade roadmap items', '--url', 'https://github.com/curiositech/port-daddy/pull/9641');
  await pd('roadmap', 'link', 'relay-retry-storms', '--doc', 'docs/adr/0086-planner-graph.md');
  await pd('roadmap', 'link', 'relay-retry-storms', '--file', 'lib/planner-edges.ts');
  await pd('roadmap', 'link', 'relay-retry-storms', '--media', 'docs/reports/roadmap-jira-items/detail-card.png',
    '--mime', 'image/png', '--caption', 'the detail card this PR ships');
  await pd('roadmap', 'links', 'relay-retry-storms');
  marks.linksEnd = blocks.length;

  // ── ACT 4 — planned vs actual: done stamps completed_at ───────────────────
  marks.doneStart = blocks.length;
  await pd('roadmap', 'upsert', 'token-bucket-primitive',
    '--summary', 'Shared token-bucket primitive the relay and the queue both use',
    '--status', 'done', '--actual', '4', '--harbor', 'fleet');
  await http('/roadmap/items/token-bucket-primitive?harbor=fleet');
  marks.doneEnd = blocks.length;

  // ── ACT 5 — the full detail card ──────────────────────────────────────────
  marks.cardIdx = blocks.length;
  await http('/roadmap/items/relay-retry-storms?harbor=fleet');

  // ── ACT 6 — NULL / EMPTY STATES ───────────────────────────────────────────
  marks.nullStart = blocks.length;
  note('NULL STATE — an item with no owner, no tags, no links, no dependencies:');
  await http('/roadmap/items/unowned-inbox-triage?harbor=fleet');
  await pd('roadmap', 'links', 'unowned-inbox-triage');
  marks.nullEnd = blocks.length;

  marks.emptyStart = blocks.length;
  note('EMPTY STATE — a harbor with no roadmap items at all:');
  await pd('roadmap', '--status', 'all', '--harbor', 'empty-harbor');
  await pd('roadmap', '--status', 'all', '--tag', 'no-such-tag', '--harbor', 'fleet');
  marks.emptyEnd = blocks.length;

  // ── ACT 7 — reopen clears completed_at ────────────────────────────────────
  marks.reopenStart = blocks.length;
  await pd('roadmap', 'upsert', 'token-bucket-primitive',
    '--summary', 'Shared token-bucket primitive the relay and the queue both use',
    '--status', 'now', '--harbor', 'fleet');
  await http('/roadmap/items/token-bucket-primitive?harbor=fleet');
  marks.reopenEnd = blocks.length;

  await app.close();
  closeDatabase(db);

  writeFileSync(SESSION_FILE, JSON.stringify({ blocks, marks, sha, branch }, null, 2));
  await renderAll(prov);
}

/**
 * Turn the captured session into the committed artifacts.
 *
 * Split from the capture half so `--replay` can re-render the exact same bytes
 * while the layout is being tuned, without re-running the daemon + CLI pass.
 *
 * @param prov - Provenance strip stamped onto every frame.
 */
async function renderAll(prov: string): Promise<void> {
  rmSync(FRAME_DIR, { recursive: true, force: true });
  mkdirSync(FRAME_DIR, { recursive: true });
  const chromium = await loadChromium();
  const browser = await chromium.launch({ headless: true });

  /**
   * Screenshot one composed page to disk.
   *
   * @param file - Output path.
   * @param html - The page markup.
   * @param fixed - Optional fixed viewport for motion frames.
   */
  async function shoot(file: string, html: string, fixed?: { w: number; h: number }): Promise<void> {
    const ctx = await browser.newContext({
      // Stills use a deliberately SHORT viewport: `fullPage` captures
      // max(document, viewport), so a tall viewport would pad every short
      // artifact with dead background. Motion frames need the fixed geometry.
      viewport: { width: fixed?.w ?? 1200, height: fixed?.h ?? 200 },
      deviceScaleFactor: fixed ? 1 : 2,
    });
    const pg = await ctx.newPage();
    await pg.setContent(html, { waitUntil: 'load' });
    await pg.screenshot({ path: file, fullPage: !fixed, type: file.endsWith('.jpg') ? 'jpeg' : 'png', ...(file.endsWith('.jpg') ? { quality: 90 } : {}) });
    await ctx.close();
  }

  const shots: Array<[string, string, Block[]]> = [
    ['roadmap-list-populated.png', 'pd roadmap — populated list with planner columns inline',
      blocks.slice(marks.listBlock, marks.listBlock + 2)],
    ['detail-card.png', 'GET /roadmap/items/:slug — the full Jira card',
      blocks.slice(marks.cardIdx, marks.cardIdx + 1)],
    ['links-surface.png', 'pd roadmap link / links — typed artifact links (ADR-0086 §3)',
      blocks.slice(marks.linksStart, marks.linksEnd)],
    ['null-state-item.png', 'NULL STATE — an item with no owner, no tags, no links, no deps',
      blocks.slice(marks.nullStart, marks.nullEnd)],
    ['empty-state-roadmap.png', 'EMPTY STATE — an empty harbor and a tag filter that matches nothing',
      blocks.slice(marks.emptyStart, marks.emptyEnd)],
    ['error-unknown-assignee.png', 'ERROR STATE — unknown assignee 400 names the registration path',
      blocks.slice(0, 2)],
    ['planned-vs-actual.png', 'planned-vs-actual — done stamps completed_at, reopen clears it',
      [...blocks.slice(marks.doneStart, marks.doneEnd), ...blocks.slice(marks.reopenStart, marks.reopenEnd)]],
  ];

  const written: string[] = [];
  for (const [file, title, picked] of shots) {
    const out = join(OUT_DIR, file);
    await shoot(out, page(title, prov, picked));
    written.push(out);
    console.log(`[capture] ${file}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
  }

  // ── motion ────────────────────────────────────────────────────────────────
  if (WANT_MOTION) {
    const scenes: Array<{ title: string; picked: Block[]; hold: number }> = [
      { title: '1/8 · unknown owner is refused — and the 400 names the fix', picked: blocks.slice(0, 2), hold: 3200 },
      { title: '2/8 · register the durable owner on the roster', picked: blocks.slice(2, 4), hold: 2600 },
      { title: '3/8 · create the item with owner + tags + estimate', picked: blocks.slice(4, 5), hold: 2800 },
      { title: '4/8 · the flat list renders the planner columns inline', picked: blocks.slice(marks.listBlock, marks.listBlock + 1), hold: 3400 },
      { title: '5/8 · ?tag= is an exact filter', picked: blocks.slice(marks.listBlock + 1, marks.listBlock + 2), hold: 2800 },
      { title: '6/8 · pin typed artifact links, then list them', picked: blocks.slice(marks.linksStart, marks.linksEnd), hold: 3600 },
      { title: '7/8 · mark done — completed_at is stamped, actual recorded', picked: blocks.slice(marks.doneStart, marks.doneStart + 1), hold: 2600 },
      { title: '8/8 · the full card: owner, links, deps, plannedVsActual', picked: blocks.slice(marks.cardIdx, marks.cardIdx + 1), hold: 4200 },
    ];
    const W = 1148 + 52;
    const H = 700;
    const frames: string[] = [];
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const png = join(FRAME_DIR, `frame-${String(i).padStart(3, '0')}.png`);
      const jpg = join(FRAME_DIR, `frame-${String(i).padStart(3, '0')}.jpg`);
      const html = page(s.title, prov, s.picked, { fixedHeight: H - 52 });
      await shoot(png, html, { w: W, h: H });
      await shoot(jpg, html, { w: W, h: H });
      frames.push(png);
    }
    buildGif(frames, scenes.map((s) => s.hold), join(OUT_DIR, 'roadmap-jira-items-walkthrough.gif'));
    buildWebm(frames.map((f) => f.replace(/\.png$/, '.jpg')), scenes.map((s) => s.hold), join(OUT_DIR, 'roadmap-jira-items-walkthrough.webm'));
  }

  await browser.close();
  rmSync(FRAME_DIR, { recursive: true, force: true });
  console.log(`[capture] done → ${OUT_DIR}`);
}

// ── encoders ────────────────────────────────────────────────────────────────

const GIF_PY = `
import sys
from PIL import Image
out = sys.argv[1]
n = (len(sys.argv) - 2) // 2
paths = sys.argv[2:2+n]
holds = [int(x) for x in sys.argv[2+n:]]
frames = [Image.open(p).convert('RGB').quantize(colors=200, method=Image.MEDIANCUT) for p in paths]
# Per-frame hold: the duration= list alone is silently collapsed to one value by
# some Pillow paths, so stamp each frame's own info too.
for f, h in zip(frames, holds):
    f.info['duration'] = h
frames[0].save(out, save_all=True, append_images=frames[1:], duration=holds, loop=0, optimize=True, disposal=2)
print('gif ok', out)
`;

/**
 * Encode the walkthrough GIF with Pillow.
 *
 * Why Pillow and not ffmpeg: the ffmpeg that ships inside Playwright's browser
 * bundle is built with `--disable-everything` plus a WebM-only allowlist, so it
 * has no GIF muxer at all. Pillow is the dependency actually present.
 *
 * @param frames - Ordered PNG frame paths.
 * @param holds - Per-frame display duration in ms.
 * @param out - Output .gif path.
 */
function buildGif(frames: string[], holds: number[], out: string): void {
  const res = spawnSync('python3', ['-c', GIF_PY, out, ...frames, ...holds.map(String)], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`[capture] GIF encode failed:\n${res.stderr}`);
    return;
  }
  console.log(`[capture] ${out.split('/').pop()}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

/**
 * Encode the walkthrough WebM from JPEG frames via Playwright's bundled ffmpeg
 * (image2pipe → libvpx). Frames are repeated to honour each scene's hold.
 *
 * @param frames - Ordered JPEG frame paths.
 * @param holds - Per-frame display duration in ms.
 * @param out - Output .webm path.
 */
function buildWebm(frames: string[], holds: number[], out: string): void {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) { console.error('[capture] no ffmpeg found; skipping webm'); return; }
  const FPS = 5;
  const chunks: Buffer[] = [];
  frames.forEach((f, i) => {
    const buf = readFileSync(f);
    const repeat = Math.max(1, Math.round((holds[i] / 1000) * FPS));
    for (let r = 0; r < repeat; r++) chunks.push(buf);
  });
  const mjpeg = out.replace(/\.webm$/, '.mjpeg');
  writeFileSync(mjpeg, Buffer.concat(chunks));
  const res = spawnSync(ffmpeg, [
    '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', mjpeg,
    '-c:v', 'libvpx', '-b:v', '1400k', '-crf', '30', '-pix_fmt', 'yuv420p', out,
  ], { encoding: 'utf8' });
  rmSync(mjpeg, { force: true });
  if (res.status !== 0) {
    console.error(`[capture] webm encode failed:\n${res.stderr?.slice(-1500)}`);
    return;
  }
  console.log(`[capture] ${out.split('/').pop()}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}

/**
 * Locate an ffmpeg binary: PATH first, then Playwright's bundled build.
 *
 * @returns An executable path, or null when none is available.
 */
function findFfmpeg(): string | null {
  const which = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.HOME ?? '', '.cache', 'ms-playwright');
  const found = spawnSync('sh', ['-c', `ls -d ${root}/ffmpeg-*/ffmpeg-linux ${root}/ffmpeg-*/ffmpeg-mac 2>/dev/null | head -1`], { encoding: 'utf8' });
  const path = found.stdout.trim();
  return path && existsSync(path) ? path : null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
