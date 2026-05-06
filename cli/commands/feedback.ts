/**
 * Feedback CLI — `pd feedback drop|list|show|harvest|summary`
 *
 * Thin wrapper around `/feedback/*` HTTP endpoints. Lets agents and
 * humans drop structured findings without writing markdown files. The
 * feedback stream is what cartographer harvests into the roadmap.
 */

import { CLIOptions, isJson, isQuiet } from '../types.js';
import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { loadFleetConfig } from '../../lib/fleet-engine.js';

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
  if (entry.suggested) console.log(`     suggest: ${entry.suggested}`);
  console.log(`     id=${entry.feedbackId.slice(0, 8)}  by=${entry.droppedBy}  source=${entry.source}`);
}

export async function handleFeedback(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(`Usage:
  pd feedback drop --slug <name> --summary <text> --as <agentId> [--severity low|medium|high|critical]
                   [--surface CLI|API|MCP|...] [--source agent|human|mcp|cli] [--hook <text>]
                   [--suggest <text>] [--project <slug>] [--harbor <h>]
  pd feedback list [--severity ...] [--surface ...] [--status open|harvested|all] [--limit N] [--project <slug>] [--harbor <h>]
  pd feedback show <feedbackId>
  pd feedback harvest <feedbackId> --as <agentId> [--into <roadmap-slug>]
  pd feedback summary [--project <slug>] [--harbor <h>]
`);
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
    if (surface) body.surface = surface;
    const severity = readString(options, 'severity');
    if (severity) body.severity = severity;
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
    return;
  }

  if (sub === 'list') {
    const params = new URLSearchParams();
    const harbor = readString(options, 'harbor');
    if (harbor) params.set('harbor', harbor);
    else {
      const project = inferProject(options);
      if (project) params.set('project', project);
    }
    const severity = readString(options, 'severity');
    if (severity) params.set('severity', severity);
    const surface = readString(options, 'surface');
    if (surface) params.set('surface', surface);
    const status = readString(options, 'status');
    if (status) params.set('status', status);
    const limit = readNumber(options, 'limit');
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    const { ok, data } = await getJson(`/feedback${qs ? `?${qs}` : ''}`);
    if (!ok) {
      ui.error(data.error || 'list failed');
      process.exit(1);
    }
    const entries: FeedbackEntry[] = data.entries ?? [];
    if (isJson(options)) {
      console.log(JSON.stringify(entries, null, 2));
      return;
    }
    if (isQuiet(options)) {
      for (const e of entries) console.log(e.feedbackId);
      return;
    }
    console.log(`${entries.length} entry(ies)`);
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

  if (sub === 'harvest') {
    const feedbackId = args[1] || readString(options, 'id');
    const harvestedBy = readString(options, 'as', 'harvestedBy', 'agent');
    if (!feedbackId || !harvestedBy) {
      ui.error('Usage: pd feedback harvest <feedbackId> --as <agentId> [--into <roadmap-slug>]');
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
    console.log(`Harvested ${feedbackId}${intoSlug ? ` → ${intoSlug}` : ''}`);
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
