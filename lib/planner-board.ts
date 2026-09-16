/**
 * Planner board — render a PlannerPlan + schedule into a self-contained, live HTML board
 * (ADR-0086 §5, the "eminently browsable" surface).
 *
 * Pure: `(plan, schedule, items) → html string`. The IO layer (`pd roadmap board`) computes the
 * schedule and writes/serves the file. The board opens offline from `file://` (the embedded
 * snapshot renders immediately), and when served from the daemon (same origin) the embedded JS
 * goes LIVE: it polls `/roadmap/items` to refresh status chips and exposes a tube box that posts
 * a message to a channel/agent. Off-origin (file://) it degrades gracefully — the static board
 * still renders, with a "serve from the daemon for live mode" note.
 *
 * Design follows the repo UI rules: ≥14px body, 12px only on uppercase tracked eyebrows, AAA
 * contrast, palette v2 (gold accent, crimson alert), no emoji-as-icon.
 */

import type { PlannerPlan, PlanNode } from './planner-migrate.js';
import type { ScheduleResult } from './planner-schedule.js';

export interface BoardItemView {
  slug: string;
  summaryMd: string;
  status: string;
  harbor: string;
  dependencies: string[];
  /**
   * Actual start, epoch ms — `lib/roadmap-items.ts`'s `startedAt`, "the
   * Gantt's left date anchor when present". Optional so every existing
   * caller (which never populated it) keeps compiling unchanged; undefined
   * and null are both treated as absent by the date-anchoring pass below.
   */
  startedAt?: number | null;
  /**
   * Target finish, epoch ms — `dueAt`, "the Gantt's right date anchor when
   * present". Only when BOTH `startedAt` and `dueAt` are present (and
   * `dueAt` lands after `startedAt`) does `renderBoard` draw that task's bar
   * at its real dates instead of the CPM-relative offset — see the
   * date-anchoring pass inside `renderBoard`.
   */
  dueAt?: number | null;
}

/** Per-ADR metadata for epic labels + inline reading, keyed by 4-digit number ("0048"). */
export interface AdrMeta {
  /** English title from the ADR's `# NNNN. Title` heading. */
  title?: string;
  /** Pre-rendered (already HTML-safe) ADR body for inline reading. */
  html?: string;
  /** Repo-relative path, for the source link. */
  path?: string;
}

