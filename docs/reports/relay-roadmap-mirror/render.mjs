#!/usr/bin/env node
/**
 * render.mjs — turn run-log.json (real captured HTTP responses) into evidence
 * sheets a human reads at a glance, then screenshot them with headless
 * Playwright and record the walkthrough.
 *
 * Rule of this file: it may only LAY OUT values that exist in run-log.json.
 * Every number, slug, status, code and clock on every sheet is read out of a
 * recorded response body. The only computed values are (a) list lengths, and
 * (b) the staleness delta, which is shown WITH its arithmetic
 * (receivedAt·1000 − generatedAt) so the reader can check it against the two
 * real fields printed beside it.
 *
 * Called by capture.mjs; runnable on its own against an existing run-log:
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node docs/reports/relay-roadmap-mirror/render.mjs
 */
import { writeFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Playwright is a global install in this environment; fall back to a local one. */
function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const id of ['/opt/node22/lib/node_modules/playwright/index.js', 'playwright', 'playwright-core']) {
    try {
      return require(id);
    } catch {
      /* try the next */
    }
  }
  throw new Error('playwright not resolvable — set NODE_PATH or install playwright');
}

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const j = (v) => esc(JSON.stringify(v, null, 2));
const byId = (runLog, id) => runLog.steps.find((s) => s.id === id);

const STATUSES = ['now', 'backlog', 'parked', 'merge', 'done'];

function ms(dt) {
  const neg = dt < 0;
  let n = Math.abs(dt);
  const d = Math.floor(n / 86_400_000);
  n -= d * 86_400_000;
  const h = Math.floor(n / 3_600_000);
  n -= h * 3_600_000;
  const m = Math.floor(n / 60_000);
  const s = Math.floor((n - m * 60_000) / 1000);
  const parts = [d && `${d}d`, h && `${h}h`, m && `${m}m`, `${s}s`].filter(Boolean);
  return (neg ? '−' : '') + parts.join(' ');
}

const iso = (msVal) => new Date(msVal).toISOString().replace('T', ' ').replace('.000Z', 'Z');

