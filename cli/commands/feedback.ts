/**
 * Feedback CLI — `pd feedback [<message> | drop|list|show|harvest|summary]`
 *
 * Thin wrapper around `/feedback/*` HTTP endpoints. Lets agents and
 * humans drop structured findings without writing markdown files. The
 * feedback stream is what cartographer harvests into the roadmap.
 *
 * Bare form: `pd feedback "summary text"` drops a finding with auto-
 * derived slug and droppedBy (from active session/agent context).
 */

import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { isStdinInteractive } from '../utils/tty.js';
import { loadFleetConfig } from '../../lib/fleet-engine.js';
import { readCurrentContext } from '../utils/current-context.js';

const SUBCOMMANDS = new Set([
  'drop', 'list', 'show', 'harvest', 'ack', 'summary',
  'recent', 'mine', 'open', 'fleetbot', 'help', '--help', '-h',
]);

function readSummaryFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    // Interactive terminal → no piped body; return empty (caller errors loudly).
    // Kernel-level check: `process.stdin.isTTY` is falsy under the bun-compiled
    // binary on a real terminal, which used to mis-route an interactive run
    // into reading stdin and blocking on EOF.
    if (isStdinInteractive(process.stdin)) {
      resolve('');
      return;
    }
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => resolve(buf.trim()));
    process.stdin.on('error', () => resolve(''));
  });
}

/**
 * Auto-detect surface from CWD when not explicitly set. Looks for the closest
 * directory marker that maps to a known surface (CLI/API/MCP/Routes/Lib/Fleet/UI).
 * Returns undefined when no clear match — caller can omit the field.
 */
function inferSurfaceFromCwd(): string | undefined {
  const cwd = process.cwd();
  const segments = cwd.split('/').filter(Boolean);
  // Walk segments right-to-left, first match wins.
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].toLowerCase();
    if (seg === 'cli' || seg === 'bin') return 'CLI';
    if (seg === 'mcp' || seg === 'mcp-server') return 'MCP';
    if (seg === 'routes' || seg === 'api') return 'API';
    if (seg === 'dashboard' || seg === 'website' || seg === 'apps') return 'UI';
    if (seg === 'fleet') return 'Fleet';
    if (seg === 'lib') return 'Lib';
    if (seg === 'docs') return 'Docs';
  }
  return undefined;
}

/**
 * Resolve `--fleetbot-review <ref>` into a bare fleet run id.
 *
 * Agents/humans copy this from wherever they're looking at the verdict:
 *   - the run-page capability URL fleetbot already posts as the check run's
 *     "Details" link — `https://relay.../fleet/runs/run%3A<id>?t=v1.<hmac>`
 *   - or the bare run id itself (`run:<deliveryId>`) if they already have it.
 *
 * Both resolve to the same `run:<deliveryId>` string that lib/feedback.ts
 * stores as `fleetbotRunId`. Anything else is returned trimmed, unparsed —
 * the daemon doesn't validate shape, so an unrecognized ref still gets
 * captured rather than rejected.
 */