export interface BoardInput {
  plan: PlannerPlan;
  schedule: ScheduleResult;
  items: BoardItemView[];
  generatedAt: number;
  /** ADR metadata keyed by 4-digit number, for English epic names + inline ADR text. */
  adrs?: Record<string, AdrMeta>;
  /** Daemon base URL for live mode (same-origin when served from the daemon). */
  pdBase?: string;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Pick the tick spacing (in schedule units ≈ days) for the Gantt time axis.
 *
 * Why adaptive: the schedule's span varies from a couple of days to a year+,
 * and a fixed cadence either crowds the axis with labels or leaves it bare.
 * The ladder is calendar-shaped on purpose — day, 2-day, week, fortnight,
 * 4-week, quarter, half-year, year — so the ticks the operator sees are the
 * time units they plan in (days → weeks → months-ish), not arbitrary
 * decimals. Ceiling division counts the INTERVALS the span actually needs;
 * the chosen step is the smallest rung that keeps the axis at ≤ 8 of them.
 * Mirror of `axis_tick_step` in `core/pd-console/src/planner_pane.rs` — the
 * two Gantt surfaces must agree on what a tick means.
 *
 * @param span - Schedule makespan in units (1 unit = 1 day by convention).
 * @returns The tick step in units, always ≥ 1.
 */
export function axisTickStep(span: number): number {
  const ladder = [1, 2, 7, 14, 28, 91, 182, 364];
  for (const step of ladder) {
    if (Math.ceil(span / step) <= 8) return step;
  }
  return (Math.floor(span / (364 * 8)) + 1) * 364;
}

/** One tick of the board Gantt's time axis (see {@link axisTicks}). */
export interface AxisTick {
  /** Schedule offset in units from the anchor. */
  unit: number;
  /** Horizontal position as a percentage of the bar lane. */
  pct: number;
  /** Human label: `today` for unit 0, else the real `MM-DD` date. */
  label: string;
  /** True on the unit-0 tick — the today-marker gets distinct styling. */
  isToday: boolean;
}

/**
 * Compute the labeled ticks for the board Gantt's time axis.
 *
 * Why it exists: bars without an x-axis are only relative geometry — the
 * operator asked for actual time units. The kernel's CPM schedule itself is
 * still purely relative (ADR-0086: the scheduler has no absolute-date
 * anchor), so the axis anchors unit 0 at the render instant under the
 * declared planning convention 1 estimate unit = 1 day: tick 0 is the
 * today-marker and later ticks carry real UTC `MM-DD` dates at the adaptive
 * cadence of {@link axisTickStep}. `renderBoard`'s date-anchoring pass
 * overrides individual bars with real `startedAt`/`dueAt` offsets when an
 * item has them, but every bar — anchored or relative — is placed on this
 * SAME anchor-relative axis, so "day 3" always means the same wall-clock day
 * regardless of which kind of bar is drawn there. The schedule's end always
 * gets a closing tick (its date is "when does the plan land"), even when the
 * makespan is not a multiple of the step.
 *
 * @param span - Schedule makespan in units (clamped ≥ 1 by the caller).
 * @param anchorMs - Epoch ms of unit 0 (the board's `generatedAt`).
 * @returns Ticks ordered by unit, positions in percent of the lane.
 */
export function axisTicks(span: number, anchorMs: number): AxisTick[] {
  const step = axisTickStep(span);
  const ticks: AxisTick[] = [];
  const push = (unit: number) => {
    const d = new Date(anchorMs + unit * 86_400_000);
    ticks.push({
      unit,
      pct: (unit / Math.max(span, 1)) * 100,
      label:
        unit === 0
          ? 'today'
          : `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      isToday: unit === 0,
    });
  };
  for (let t = 0; t <= span; t += step) push(t);
  if (span % step !== 0) push(span);
  return ticks;
}

/**
 * Whole-day offset of an epoch-ms timestamp from `anchorMs`, under the exact
 * "1 unit = 1 day, unit 0 = anchor" convention `axisTicks` already draws the
 * axis with. Why this exists: converts a real `startedAt`/`dueAt` (wall
 * clock) into the same
 * relative-unit coordinate space CPM bars live in, so a date-anchored bar and
 * a CPM-relative bar share one axis without a second rendering code path.
 * Mirror of `day_offset_from` in `core/pd-console/src/planner_pane.rs` — the
 * two Gantt surfaces must agree on what "day 3" means.
 *
 * @param anchorMs - Epoch ms of unit 0 (the board's `generatedAt`).
 * @param epochMs - The real timestamp to place on the axis.
 * @returns Signed day offset (negative when `epochMs` is before the anchor).
 */
export function dayOffsetFromAnchor(anchorMs: number, epochMs: number): number {
  return Math.round((epochMs - anchorMs) / 86_400_000);
}

/** Render the whole board to a single self-contained HTML document. */
export function renderBoard(input: BoardInput): string {
  const { plan, schedule, items, generatedAt } = input;
  // Default to same-origin: the board's JS then fetches '/roadmap/items' relative to wherever
  // it's served (the daemon). The dry-run generator passes an explicit base for file:// viewing.
  const pdBase = input.pdBase ?? '';

  const itemBySlug = new Map(items.map((i) => [i.slug, i]));
  const schedById = new Map(schedule.nodes.map((n) => [n.id, n]));
  const critical = new Set(schedule.criticalPath);

  const tasksByEpic = new Map<string, PlanNode[]>();
  for (const t of plan.tasks) {
    const arr = tasksByEpic.get(t.parent ?? '') ?? [];
    arr.push(t);
    tasksByEpic.set(t.parent ?? '', arr);
  }

  const totalTasks = plan.tasks.length;
  const flags = plan.flags;

  // Embed everything the live layer needs. Escape `<` so a `</script>` inside any string can't
  // break out of the <script> tag (XSS / tag-injection safety).
  const payload = JSON.stringify({ plan, schedule, items, generatedAt, pdBase }).replace(/</g, '\\u003c');

  const statusChip = (status: string) =>
    `<span class="chip status-${esc(status)}">${esc(status)}</span>`;
  const prChip = (p?: number) =>
    p ? `<span class="chip pri pri-${p}" title="priority ${p}">P${p}</span>` : '';

  const epicSections = plan.epics
    .map((epic) => {
      const tasks = (tasksByEpic.get(epic.id) ?? []).sort((a, b) =>
        a.slug! < b.slug! ? -1 : 1,
      );
      const adrNum = epic.id.startsWith('adr-') ? epic.id.replace('adr-', '') : null;
      const meta = adrNum ? input.adrs?.[adrNum] : undefined;
      const epicTitle = meta?.title ? `ADR-${esc(adrNum!)} — ${esc(meta.title)}` : esc(epic.title);
      const epicLink = adrNum
        ? `<a class="adrlink" href="https://github.com/curiositech/port-daddy/blob/main/${esc(meta?.path ?? `docs/adr/${adrNum}-`)}" target="_blank" rel="noreferrer">${esc(meta?.path ?? `docs/adr/${adrNum}`)}</a>`
        : '';
      const adrBody = meta?.html
        ? `<details class="adrdoc"><summary>Read ADR inline</summary><div class="adrbody">${meta.html}</div></details>`
        : '';
      const rows = tasks
        .map((t) => {
          const it = itemBySlug.get(t.slug!);
          const sn = schedById.get(t.slug!);
          const isCrit = critical.has(t.slug!);
          const deps = it?.dependencies?.length
            ? `<span class="deps" title="${esc(it.dependencies.join(', '))}">⛓ ${it.dependencies.length}</span>`
            : '';
          const critBadge = isCrit ? `<span class="chip crit">critical path</span>` : '';
          const slackTxt =
            sn && !isCrit && sn.slack > 0 ? `<span class="slack">slack ${sn.slack}</span>` : '';
          return `<div class="task${isCrit ? ' is-crit' : ''}" data-slug="${esc(t.slug!)}">
            <div class="task-main">
              <span class="task-slug">${esc(t.slug!)}</span>
              ${statusChip(t.status ?? '')}${prChip(t.priority)}${critBadge}
            </div>
            <div class="task-meta">${deps}${slackTxt}<span class="summ">${esc((t.summaryMd ?? '').slice(0, 140))}</span></div>
          </div>`;
        })
        .join('\n');
      return `<details class="epic" open>
        <summary><span class="epic-title">${epicTitle}</span>
          <span class="epic-count">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
          ${epicLink}</summary>
        ${adrBody}
        <div class="tasks">${rows || '<div class="empty">no tasks</div>'}</div>
      </details>`;
    })
    .join('\n');

  // Gantt rows ordered by earliest start then slug.
  //
  // Date anchoring (additive, backward-compatible — mirrors the Rust twin's
  // `PlannerPane::gantt` in `core/pd-console/src/planner_pane.rs`): a task
  // whose roadmap item carries BOTH a valid `startedAt` and `dueAt` renders
  // at its real wall-clock day-offset from `generatedAt` (the same unit-0
  // anchor `axisTicks` already draws "today" at) instead of the CPM-relative
  // `earliestStart`/`earliestFinish`. `critical` membership is untouched —
  // it still comes from `schedule.criticalPath`, the kernel's parity-tested
  // TS twin output (`lib/planner-schedule.ts`) — dates only ever change
  // WHERE a bar is drawn, never the dependency-order math. An item missing
  // either field, or with `dueAt` not after `startedAt`, keeps today's plain
  // CPM offset exactly as before this field pair was read.
  const ganttEntries = [...plan.tasks]
    .map((t) => ({ t, sn: schedById.get(t.slug!) }))
    .filter((x): x is { t: PlanNode; sn: NonNullable<typeof x.sn> } => Boolean(x.sn))
    .map(({ t, sn }) => {
      const it = itemBySlug.get(t.slug!);
      const started = it?.startedAt;
      const due = it?.dueAt;
      if (started != null && started > 0 && due != null && due > started) {
        const startU = Math.max(dayOffsetFromAnchor(generatedAt, started), 0);
        const finishU = Math.max(dayOffsetFromAnchor(generatedAt, due), startU + 1);
        return { t, start: startU, finish: finishU, dateAnchored: true };
      }
      return { t, start: sn.earliestStart, finish: sn.earliestFinish, dateAnchored: false };
    });
  // The render span is the CPM makespan UNLESS a date-anchored task's real
  // due date lands past it (the schedule only knows effort/deps, never real
  // dates) — widen so a wall-clock bar can never overflow the lane.
  const ganttSpan = ganttEntries.reduce((m, e) => Math.max(m, e.finish), Math.max(schedule.makespan, 1));
  // Time axis: unit 0 anchored at the board's own generatedAt (1 est unit =
  // 1 day), adaptive tick cadence, gridlines aligned to the same percent
  // geometry the bars use, today-marker on the unit-0 line.
  const ticks = axisTicks(ganttSpan, generatedAt);
  const tickStep = axisTickStep(ganttSpan);
  const tickAnchor = (pct: number) =>
    pct < 4 ? '' : pct > 96 ? 'transform:translateX(-100%)' : 'transform:translateX(-50%)';
  const axisLabels = ticks
    // Drop the closing label (never its gridline) when it would sit on top of
    // the previous one — a partial trailing interval can land two dates a few
    // percent apart.
    .filter((k, i, all) => i === 0 || k.pct - all[i - 1].pct >= 7)
    .map(
      (k) =>
        `<span class="gtick${k.isToday ? ' gtoday' : ''}" style="left:${k.pct.toFixed(3)}%;${tickAnchor(k.pct)}">${esc(k.label)}</span>`,
    )
    .join('');
  const gridLines = ticks
    .map(
      (k) =>
        `<div class="ggridline${k.isToday ? ' gtoday-line' : ''}" style="left:${k.pct.toFixed(3)}%"></div>`,
    )
    .join('');
  const ganttRows = [...ganttEntries]
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.t.slug! < b.t.slug! ? -1 : 1))
    .map(({ t, start, finish, dateAnchored }) => {
      const left = (start / ganttSpan) * 100;
      const width = Math.max(((finish - start) / ganttSpan) * 100, 2);
      const crit = critical.has(t.slug!);
      const datedBadge = dateAnchored
        ? `<span class="gdated" title="anchored to real startedAt/dueAt">dated</span>`
        : '';
      return `<div class="grow">
        <div class="glabel" title="${esc(t.slug!)}">${esc(t.slug!)}${datedBadge}</div>
        <div class="gtrack"><div class="gbar${crit ? ' gcrit' : ''}${dateAnchored ? ' gdatedbar' : ''}" style="left:${left}%;width:${width}%"></div></div>
      </div>`;
    })
    .join('\n');

  const flagBanner = (() => {
    const parts: string[] = [];
    if (flags.duplicates.length)
      parts.push(
        `<b>${flags.duplicates.length} duplicate slug${flags.duplicates.length === 1 ? '' : 's'}</b>: ${flags.duplicates.map((d) => `${esc(d.slug)} ×${d.count}`).join(', ')}`,
      );
    if (flags.harbors.length > 1)
      parts.push(
        `<b>harbor split</b>: ${flags.harbors.map((h) => `${esc(h.harbor)} (${h.count})`).join(', ')}`,
      );
    if (flags.loose.length) parts.push(`<b>${flags.loose.length} unsorted</b> (no ADR)`);
    if (flags.danglingDeps.length)
      parts.push(`<b>${flags.danglingDeps.length} dangling dep${flags.danglingDeps.length === 1 ? '' : 's'}</b>`);
    if (!parts.length) return '';
    return `<div class="flags"><span class="eyebrow">flagged — not auto-fixed</span><div>${parts.join(' &nbsp;·&nbsp; ')}</div></div>`;
  })();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Port Daddy — Planner Board</title>
<style>
  :root{
    --bg:#0d1117; --panel:#161b22; --panel2:#1c232c; --ink:#e8edf2; --muted:#9aa7b4;
    --line:#2b333d; --gold:#d8dd3c; --crimson:#E5484D; --teal:#3fb6a8; --blue:#5aa0e6;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .eyebrow{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}
  header{padding:22px 26px;border-bottom:3px solid var(--gold);background:var(--panel)}
  h1{margin:0 0 4px;font-size:24px;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:14px}
  .counts{display:flex;gap:18px;margin-top:14px;flex-wrap:wrap}
  .count{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;min-width:92px}
  .count b{display:block;font-size:22px;line-height:1.1}
  .count span{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700}
  .flags{margin:14px 26px 0;background:rgba(229,72,77,.1);border:1px solid var(--crimson);
    border-radius:10px;padding:12px 14px;font-size:14px}
  .flags b{color:var(--gold);font-weight:700}
  .tabs{display:flex;gap:6px;padding:14px 26px 0}
  .tab{background:var(--panel2);border:1px solid var(--line);color:var(--ink);padding:8px 16px;
    border-radius:8px 8px 0 0;cursor:pointer;font-size:14px;font-weight:600}
  .tab.active{background:var(--panel);border-bottom-color:var(--panel);color:var(--gold)}
  main{padding:0 26px 60px}
  .view{display:none;background:var(--panel);border:1px solid var(--line);border-radius:0 10px 10px 10px;padding:18px}
  .view.active{display:block}
  details.epic{border:1px solid var(--line);border-radius:10px;margin-bottom:12px;background:var(--panel2)}
  details.epic>summary{cursor:pointer;padding:12px 14px;font-size:15px;display:flex;align-items:center;gap:12px;list-style:none}
  details.epic>summary::-webkit-details-marker{display:none}
  .epic-title{font-weight:700;color:var(--gold);font-size:16px}
  .epic-count{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700}
  .adrlink{margin-left:auto;font-size:13px;color:var(--blue);text-decoration:none}
  .adrlink:hover{text-decoration:underline}
  .tasks{padding:6px 12px 12px}
  .task{padding:10px 12px;border-top:1px solid var(--line)}
  .task.is-crit{box-shadow:inset 3px 0 0 var(--gold)}
  .task-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .task-slug{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;font-weight:600}
  .task-meta{margin-top:4px;display:flex;gap:12px;align-items:center;color:var(--muted);font-size:13.5px}
  .summ{color:var(--muted)}
  .chip{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
  .status-now{background:rgba(216,221,60,.16);color:var(--gold);border-color:var(--gold)}
  .status-backlog{background:rgba(90,160,230,.14);color:var(--blue);border-color:#3a5d80}
  .status-parked{background:#222a33;color:var(--muted)}
  .status-merge,.status-done{background:rgba(63,182,168,.14);color:var(--teal);border-color:#2f6f67}
  .pri{color:var(--ink)}.pri-1,.pri-2{border-color:var(--crimson);color:#ff9b9e}
  .crit{background:var(--gold);color:#1a1300;border-color:var(--gold)}
  .deps,.slack{font-size:13px}
  .grow{display:flex;align-items:center;gap:10px;margin:3px 0}
  /* Time axis: label row above the bars + a gridline overlay across every
     track, both sharing the bars' percent geometry (left:N% of the lane). */
  .gaxis{margin:0 0 6px}
  .gaxis-note{color:var(--muted);font-size:12px}
  .gaxis-track{flex:1;position:relative;height:18px}
  .gtick{position:absolute;top:1px;font-family:ui-monospace,Menlo,monospace;font-size:12px;color:var(--muted);white-space:nowrap}
  .gtick.gtoday{color:var(--teal);font-weight:600}
  .gantt-body{position:relative}
  .ggrid{position:absolute;left:310px;right:0;top:0;bottom:0;pointer-events:none;z-index:2}
  .ggridline{position:absolute;top:0;bottom:0;width:1px;background:rgba(232,237,242,.14)}
  .ggridline.gtoday-line{width:2px;background:var(--teal);opacity:.75}
  .glabel{width:300px;flex:none;font-family:ui-monospace,Menlo,monospace;font-size:13px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
  .gtrack{flex:1;position:relative;height:18px;background:var(--panel2);border-radius:5px;overflow:hidden}
  .gbar{position:absolute;top:0;bottom:0;background:#3a5d80;border-radius:5px}
  .gbar.gcrit{background:var(--gold)}
  .gbar.gdatedbar{box-shadow:inset 0 0 0 2px var(--teal)}
  .gdated{margin-left:6px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--teal)}
  .live{display:flex;align-items:center;gap:10px;margin:14px 26px 0;font-size:13.5px;color:var(--muted)}
  .dot{width:9px;height:9px;border-radius:50%;background:#555}
  .dot.on{background:var(--teal)} .dot.off{background:var(--crimson)}
  .tube{margin-left:auto;display:flex;gap:6px}
  .tube input{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 10px;font-size:14px}
  .tube button{background:var(--gold);color:#1a1300;border:0;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;font-size:14px}
  .empty{color:var(--muted);padding:10px;font-size:14px}
  details.adrdoc{margin:2px 12px 10px}
  details.adrdoc>summary{cursor:pointer;font-size:13px;font-weight:700;text-transform:uppercase;
    letter-spacing:.08em;color:var(--blue);padding:6px 0;list-style:none}
  details.adrdoc>summary::-webkit-details-marker{display:none}
  details.adrdoc>summary::before{content:"▸ ";color:var(--muted)}
  details.adrdoc[open]>summary::before{content:"▾ "}
  .adrbody{background:#0b0f14;border:1px solid var(--line);border-radius:10px;padding:16px 20px;
    max-height:520px;overflow:auto;font-size:15px;line-height:1.62;color:#d7e0ea}
  .adrbody h1,.adrbody h2,.adrbody h3{color:var(--gold);margin:18px 0 8px;line-height:1.3}
  .adrbody h1{font-size:20px}.adrbody h2{font-size:17px}.adrbody h3{font-size:15px}
  .adrbody p{margin:8px 0}.adrbody ul,.adrbody ol{margin:8px 0;padding-left:22px}
  .adrbody li{margin:3px 0}
  .adrbody code{font-family:ui-monospace,Menlo,monospace;font-size:13.5px;background:#1c232c;padding:1px 5px;border-radius:5px}
  .adrbody pre{background:#1c232c;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto}
  .adrbody pre code{background:none;padding:0}
  .adrbody a{color:var(--blue)}
  .adrbody table{border-collapse:collapse;width:100%;margin:10px 0;font-size:13.5px}
  .adrbody th,.adrbody td{border:1px solid var(--line);padding:6px 9px;text-align:left;vertical-align:top}
  .adrbody th{background:#1c232c;color:var(--ink)}
  .adrbody blockquote{border-left:3px solid var(--line);margin:8px 0;padding:2px 14px;color:var(--muted)}
  .adrbody hr{border:0;border-top:1px solid var(--line);margin:14px 0}
</style></head>
<body>
<header>
  <div class="eyebrow">Port Daddy · roadmap → planner (ADR-0086)</div>
  <h1>${esc(plan.project.title)} — Planner Board</h1>
  <div class="sub">${plan.epics.length} epics · ${totalTasks} tasks · critical path ${schedule.criticalPath.length} deep · generated ${new Date(generatedAt).toISOString().replace('T', ' ').slice(0, 16)}</div>
  <div class="counts">
    <div class="count"><b>${plan.epics.length}</b><span>epics</span></div>
    <div class="count"><b>${totalTasks}</b><span>tasks</span></div>
    <div class="count"><b>${plan.dependsOnEdges.length}</b><span>dep edges</span></div>
    <div class="count"><b>${schedule.criticalPath.length}</b><span>critical</span></div>
    <div class="count"><b>${flags.loose.length}</b><span>unsorted</span></div>
  </div>
</header>
${flagBanner}
<div class="live">
  <span class="dot off" id="livedot"></span><span id="livetxt">live: connecting…</span>
  <form class="tube" id="tubeform" onsubmit="return pdTube(event)">
    <input id="tubechan" placeholder="channel or agent id" size="18"/>
    <input id="tubemsg" placeholder="message over the tube…" size="26"/>
    <button type="submit">tube it</button>
  </form>
</div>
<div class="tabs">
  <button class="tab active" data-view="tree" onclick="showView('tree')">Tree</button>
  <button class="tab" data-view="gantt" onclick="showView('gantt')">Gantt · critical path</button>
</div>
<main>
  <section class="view active" id="view-tree">${epicSections}</section>
  <section class="view" id="view-gantt">${
    ganttRows
      ? `<div class="grow gaxis"><div class="glabel gaxis-note">1 est unit = 1 day · ${tickStep}d ticks</div><div class="gaxis-track">${axisLabels}</div></div>
  <div class="gantt-body"><div class="ggrid" aria-hidden="true">${gridLines}</div>
${ganttRows}</div>`
      : '<div class="empty">no schedule</div>'
  }</section>
</main>
<script id="board-data" type="application/json">${payload}</script>
<script>
  const DATA = JSON.parse(document.getElementById('board-data').textContent);
  function showView(v){
    for(const el of document.querySelectorAll('.view')) el.classList.toggle('active', el.id==='view-'+v);
    for(const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.dataset.view===v);
  }
  // Live layer: poll the daemon for fresh roadmap items; update status chips by slug.
  async function poll(){
    const dot=document.getElementById('livedot'), txt=document.getElementById('livetxt');
    try{
      const r=await fetch(DATA.pdBase+'/roadmap/items?status=all&limit=2000',{cache:'no-store'});
      const j=await r.json();
      const items=j.items||j.data||j||[];
      let changed=0;
      for(const it of items){
        const el=document.querySelector('.task[data-slug="'+CSS.escape(it.slug)+'"] .status-now,'+
                 '.task[data-slug="'+CSS.escape(it.slug)+'"] .chip.status-backlog');
        // Light refresh: update the first status chip's class/text if it drifted.
        const node=document.querySelector('.task[data-slug="'+CSS.escape(it.slug)+'"] .chip');
        if(node && ['now','backlog','parked','merge','done'].includes(it.status) && node.textContent!==it.status){ node.textContent=it.status; node.className='chip status-'+it.status; changed++; }
      }
      dot.className='dot on';
      txt.textContent='live · '+items.length+' items'+(changed?(' · '+changed+' updated'):'');
    }catch(e){
      dot.className='dot off';
      txt.textContent='static snapshot — serve this board from the daemon ('+DATA.pdBase+') for live mode';
    }
  }
  async function pdTube(ev){
    ev.preventDefault();
    const chan=document.getElementById('tubechan').value.trim();
    const msg=document.getElementById('tubemsg').value.trim();
    if(!chan||!msg) return false;
    try{
      await fetch(DATA.pdBase+'/messages',{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({channel:chan,content:msg,from:'planner-board'})});
      document.getElementById('tubemsg').value='';
      document.getElementById('livetxt').textContent='tubed → '+chan;
    }catch(e){ document.getElementById('livetxt').textContent='tube failed (serve from daemon for live mode)'; }
    return false;
  }
  poll(); setInterval(poll, 12000);
</script>
</body></html>`;
}