// ── page chrome ──────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0d1117;color:#c9d1d9;font:14px/1.55 ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;padding:26px 30px 34px}
.sheet{max-width:1340px;margin:0 auto}
.disclaimer{border:1px solid #b7791f;background:#2b2011;border-left:5px solid #d69e2e;padding:12px 16px;border-radius:6px;margin-bottom:18px;color:#f0d9a8}
.disclaimer b{color:#f6e05e}
h1{font:600 22px/1.3 ui-sans-serif,system-ui,sans-serif;color:#e6edf3;letter-spacing:-.2px}
h1 .n{color:#58a6ff;margin-right:10px}
.sub{color:#8b949e;font-size:12.5px;margin-top:5px}
.prov{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 20px}
.chip{border:1px solid #30363d;background:#161b22;border-radius:999px;padding:3px 11px;font-size:11.5px;color:#8b949e}
.chip b{color:#c9d1d9;font-weight:600}
.chip.real{border-color:#2ea043;background:#0f2417;color:#7ee787}
.chip.harness{border-color:#8957e5;background:#1d1428;color:#d2b4fe}
.chip.authored{border-color:#b7791f;background:#2b2011;color:#f0d9a8}
.card{border:1px solid #30363d;background:#0f141a;border-radius:9px;margin-bottom:16px;overflow:hidden}
.card > .head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:11px 14px;background:#161b22;border-bottom:1px solid #30363d}
.req{color:#e6edf3;font-size:13px}
.req .m{color:#d2a8ff;font-weight:600}
.req .q{color:#8b949e}
.pill{font-size:11.5px;font-weight:700;border-radius:5px;padding:2px 8px}
.ok{background:#0f2417;color:#7ee787;border:1px solid #2ea043}
.err{background:#2d1416;color:#ff9492;border:1px solid #da3633}
.warn{background:#2b2011;color:#f6e05e;border:1px solid #b7791f}
.t{margin-left:auto;color:#6e7681;font-size:11.5px}
.body{padding:14px}
.note{color:#8b949e;font-size:12.5px;margin-bottom:11px}
pre{background:#010409;border:1px solid #21262d;border-radius:6px;padding:11px 13px;overflow:auto;font-size:11.5px;color:#a5d6ff;white-space:pre-wrap;word-break:break-word}
pre .k{color:#7ee787}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.wm{display:grid;grid-template-columns:repeat(4,auto);gap:0 26px;align-items:start;background:#010409;border:1px solid #21262d;border-radius:7px;padding:13px 15px;margin-bottom:13px}
.wm .lab{font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:#6e7681}
.wm .val{font-size:16px;color:#e6edf3;margin:3px 0 1px}
.wm .sub2{font-size:11px;color:#8b949e}
.wm .stale{color:#f6e05e}
.lanes{display:grid;grid-template-columns:repeat(5,1fr);gap:11px}
.lane{border:1px solid #21262d;border-radius:7px;background:#010409;min-height:120px}
.lane h3{font:600 11px/1 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.1em;padding:9px 10px;border-bottom:1px solid #21262d;display:flex;justify-content:space-between;color:#8b949e}
.lane h3 .c{color:#e6edf3;background:#21262d;border-radius:4px;padding:0 6px}
.lane.now h3{color:#7ee787}.lane.backlog h3{color:#79c0ff}.lane.parked h3{color:#8b949e}
.lane.merge h3{color:#d2a8ff}.lane.done h3{color:#6e7681}
.it{padding:7px 10px;border-bottom:1px solid #12171d}
.it:last-child{border-bottom:none}
.it .s{color:#e6edf3;font-size:11.5px;word-break:break-all}
.it .d{color:#6e7681;font-size:10.5px;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.more{padding:7px 10px;color:#6e7681;font-size:11px;font-style:italic}
.empty{padding:16px 10px;color:#484f58;font-size:11.5px;text-align:center;font-style:italic}
table{width:100%;border-collapse:collapse;font-size:12px}
th{text-align:left;color:#6e7681;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;padding:6px 9px;border-bottom:1px solid #21262d}
td{padding:6px 9px;border-bottom:1px solid #12171d;color:#c9d1d9;vertical-align:top}
td.slug{color:#79c0ff}
.kv{display:grid;grid-template-columns:150px 1fr;gap:4px 14px;font-size:12px}
.kv .k2{color:#6e7681}
.kv .v2{color:#e6edf3;word-break:break-word}
.edge{display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px solid #12171d;font-size:12px}
.edge:last-child{border-bottom:none}
.edge .n1{color:#79c0ff}
.edge .ty{color:#d2a8ff;background:#1d1428;border:1px solid #8957e5;border-radius:4px;padding:1px 7px;font-size:10.5px}
.edge .ar{color:#6e7681}
.tomb{border:1px solid #da3633;background:#2d1416;border-radius:7px;padding:12px 14px}
.tomb .t2{color:#ff9492;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.foot{color:#6e7681;font-size:11px;margin-top:20px;border-top:1px solid #21262d;padding-top:11px}
.delta{background:#010409;border:1px solid #21262d;border-radius:7px;padding:11px 13px;font-size:12px;color:#8b949e}
.delta b{color:#e6edf3}
.same{color:#7ee787;font-weight:700}
h2{font:600 14px/1 ui-sans-serif,system-ui,sans-serif;color:#e6edf3;margin:0 0 10px;letter-spacing:.02em}
`;

function page(title, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="sheet">${inner}</div></body></html>`;
}

function disclaimer() {
  return `<div class="disclaimer"><b>This slice ships no operator-visible page.</b> The relay roadmap mirror is PR 1 of 4 — a D1 replica plus two JSON endpoints. The board/item pages land in PR 3 of 4. These sheets are not a product surface and are not a mock of one: they are a layout of <b>verbatim HTTP responses</b> captured from the real Worker, recorded in <code>run-log.json</code> beside this image.</div>`;
}

function header(runLog, n, title, sub, chips = []) {
  const p = runLog.provenance;
  const all = [
    `<span class="chip"><b>${esc(p.branch)}</b> @ ${esc(p.commit.slice(0, 9))}</span>`,
    `<span class="chip">captured <b>${esc(p.capturedAt)}</b></span>`,
    `<span class="chip${p.relayTreeClean ? ' real' : ''}">relay src/migrations/tests at capture: <b>${p.relayTreeClean ? 'clean — as committed' : 'MODIFIED'}</b></span>`,
    ...chips,
  ].join('');
  return `${disclaimer()}<h1><span class="n">${esc(n)}</span>${esc(title)}</h1><div class="sub">${sub}</div><div class="prov">${all}</div>`;
}

const CHIP_REAL = `<span class="chip real">REAL WORKER — wrangler dev --local (workerd + miniflare), real migration chain</span>`;
const CHIP_HARNESS = `<span class="chip harness">IN-PROCESS PROBE — real src/roadmap-mirror.ts over node:sqlite, real migration chain</span>`;
const chipAuthored = (t) => `<span class="chip authored">${esc(t)}</span>`;

function statusPill(code) {
  const cls = code < 300 ? 'ok' : code < 500 ? 'err' : 'err';
  return `<span class="pill ${cls}">HTTP ${code}</span>`;
}

function reqCard(stepRec, inner, extraPill = '') {
  const r = stepRec.request;
  const [path, query] = r.url.split('?');
  return `<div class="card"><div class="head">
    <span class="req"><span class="m">${esc(r.method)}</span> ${esc(path)}${query ? `<span class="q">?${esc(decodeURIComponent(query))}</span>` : ''}</span>
    ${statusPill(stepRec.status)}${extraPill}
    <span class="t">${esc(r.auth)} · ${r.bodyBytes ? `${r.bodyBytes.toLocaleString()} B body · ` : ''}${stepRec.ms} ms</span>
  </div><div class="body">
    <div class="note">${esc(stepRec.title)} — ${esc(stepRec.note)}</div>
    ${inner}
  </div></div>`;
}

// ── sheet 01: null states ────────────────────────────────────────────────────

function sheetNullStates(runLog) {
  const cards = [];
  for (const id of ['n1', 'n4', 'n5', 'b5']) {
    const s = byId(runLog, id);
    cards.push(reqCard(s, `<pre>${j(s.body)}</pre>`));
  }
  const n3 = byId(runLog, 'n3');
  const lanes = n3.body.board ?? {};
  const laneHtml = STATUSES.map(
    (st) => `<div class="lane ${st}"><h3>${st}<span class="c">${(lanes[st] ?? []).length}</span></h3><div class="empty">no items</div></div>`,
  ).join('');
  const emptyCard = reqCard(
    n3,
    `${watermark(n3.body.mirror)}
     <div class="lanes">${laneHtml}</div>
     <div class="note" style="margin:12px 0 0">activity tail: <b>${(n3.body.activity ?? []).length}</b> entries · itemCount from the header: <b>${n3.body.mirror.itemCount}</b></div>
     <pre style="margin-top:11px">${j({ mirror: n3.body.mirror, board: n3.body.board, activity: n3.body.activity })}</pre>`,
  );
  return page(
    'Null states — relay roadmap mirror',
    header(
      runLog,
      '01',
      'Null states',
      'Four distinct kinds of "nothing here", each answered explicitly rather than as an empty board that could be mistaken for a synced-and-empty roadmap.',
      [CHIP_REAL],
    ) +
      cards[0] +
      emptyCard +
      cards.slice(1).join('') +
      `<div class="foot">Every body above is the verbatim response recorded in run-log.json (steps n1, n3, n4, n5, b5).</div>`,
  );
}

// ── watermark block ──────────────────────────────────────────────────────────

function watermark(m) {
  const stale = m.receivedAt * 1000 - m.generatedAt;
  return `<div class="wm">
    <div><div class="lab">repo · harbor</div><div class="val">${esc(m.repo)}</div><div class="sub2">harbor <b>${esc(m.harbor)}</b> · daemon <b>${esc(m.daemonLabel ?? 'null')}</b> · harborId ${esc(String(m.harborId))}</div></div>
    <div><div class="lab">generatedAt — daemon clock</div><div class="val">${esc(iso(m.generatedAt))}</div><div class="sub2">${m.generatedAt} (unix ms, stored verbatim)</div></div>
    <div><div class="lab">receivedAt — relay clock</div><div class="val">${esc(iso(m.receivedAt * 1000))}</div><div class="sub2">${m.receivedAt} (unix <b>seconds</b>)</div></div>
    <div><div class="lab">staleness</div><div class="val stale">${esc(ms(stale))}</div><div class="sub2">receivedAt·1000 − generatedAt = ${stale}</div></div>
  </div>`;
}

// ── sheet 02: board ──────────────────────────────────────────────────────────

function laneColumn(st, items, limit = 7) {
  const shown = items.slice(0, limit).map(
    (i) => `<div class="it"><div class="s">${esc(i.slug)}</div><div class="d">${esc(i.summaryMd || '—')}</div></div>`,
  ).join('');
  const more = items.length > limit ? `<div class="more">+ ${items.length - limit} more in this lane</div>` : '';
  return `<div class="lane ${st}"><h3>${st}<span class="c">${items.length}</span></h3>${shown || '<div class="empty">no items</div>'}${more}</div>`;
}

function sheetBoard(runLog) {
  const a2 = byId(runLog, 'a2');
  const b2 = byId(runLog, 'b2');
  const aug = runLog.augmentation;
  const board = b2.body.board;
  const lanes = STATUSES.map((st) => laneColumn(st, board[st] ?? [])).join('');
  const total = STATUSES.reduce((n, st) => n + (board[st] ?? []).length, 0);
  const act = (b2.body.activity ?? [])
    .map(
      (a) => `<tr><td>${esc(iso(a.at))}</td><td class="slug">${esc(a.slug)}</td><td>${esc(a.kind)}</td><td>${esc(a.byId ?? '—')}</td><td>${esc(JSON.stringify(a.detail))}</td></tr>`,
    )
    .join('');
  const b1 = byId(runLog, 'b1');
  const a1 = byId(runLog, 'a1');
  return page(
    'Mirror header + board — relay roadmap mirror',
    header(
      runLog,
      '02',
      'The mirror holding a real roadmap',
      'GET /v1/roadmap/mirror after two pushes of the port-daddy roadmap. The header is the honest watermark: the daemon\'s clock and the relay\'s clock are separate fields, and staleness is the reader\'s to compute from both.',
      [CHIP_REAL, chipAuthored(`items = REAL daemon export (${a1.body.itemCount}) · edges/activity/tombstone = capture-authored`)],
    ) +
      reqCard(
        b2,
        `${watermark(b2.body.mirror)}
         <div class="note">Board — <b>${total}</b> live items across five lanes (tombstones excluded by design); header itemCount <b>${b2.body.mirror.itemCount}</b> counts tombstones too, so the difference is exactly the ${b2.body.mirror.itemCount - total} tombstoned row.</div>
         <div class="lanes">${lanes}</div>
         <h2 style="margin:18px 0 9px">Activity tail — ${(b2.body.activity ?? []).length} entries, newest first</h2>
         <table><thead><tr><th>at (daemon clock)</th><th>slug</th><th>kind</th><th>byId</th><th>detail</th></tr></thead><tbody>${act}</tbody></table>`,
      ) +
      `<div class="card"><div class="head"><span class="req">Full replace — the two pushes</span><span class="pill ok">PUT × 2</span></div><div class="body">
        <div class="grid2">
          <div><h2>a1 · first push (real export, verbatim)</h2><pre>${j(a1.body)}</pre></div>
          <div><h2>b1 · second push (replace + augmentation)</h2><pre>${j(b1.body)}</pre></div>
        </div>
        <div class="delta" style="margin-top:13px">Watermark moved <b>${esc(iso(a2.body.mirror.generatedAt))}</b> → <b>${esc(iso(b2.body.mirror.generatedAt))}</b>; live board items ${STATUSES.reduce((n, st) => n + (a2.body.board[st] ?? []).length, 0)} → ${total}. The replace is wholesale: the mirror is always exactly one daemon snapshot.</div>
      </div></div>` +
      `<div class="foot">Item text is verbatim from docs/roadmap/roadmap.snapshot.json — the committed export scripts/export-roadmap-snapshot.ts produced from the daemon. Edges, the activity tail and the tombstone are capture-authored (that export carries none) and are listed in MANIFEST.md.</div>`,
  );
}

// ── sheet 03: item detail + edges ────────────────────────────────────────────

function edgeRow(e, focus) {
  const src = e.sourceId === focus ? `<b class="n1">${esc(e.sourceId)}</b>` : `<span class="n1">${esc(e.sourceId)}</span>`;
  const tgt = e.targetId === focus ? `<b class="n1">${esc(e.targetId)}</b>` : `<span class="n1">${esc(e.targetId)}</span>`;
  return `<div class="edge">${src}<span class="ar">—</span><span class="ty">${esc(e.edgeType)}</span><span class="ar">→</span>${tgt}<span class="ar" style="margin-left:auto">scope ${esc(e.scope)}</span></div>`;
}

function itemKv(i) {
  const rows = [
    ['slug', i.slug], ['status', i.status], ['kind', i.kind], ['priority', i.priority],
    ['harbor', i.harbor], ['assigneeId', i.assigneeId], ['deleted', String(i.deleted)],
    ['deletedAt', i.deletedAt == null ? 'null' : `${i.deletedAt} · ${iso(i.deletedAt)}`],
    ['lastTouchedAt', `${i.lastTouchedAt} · ${iso(i.lastTouchedAt)}`],
    ['createdAt', `${i.createdAt} · ${iso(i.createdAt)}`],
    ['startedAt', String(i.startedAt)], ['dueAt', String(i.dueAt)], ['estimate', String(i.estimate)],
    ['dependencies', JSON.stringify(i.dependencies)], ['notes', JSON.stringify(i.notes)],
  ];
  return `<div class="kv">${rows.map(([k, v]) => `<div class="k2">${esc(k)}</div><div class="v2">${esc(v ?? 'null')}</div>`).join('')}</div>`;
}

function sheetItemDetail(runLog) {
  const b3 = byId(runLog, 'b3');
  const i = b3.body.item;
  const focus = i.slug;
  const out = (b3.body.edgesOut ?? []).map((e) => edgeRow(e, focus)).join('') || '<div class="empty">no outgoing edges</div>';
  const inn = (b3.body.edgesIn ?? []).map((e) => edgeRow(e, focus)).join('') || '<div class="empty">no incoming edges</div>';
  return page(
    'Item detail — relay roadmap mirror',
    header(
      runLog,
      '03',
      `Item detail — edges in both directions`,
      'The same endpoint with <code>&amp;slug=</code>: one item in full plus its edges as source AND as target. Serving only one direction would make an item lie about half its graph.',
      [CHIP_REAL, chipAuthored('edges = capture-authored except the one marked derived in MANIFEST.md')],
    ) +
      reqCard(
        b3,
        `<div class="grid2">
          <div><h2>item</h2>${itemKv(i)}
            <div class="note" style="margin-top:11px"><b>summaryMd</b> (verbatim from the daemon export)</div>
            <pre>${esc(i.summaryMd)}</pre></div>
          <div>
            <h2>edgesOut — ${(b3.body.edgesOut ?? []).length} (this item as source)</h2>${out}
            <h2 style="margin-top:16px">edgesIn — ${(b3.body.edgesIn ?? []).length} (this item as target)</h2>${inn}
            <h2 style="margin-top:16px">mirror header carried on every read</h2>
            <pre>${j(b3.body.mirror)}</pre>
          </div>
        </div>
        <h2 style="margin-top:16px">verbatim response</h2>
        <pre>${j(b3.body)}</pre>`,
      ) +
      `<div class="foot">Response recorded as step b3 in run-log.json.</div>`,
  );
}

// ── sheet 04: tombstone ──────────────────────────────────────────────────────

function sheetTombstone(runLog) {
  const b4 = byId(runLog, 'b4');
  const b2 = byId(runLog, 'b2');
  const b5 = byId(runLog, 'b5');
  const i = b4.body.item;
  const onBoard = STATUSES.some((st) => (b2.body.board[st] ?? []).some((x) => x.slug === i.slug));
  const laneOfStatus = (b2.body.board[i.status] ?? []).length;
  return page(
    'Tombstone — relay roadmap mirror',
    header(
      runLog,
      '04',
      'Tombstone — off the board, still queryable',
      'A deleted item is data, not an absence. It is excluded from the board and flagged <code>deleted:true</code> on the detail read, so nothing silently resurrects and nothing silently vanishes.',
      [CHIP_REAL, chipAuthored('the tombstone is capture-authored — the daemon export carries none')],
    ) +
      reqCard(
        b4,
        `<div class="tomb"><div class="t2">deleted — deletedAt ${esc(String(i.deletedAt))} · ${esc(iso(i.deletedAt))}</div>
          <div style="margin-top:9px">${itemKv(i)}</div></div>
         <div class="delta" style="margin-top:13px">Cross-check against the board read (step b2): lane <b>${esc(i.status)}</b> holds <b>${laneOfStatus}</b> items and <b class="same">${onBoard ? 'CONTAINS' : 'does NOT contain'}</b> <b>${esc(i.slug)}</b>. Header itemCount <b>${b2.body.mirror.itemCount}</b> (tombstones included) vs <b>${STATUSES.reduce((n, st) => n + (b2.body.board[st] ?? []).length, 0)}</b> live board items.</div>
         <h2 style="margin:16px 0 9px">verbatim response</h2>
         <pre>${j(b4.body)}</pre>`,
      ) +
      reqCard(b5, `<pre>${j(b5.body)}</pre>`) +
      `<div class="foot">A tombstoned slug resolves with <code>deleted:true</code>; a slug that was never mirrored 404s with NO_ITEM. The two are distinguishable — that is the point.</div>`,
  );
}

// ── sheet 05: payload guards ─────────────────────────────────────────────────

function sheetGuards(runLog) {
  const g = ['g1', 'g2', 'g3', 'g4'].map((id) => byId(runLog, id));
  const b2 = byId(runLog, 'b2');
  const g5 = byId(runLog, 'g5');
  const same = JSON.stringify(b2.body) === JSON.stringify(g5.body);
  const cards = g.map((s) => reqCard(s, `<pre>${j(s.body)}</pre>`)).join('');
  return page(
    'Payload guards — relay roadmap mirror',
    header(
      runLog,
      '05',
      'Payload guards refuse loudly',
      'Over-cap pushes are refused with an explicit code before any storage work — never silently trimmed. A daemon that pushed too much must KNOW it did.',
      [CHIP_REAL],
    ) +
      cards +
      reqCard(
        g5,
        `<div class="delta">Mirror state after all four refusals, compared byte-for-byte with the read from before them (step b2):
        <b class="${same ? 'same' : ''}">${same ? 'IDENTICAL' : 'DIFFERENT'}</b>.
        Watermark still <b>${esc(iso(g5.body.mirror.generatedAt))}</b> (generatedAt ${g5.body.mirror.generatedAt}), itemCount still <b>${g5.body.mirror.itemCount}</b>, edgeCount still <b>${g5.body.mirror.edgeCount}</b>, activity still <b>${(g5.body.activity ?? []).length}</b> entries.</div>
        <pre style="margin-top:12px">${j(g5.body.mirror)}</pre>`,
      ) +
      `<div class="foot">Caps read from the source: MAX_SNAPSHOT_ITEMS and MAX_SNAPSHOT_BYTES in apps/relay/src/roadmap-mirror.ts — the refusal strings above are the Worker's own.</div>`,
  );
}

// ── sheet 06: atomic rollback ────────────────────────────────────────────────

function rollbackSide(title, snap) {
  const lanes = Object.entries(snap.laneCounts)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
    .join('');
  return `<div><h2>${esc(title)}</h2>
    <div class="kv">
      <div class="k2">generatedAt</div><div class="v2">${snap.mirror.generatedAt} · ${esc(iso(snap.mirror.generatedAt))}</div>
      <div class="k2">receivedAt</div><div class="v2">${snap.mirror.receivedAt}</div>
      <div class="k2">itemCount</div><div class="v2">${snap.mirror.itemCount}</div>
      <div class="k2">edgeCount</div><div class="v2">${snap.mirror.edgeCount}</div>
      <div class="k2">rows in D1</div><div class="v2">${snap.itemRowsInDb}</div>
    </div>
    <table style="margin-top:10px"><thead><tr><th>lane</th><th>live items</th></tr></thead><tbody>${lanes}</tbody></table>
    <div class="note" style="margin-top:9px">first three in <b>now</b>: ${snap.firstNow.map((s) => `<span class="slug" style="color:#79c0ff">${esc(s)}</span>`).join(', ')}</div></div>`;
}

function sheetRollback(runLog) {
  const r = runLog.rollback;
  return page(
    'Atomic rollback — relay roadmap mirror',
    header(
      runLog,
      '06',
      'A poisoned snapshot leaves the previous one intact',
      'The full replace is one D1 <code>batch()</code> — a transaction. A statement that fails mid-batch rolls the whole replace back, DELETEs included, so a reader sees the previous snapshot or the new one and never a half-applied mix.',
      [CHIP_HARNESS],
    ) +
      `<div class="card"><div class="head"><span class="req">Why not over HTTP</span><span class="pill warn">harness note</span></div><div class="body">
        <div class="note">This is the one proof on these sheets that is <b>not</b> driven through the running Worker, and the reason is the guard itself: <code>validateSnapshotPayload</code> refuses <code>status:"someday"</code> with <b>400 BAD_STATUS</b> before any storage work (that real HTTP refusal is sheet 05, step g3). To reach the storage CHECK <i>inside</i> the batch, this probe imports the real <code>src/roadmap-mirror.ts</code> and calls <code>replaceRoadmapMirror()</code> directly against a real SQLite database with the real migration chain applied — the same fixture idiom as apps/relay/tests/roadmap-mirror.test.ts.</div>
        <div class="kv">
          <div class="k2">poisoned item</div><div class="v2">items[${r.poisoned.index}] <b>${esc(r.poisoned.slug)}</b> · ${esc(r.poisoned.field)} = "${esc(r.poisoned.value)}"</div>
          <div class="k2">watermark attempted</div><div class="v2">${r.poisoned.watermarkAttempted} · ${esc(iso(r.poisoned.watermarkAttempted))}</div>
          <div class="k2">batch threw</div><div class="v2">${esc(r.thrown ?? '(nothing — THIS WOULD BE A FAILURE)')}</div>
          <div class="k2">before === after</div><div class="v2"><b class="${r.identical ? 'same' : ''}">${r.identical ? 'IDENTICAL' : 'DIFFERENT'}</b></div>
        </div>
      </div></div>
      <div class="card"><div class="head"><span class="req">Before → after, around the failed replace</span><span class="pill ok">state preserved</span></div><div class="body">
        <div class="grid2">${rollbackSide('BEFORE — the surviving snapshot', r.before)}${rollbackSide('AFTER — the poisoned replace threw', r.after)}</div>
        <div class="delta" style="margin-top:13px">The failed replace attempted watermark <b>${esc(iso(r.poisoned.watermarkAttempted))}</b>; the mirror still reports <b>${esc(iso(r.after.mirror.generatedAt))}</b>. The DELETE half of the batch did not survive either — <b>${r.after.itemRowsInDb}</b> item rows remain.</div>
        <pre style="margin-top:12px">${j(r)}</pre>
      </div></div>
      <div class="foot">Probe source: docs/reports/relay-roadmap-mirror/rollback-probe.ts. Raw result is embedded in run-log.json under <code>rollback</code>.</div>`,
  );
}

// ── walkthrough (motion) ─────────────────────────────────────────────────────

function walkthroughPage(runLog) {
  const frames = [
    { cap: '1 · never synced', s: byId(runLog, 'n1'), kind: 'json' },
    { cap: '2 · pushed an empty roadmap', s: byId(runLog, 'n3'), kind: 'board' },
    { cap: '3 · pushed the real roadmap export', s: byId(runLog, 'a2'), kind: 'board' },
    { cap: '4 · re-pushed — full replace', s: byId(runLog, 'b2'), kind: 'board' },
  ];
  const tomb = runLog.augmentation.tombstone;
  const bodies = frames.map((f) => {
    if (f.kind === 'json') {
      return `<div class="note">GET ${esc(f.s.request.url)} → <b style="color:#ff9492">HTTP ${f.s.status}</b></div><pre>${j(f.s.body)}</pre>`;
    }
    const b = f.s.body;
    const lanes = STATUSES.map((st) => laneColumn(st, b.board[st] ?? [], 5)).join('');
    const live = STATUSES.reduce((n, st) => n + (b.board[st] ?? []).length, 0);
    const has = STATUSES.some((st) => (b.board[st] ?? []).some((x) => x.slug === tomb));
    return `<div class="note">GET ${esc(f.s.request.url)} → <b style="color:#7ee787">HTTP ${f.s.status}</b> · ${live} live items</div>
      ${watermark(b.mirror)}
      <div class="lanes">${lanes}</div>
      <div class="delta" style="margin-top:12px">tombstoned slug <b>${esc(tomb)}</b> on the board: <b class="${has ? '' : 'same'}">${has ? 'present' : 'absent'}</b> · activity tail <b>${(b.activity ?? []).length}</b></div>`;
  });
  const steps = frames
    .map((f, i) => `<div class="wstep" data-i="${i}"><span class="dot"></span>${esc(f.cap)}</div>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}
    body{padding:18px 22px}
    .wbar{display:flex;gap:9px;margin-bottom:14px;flex-wrap:wrap}
    .wstep{border:1px solid #30363d;border-radius:999px;padding:4px 13px;font-size:12px;color:#6e7681;display:flex;align-items:center;gap:7px}
    .wstep .dot{width:7px;height:7px;border-radius:50%;background:#30363d}
    .wstep.on{border-color:#2ea043;color:#7ee787;background:#0f2417}
    .wstep.on .dot{background:#7ee787}
    .frame{display:none}.frame.on{display:block}
    </style></head><body><div class="sheet">
    <div class="disclaimer" style="padding:9px 13px;font-size:12.5px"><b>No operator page in this slice</b> — this is the real <code>GET /v1/roadmap/mirror</code> response at four points in a real push sequence, laid out for reading. Pages land in PR 3/4.</div>
    <div class="wbar">${steps}</div>
    ${bodies.map((b, i) => `<div class="frame" data-i="${i}">${b}</div>`).join('')}
    </div><script>
      window.showStep = (n) => {
        document.querySelectorAll('.wstep').forEach((e) => e.classList.toggle('on', Number(e.dataset.i) <= n));
        document.querySelectorAll('.frame').forEach((e) => e.classList.toggle('on', Number(e.dataset.i) === n));
      };
      window.showStep(0);
    </script></body></html>`;
}

// ── driver ───────────────────────────────────────────────────────────────────

export async function render(runLog, outDir) {
  const { chromium } = loadPlaywright();
  mkdirSync(outDir, { recursive: true });
  const html = join(outDir, 'sheets');
  mkdirSync(html, { recursive: true });

  const sheets = [
    ['01-null-states', sheetNullStates(runLog)],
    ['02-mirror-board', sheetBoard(runLog)],
    ['03-item-detail-edges', sheetItemDetail(runLog)],
    ['04-tombstone', sheetTombstone(runLog)],
    ['05-payload-guards', sheetGuards(runLog)],
    ['06-atomic-rollback', sheetRollback(runLog)],
  ];

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
  const pg = await ctx.newPage();
  for (const [name, doc] of sheets) {
    const file = join(html, `${name}.html`);
    writeFileSync(file, doc);
    await pg.goto(`file://${file}`);
    await pg.waitForLoadState('networkidle');
    await pg.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
    console.log('[render] wrote', `${name}.png`);
  }
  await ctx.close();

  // Motion: the real read at four points of a real push sequence.
  const wfile = join(html, 'walkthrough.html');
  writeFileSync(wfile, walkthroughPage(runLog));
  const vdir = join(outDir, '.video');
  rmSync(vdir, { recursive: true, force: true });
  const vctx = await browser.newContext({
    viewport: { width: 1280, height: 780 },
    recordVideo: { dir: vdir, size: { width: 1280, height: 780 } },
  });
  const vpg = await vctx.newPage();
  await vpg.goto(`file://${wfile}`);
  await vpg.waitForLoadState('networkidle');
  for (let i = 0; i < 4; i++) {
    await vpg.evaluate((n) => window.showStep(n), i);
    await vpg.waitForTimeout(i === 3 ? 3400 : 2400);
  }
  await vctx.close();
  await browser.close();

  const vid = readdirSync(vdir).find((f) => f.endsWith('.webm'));
  if (vid) {
    renameSync(join(vdir, vid), join(outDir, 'walkthrough.webm'));
    console.log('[render] wrote walkthrough.webm');
  }
  rmSync(vdir, { recursive: true, force: true });
}

if (process.argv[1] && process.argv[1].endsWith('render.mjs')) {
  await render(JSON.parse(readFileSync(join(HERE, 'run-log.json'), 'utf8')), HERE);
}