export function parseFleetbotRef(raw: string): string {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  const m = /\/fleet\/runs\/([^/?#]+)/.exec(trimmed);
  if (!m) return trimmed;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function severityFromOptions(options: CLIOptions): string | undefined {
  const explicit = readString(options, 'severity');
  if (explicit) return explicit;
  // Convenience flags: --critical / --high / --medium / --low
  if (options.critical) return 'critical';
  if (options.high) return 'high';
  if (options.medium) return 'medium';
  if (options.low) return 'low';
  return undefined;
}

function slugFromSummary(summary: string): string {
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join('-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `feedback-${Date.now().toString(36)}`;
}

/**
 * Applies `--fleetbot-review <ref>` to a drop body in place: sets
 * `fleetbotRunId`, and — unless the caller already gave an explicit value —
 * defaults `surface` to 'Fleetbot' and `severity` to 'high'. A wrong or
 * low-quality gate verdict is by default worth operator attention; explicit
 * `--surface`/`--severity`/shortcut flags still win.
 */
function applyFleetbotReview(
  body: Record<string, unknown>,
  options: CLIOptions,
  explicitSurface: string | undefined,
  explicitSeverity: string | undefined,
): void {
  const ref = readString(options, 'fleetbot-review', 'fleetbotReview');
  if (!ref) return;
  body.fleetbotRunId = parseFleetbotRef(ref);
  if (!explicitSurface) body.surface = 'Fleetbot';
  if (!explicitSeverity) body.severity = 'high';
}

function inferDroppedBy(options: CLIOptions): string {
  const explicit = readString(options, 'as', 'droppedBy', 'agent');
  if (explicit) return explicit;
  const ctx = readCurrentContext();
  if (ctx?.agentId) return ctx.agentId;
  const user = process.env.USER || process.env.USERNAME;
  return user ? `cli:${user}` : 'cli:unknown';
}

interface FeedbackEntry {
  feedbackId: string;
  slug: string;
  summary: string;
  surface: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'harvested' | 'wontfix';
  source: 'agent' | 'human' | 'mcp' | 'cli' | 'unknown';
  suggested: string | null;
  hook: string | null;
  fleetbotRunId: string | null;
  droppedBy: string;
  project: string | null;
  harbor: string;
  at: number;
  harvestedAt: number | null;
}

function readString(options: CLIOptions, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readNumber(options: CLIOptions, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function inferProject(options: CLIOptions): string | undefined {
  const explicit = readString(options, 'project');
  if (explicit) return explicit;
  if (options.all || options['all-projects'] || options.global) return undefined;
  try {
    return loadFleetConfig(process.cwd())?.name;
  } catch {
    return undefined;
  }
}

async function postJson(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function getJson(path: string): Promise<{ ok: boolean; data: any }> {
  const res = await pdFetch(`${PORT_DADDY_URL}${path}`);
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const SEVERITY_LABEL: Record<FeedbackEntry['severity'], string> = {
  critical: '!!',
  high: '!',
  medium: ' ',
  medium_alias: ' ',
  low: '·',
} as any;

function printEntry(entry: FeedbackEntry): void {
  const tag = SEVERITY_LABEL[entry.severity] ?? ' ';
  const surface = entry.surface ? `[${entry.surface}]` : '[—]';
  const status = entry.status === 'harvested' ? '(harvested)' : '';
  console.log(`  ${tag} ${entry.severity.padEnd(8)} ${surface.padEnd(14)} ${entry.slug}  ${status}`);
  console.log(`     ${entry.summary}`);
  if (entry.hook) console.log(`     hook: ${entry.hook}`);
  if (entry.fleetbotRunId) console.log(`     fleetbot run: ${entry.fleetbotRunId}`);
  if (entry.suggested) console.log(`     suggest: ${entry.suggested}`);
  console.log(`     id=${entry.feedbackId.slice(0, 8)}  by=${entry.droppedBy}  source=${entry.source}`);
}

export async function handleFeedback(args: string[], options: CLIOptions): Promise<void> {
  let sub = args[0];

  // No-args, no-stdin → show summary instead of help (more useful default).
  // Help is still reachable via `pd feedback help` / `--help` / `-h`.
  if (!sub && isStdinInteractive(process.stdin)) {
    sub = 'summary';
    args = [sub];
  }

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  pd feedback "<message>"                 Bare form — auto slug + agent from context
  cat notes.md | pd feedback              Stdin pipe — same auto-derivation
  pd feedback                             No args → shows summary (when run interactively)

Subcommands:
  pd feedback drop --slug X --summary Y --as Z [--severity ...] [--surface ...] [--hook ...] [--suggest ...]
  pd feedback list [--severity ...] [--surface ...] [--status open|harvested|all] [--limit N]
  pd feedback recent                      Alias: list --status open --limit 10
  pd feedback open                        Alias: list --status open
  pd feedback mine                        Alias: list filtered to current agent/user
  pd feedback fleetbot [--status ...] [--limit ...]   Alias: list --surface Fleetbot --status open
  pd feedback show <feedbackId>
  pd feedback ack <feedbackId> [--into <slug>]   Alias for harvest
  pd feedback harvest <feedbackId> [--into <slug>]
  pd feedback summary

Flagging a fleetbot verdict as wrong/low-quality:
  pd feedback --fleetbot-review <run-id-or-run-page-url> "why the verdict is wrong"
  pd feedback drop --slug X --summary Y --as Z --fleetbot-review <ref>

  <ref> is either the bare fleet run id (run:<deliveryId>) or the run-page
  URL fleetbot already posts as the check run's "Details" link — paste
  either and it resolves to the same run. Defaults surface=Fleetbot and
  severity=high unless you pass --surface/--severity yourself. Durably
  captured in the same feedback stream (queryable, not a comment that
  scrolls off the PR) — browse flags with \`pd feedback fleetbot\`.

Severity shortcuts (instead of --severity X):
  --critical / --high / --medium / --low

Surface auto-detection:
  Inferred from CWD (cli/→CLI, mcp/→MCP, routes/→API, dashboard/→UI, fleet/→Fleet, lib/→Lib, docs/→Docs).
  Override with --surface <X>. Pass --no-auto-surface to disable inference.

Project scoping:
  Auto-derived from fleet config in CWD. Override --project <slug> or pass --all to ignore.
`);
    return;
  }

  // Bare form: `pd feedback "free text"` — or stdin pipe — or no-args while
  // piped from a non-TTY (CI/scripts). Skipped when args[0] is a known subcommand.
  if (!sub || !SUBCOMMANDS.has(sub)) {
    let summary = sub ?? '';
    if (!summary && !isStdinInteractive(process.stdin)) {
      summary = await readSummaryFromStdin();
    }
    summary = summary.trim();
    if (!summary) {
      ui.error('feedback requires a non-empty message (positional arg or stdin pipe)');
      process.exit(1);
    }
    const droppedBy = inferDroppedBy(options);
    const slug = readString(options, 'slug') ?? slugFromSummary(summary);
    const body: Record<string, unknown> = { slug, summary, droppedBy, source: 'cli' };
    const explicitSurface = readString(options, 'surface');
    if (explicitSurface) {
      body.surface = explicitSurface;
    } else if (!options['no-auto-surface']) {
      const inferred = inferSurfaceFromCwd();
      if (inferred) body.surface = inferred;
    }
    const severity = severityFromOptions(options);
    if (severity) body.severity = severity;
    applyFleetbotReview(body, options, explicitSurface, severity);
    const sourceOverride = readString(options, 'source');
    if (sourceOverride) body.source = sourceOverride;
    const hook = readString(options, 'hook');
    if (hook) body.hook = hook;
    const suggest = readString(options, 'suggest', 'suggested');
    if (suggest) body.suggested = suggest;
    const project = inferProject(options);
    if (project) body.project = project;
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
    const ttlMs = readNumber(options, 'ttl-ms', 'ttlMs');
    if (ttlMs !== undefined) body.ttlMs = ttlMs;

    const { ok, data } = await postJson('/feedback', body);
    if (!ok) {
      ui.error(data.error || 'drop failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.entry, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(data.entry.feedbackId);
      return;
    }
    console.log(`Feedback dropped: ${data.entry.feedbackId}`);
    console.log(`  ${data.entry.severity}  ${data.entry.surface ?? '—'}  ${data.entry.slug}`);
    console.log(`  by ${data.entry.droppedBy}`);
    if (data.entry.fleetbotRunId) console.log(`  fleetbot run: ${data.entry.fleetbotRunId}`);
    return;
  }

  if (sub === 'drop') {
    const slug = readString(options, 'slug');
    const summary = readString(options, 'summary');
    const droppedBy = readString(options, 'as', 'droppedBy', 'agent');
    if (!slug || !summary || !droppedBy) {
      ui.error('--slug, --summary, and --as <agentId> are required');
      process.exit(1);
    }
    const body: Record<string, unknown> = { slug, summary, droppedBy, source: 'cli' };
    const surface = readString(options, 'surface');
    if (surface) {
      body.surface = surface;
    } else if (!options['no-auto-surface']) {
      const inferred = inferSurfaceFromCwd();
      if (inferred) body.surface = inferred;
    }
    const severity = severityFromOptions(options);
    if (severity) body.severity = severity;
    applyFleetbotReview(body, options, surface, severity);
    const sourceOverride = readString(options, 'source');
    if (sourceOverride) body.source = sourceOverride;
    const hook = readString(options, 'hook');
    if (hook) body.hook = hook;
    const suggest = readString(options, 'suggest', 'suggested');
    if (suggest) body.suggested = suggest;
    const project = inferProject(options);
    if (project) body.project = project;
    const harbor = readString(options, 'harbor');
    if (harbor) body.harbor = harbor;
    const ttlMs = readNumber(options, 'ttl-ms', 'ttlMs');
    if (ttlMs !== undefined) body.ttlMs = ttlMs;

    const { ok, data } = await postJson('/feedback', body);
    if (!ok) {
      ui.error(data.error || 'drop failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.entry, null, 2));
      return;
    }
    if (isQuiet(options)) {
      console.log(data.entry.feedbackId);
      return;
    }
    console.log(`Feedback dropped: ${data.entry.feedbackId}`);
    console.log(`  ${data.entry.severity}  ${data.entry.surface ?? '—'}  ${data.entry.slug}`);
    if (data.entry.fleetbotRunId) console.log(`  fleetbot run: ${data.entry.fleetbotRunId}`);
    return;
  }

  if (sub === 'list' || sub === 'recent' || sub === 'open' || sub === 'mine' || sub === 'fleetbot') {
    const params = new URLSearchParams();
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    else {
      const project = inferProject(options);
      if (project) params.set('project', project);
    }
    const severity = severityFromOptions(options);
    if (severity) params.set('severity', severity);
    const surface = readString(options, 'surface');
    if (surface) {
      params.set('surface', surface);
    } else if (sub === 'fleetbot') {
      params.set('surface', 'Fleetbot');
    }
    let status = readString(options, 'status');
    let limit = readNumber(options, 'limit');
    // Alias defaults — explicit options always win.
    if (sub === 'recent') {
      if (!status) status = 'open';
      if (limit === undefined) limit = 10;
    }
    if (sub === 'open' && !status) status = 'open';
    if (sub === 'fleetbot' && !status) status = 'open';
    if (status) params.set('status', status);
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const { ok, data } = await getJson(`/feedback${qs ? `?${qs}` : ''}`);
    if (!ok) {
      ui.error(data.error || 'list failed');
      process.exit(1);
    }
    let entries: FeedbackEntry[] = data.entries ?? [];
    if (sub === 'mine') {
      const me = inferDroppedBy(options);
      entries = entries.filter((e) => e.droppedBy === me);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (isQuiet(options)) {
      for (const e of entries) console.log(e.feedbackId);
      return;
    }
    const label = sub === 'mine'
      ? `${entries.length} entry(ies) by you`
      : sub === 'fleetbot'
        ? `${entries.length} fleetbot-review flag(s)`
        : `${entries.length} entry(ies)`;
    console.log(label);
    for (const e of entries) printEntry(e);
    return;
  }

  if (sub === 'show') {
    const feedbackId = args[1] || readString(options, 'id');
    if (!feedbackId) {
      ui.error('feedbackId required: pd feedback show <id>');
      process.exit(1);
    }
    const { ok, data } = await getJson(`/feedback/${encodeURIComponent(feedbackId)}`);
    if (!ok) {
      ui.error(data.error || 'not found');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.entry, null, 2));
      return;
    }
    printEntry(data.entry);
    return;
  }

  if (sub === 'harvest' || sub === 'ack') {
    const feedbackId = args[1] || readString(options, 'id');
    // ack auto-derives harvestedBy from context; harvest historically required --as.
    const harvestedBy = sub === 'ack'
      ? inferDroppedBy(options)
      : readString(options, 'as', 'harvestedBy', 'agent');
    if (!feedbackId || !harvestedBy) {
      const usage = sub === 'ack'
        ? 'Usage: pd feedback ack <feedbackId> [--into <slug>]'
        : 'Usage: pd feedback harvest <feedbackId> --as <agentId> [--into <slug>]';
      ui.error(usage);
      process.exit(1);
    }
    const intoSlug = readString(options, 'into', 'intoSlug');
    const body: Record<string, unknown> = { harvestedBy };
    if (intoSlug) body.intoSlug = intoSlug;
    const { ok, data } = await postJson(`/feedback/${encodeURIComponent(feedbackId)}/harvest`, body);
    if (!ok) {
      ui.error(data.error || 'harvest failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.entry, null, 2));
      return;
    }
    console.log(`Harvested ${feedbackId}${intoSlug ? ` → ${intoSlug}` : ''} (by ${harvestedBy})`);
    return;
  }

  if (sub === 'summary') {
    const params = new URLSearchParams();
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    else {
      const project = inferProject(options);
      if (project) params.set('project', project);
    }
    const qs = params.toString();
    const { ok, data } = await getJson(`/feedback/summary${qs ? `?${qs}` : ''}`);
    if (!ok) {
      ui.error(data.error || 'summary failed');
      process.exit(1);
    }
    if (isJson(options)) {
      console.log(JSON.stringify(data.summary, null, 2));
      return;
    }
    const s = data.summary;
    console.log(`Feedback summary`);
    console.log(`  total:     ${s.total}`);
    console.log(`  open:      ${s.open}`);
    console.log(`  harvested: ${s.harvested}`);
    console.log(`  by severity: low=${s.bySeverity.low} medium=${s.bySeverity.medium} high=${s.bySeverity.high} critical=${s.bySeverity.critical}`);
    if (Object.keys(s.bySurface).length > 0) {
      console.log(`  by surface:`);
      for (const [surface, count] of Object.entries(s.bySurface)) {
        console.log(`    ${surface}: ${count}`);
      }
    }
    return;
  }

  ui.error(`Unknown feedback subcommand: ${sub}`);
  process.exit(1);
}
