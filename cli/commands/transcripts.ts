/**
 * CLI Transcripts Commands — fleet ship-run conversation viewer.
 *
 * Subcommands:
 *   pd transcripts list                 List recent ship runs
 *   pd transcripts show <id>            Render a single transcript as a conversation
 *   pd transcripts watch                Live-tail new transcripts (SSE)
 *   pd transcripts cost [--since <dur>] Cost rollup by ship and day
 *   pd transcripts delete <id>          Delete a transcript (destructive — confirmed)
 */

import { pdFetch } from '../utils/fetch.js';
import { CLIOptions, isQuiet, isJson } from '../types.js';
import { IS_TTY, relativeTime } from '../utils/output.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';
import { promptConfirm } from '../utils/prompt.js';
import { resolvePublishedDaemonUrl } from '../../shared/daemon-discovery.js';
import type { DaemonPortDiscoveryOptions } from '../../shared/daemon-discovery.js';

/**
 * Strip terminal control sequences from DB-sourced strings before printing to a
 * TTY (CWE-150). Transcript fields (ship name, message content, tool names,
 * output summaries/urls) originate from agent/external input via the daemon, so
 * a malicious value could otherwise inject ANSI/OSC escapes — cursor moves,
 * title/clipboard rewrites, fake prompts. We drop C0/C1 control chars (keeping
 * TAB \t and LF \n, which the renderer handles) plus CSI/OSC escape sequences.
 * (JSON.stringify'd tool args/results are already safe — it escapes control
 * chars to \uXXXX — so only directly-interpolated strings need this.)
 */
export function clean(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC … BEL/ST
    .replace(/\x1b[@-_][0-?]*[ -/]*[@-~]/g, '')        // CSI + other escape seqs
    .replace(/\x1b./g, '')                              // stray ESC+char
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');          // C0 controls (keep \t,\n) + DEL
}

interface TranscriptListRow {
  id: string;
  ship: string;
  spawned_agent_id: string;
  trigger: string;
  backend: string;
  model: string;
  status: 'running' | 'completed' | 'failed' | 'killed';
  started_at: number;
  ended_at: number | null;
  cost_usd: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  pr_number: number | null;
  error: string | null;
}

interface TranscriptMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  tool_calls?: Array<{ name: string; args: unknown; result?: unknown }>;
}

interface TranscriptOutput {
  type: string;
  url?: string;
  summary: string;
}

interface TranscriptFull extends TranscriptListRow {
  messages: TranscriptMessage[];
  outputs: TranscriptOutput[];
}

function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] || 's').toLowerCase();
  const mult: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return n * (mult[unit] ?? 1000);
}

// =============================================================================
// pd transcripts (router)
// =============================================================================

export async function handleTranscripts(args: string[], options: CLIOptions): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case undefined:
    case 'list':
      return handleTranscriptsList(rest, options);
    case 'show':
      return handleTranscriptsShow(rest, options);
    case 'watch':
      return handleTranscriptsWatch(rest, options);
    case 'cost':
      return handleTranscriptsCost(rest, options);
    case 'delete':
    case 'rm':
      return handleTranscriptsDelete(rest, options);
    default:
      console.error(`Unknown subcommand: ${sub}`);
      console.error('Usage: pd transcripts <list|show|watch|cost|delete>');
      process.exit(1);
  }
}

// =============================================================================
// list
// =============================================================================

export async function handleTranscriptsList(args: string[], options: CLIOptions): Promise<void> {
  const params = new URLSearchParams();
  if (options.ship && typeof options.ship === 'string') params.set('ship', options.ship);
  if (options.pr) params.set('pr', String(options.pr));
  if (options.status && typeof options.status === 'string') params.set('status', options.status);
  if (options.since) {
    const ms = parseDuration(options.since);
    if (ms != null) params.set('since', String(Date.now() - ms));
  }
  const limit = options.limit ? parseInt(String(options.limit), 10) : 20;
  if (Number.isFinite(limit)) params.set('limit', String(limit));

  // Positional arg can also be a ship name
  if (args[0] && !params.has('ship')) params.set('ship', args[0]);

  const qs = params.toString();
  const res: PdFetchResponse = await pdFetch(`/transcripts${qs ? `?${qs}` : ''}`, { method: 'GET' });
  const data = await res.json();

  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to list transcripts');
    process.exit(1);
  }

  const rows = (data.transcripts || []) as TranscriptListRow[];

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (rows.length === 0) {
    if (!isQuiet(options)) console.error('No transcripts');
    return;
  }

  if (isQuiet(options)) {
    for (const r of rows) {
      console.log(`${clean(r.id)}\t${clean(r.ship)}\t${clean(r.status)}\t${clean(r.backend)}\t${(r.cost_usd ?? 0).toFixed(4)}`);
    }
    return;
  }

  console.error('');
  console.error(
    'ID'.padEnd(24) +
    'SHIP'.padEnd(20) +
    'STATUS'.padEnd(11) +
    'BACKEND'.padEnd(12) +
    'PR'.padEnd(8) +
    'COST'.padEnd(10) +
    'AGE'
  );
  console.error('─'.repeat(95));
  const nowTs = Date.now();
  for (const r of rows) {
    const age = relativeTime(nowTs - r.started_at);
    const cost = r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : '—';
    const pr = r.pr_number != null ? `#${r.pr_number}` : '—';
    console.error(
      clean(r.id).slice(0, 23).padEnd(24) +
      clean(r.ship).slice(0, 19).padEnd(20) +
      clean(r.status).padEnd(11) +
      clean(r.backend).slice(0, 11).padEnd(12) +
      pr.padEnd(8) +
      cost.padEnd(10) +
      age
    );
  }
  console.error('');
  console.error(`Total: ${rows.length} transcript(s)`);
  if (rows.length > 0) {
    console.error(`Open one: pd transcripts show ${rows[0].id}`);
  }
}

// =============================================================================
// show
// =============================================================================

export async function handleTranscriptsShow(args: string[], options: CLIOptions): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error('Usage: pd transcripts show <id>');
    process.exit(1);
  }

  const res: PdFetchResponse = await pdFetch(`/transcripts/${encodeURIComponent(id)}`, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to load transcript');
    process.exit(1);
  }

  const tx = data.transcript as TranscriptFull | undefined;
  if (!tx) {
    ui.error('No transcript in response');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(tx, null, 2));
    return;
  }

  const colorize = IS_TTY;
  const dim = (s: string): string => (colorize ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string): string => (colorize ? `\x1b[1m${s}\x1b[0m` : s);
  const cyan = (s: string): string => (colorize ? `\x1b[36m${s}\x1b[0m` : s);
  const green = (s: string): string => (colorize ? `\x1b[32m${s}\x1b[0m` : s);
  const yellow = (s: string): string => (colorize ? `\x1b[33m${s}\x1b[0m` : s);
  const red = (s: string): string => (colorize ? `\x1b[31m${s}\x1b[0m` : s);

  const statusColor = tx.status === 'completed' ? green : tx.status === 'failed' ? red : tx.status === 'killed' ? yellow : cyan;

  console.log(bold(`Transcript ${clean(tx.id)}`));
  console.log(dim(`  Ship:      `) + clean(tx.ship));
  console.log(dim(`  Status:    `) + statusColor(clean(tx.status)));
  console.log(dim(`  Trigger:   `) + clean(tx.trigger));
  console.log(dim(`  Backend:   `) + `${clean(tx.backend)} (${clean(tx.model)})`);
  console.log(dim(`  Agent ID:  `) + clean(tx.spawned_agent_id));
  console.log(dim(`  Started:   `) + new Date(tx.started_at).toISOString());
  if (tx.ended_at) {
    const dur = relativeTime(tx.ended_at - tx.started_at);
    console.log(dim(`  Ended:     `) + new Date(tx.ended_at).toISOString() + dim(` (took ${dur})`));
  }
  if (tx.pr_number != null) console.log(dim(`  PR:        `) + `#${tx.pr_number}`);
  if (tx.cost_usd != null) console.log(dim(`  Cost:      `) + `$${tx.cost_usd.toFixed(6)}`);
  if (tx.tokens_in != null || tx.tokens_out != null) {
    console.log(dim(`  Tokens:    `) + `in=${tx.tokens_in ?? 0}  out=${tx.tokens_out ?? 0}`);
  }
  if (tx.error) console.log(dim(`  Error:     `) + red(clean(tx.error)));

  console.log('');
  console.log(bold('── Conversation ──'));
  for (const m of tx.messages) {
    const ts = dim(`[${new Date(m.timestamp).toISOString().slice(11, 19)}]`);
    const label = m.role === 'system'
      ? yellow('system')
      : m.role === 'user'
        ? cyan('user')
        : m.role === 'assistant'
          ? green('assistant')
          : dim('tool');
    console.log('');
    console.log(`${ts} ${bold(label)}`);
    // Indent body 2 spaces; preserve newlines. Sanitize DB-sourced content.
    for (const line of clean(m.content || '').split('\n')) {
      console.log('  ' + line);
    }
    if (m.tool_calls && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        console.log(dim(`  ↳ tool: ${clean(tc.name)}`));
        try {
          const argsStr = JSON.stringify(tc.args, null, 2);
          for (const line of argsStr.split('\n')) console.log(dim('    ' + line));
        } catch { /* unprintable */ }
        if (tc.result !== undefined) {
          try {
            const resStr = JSON.stringify(tc.result, null, 2);
            console.log(dim('    ⇒'));
            for (const line of resStr.split('\n')) console.log(dim('      ' + line));
          } catch { /* unprintable */ }
        }
      }
    }
  }

  if (tx.outputs && tx.outputs.length > 0) {
    console.log('');
    console.log(bold('── Outputs ──'));
    for (const o of tx.outputs) {
      const url = o.url ? dim(`  ${clean(o.url)}`) : '';
      console.log(`  ${yellow(`[${clean(o.type)}]`)} ${clean(o.summary)}${url}`);
    }
  }
  console.log('');
}

// =============================================================================
// watch
// =============================================================================

/**
 * Resolve the transcript SSE endpoint from explicit or actually published TCP
 * state. The caller invokes this inside its reconnect loop so a watcher started
 * before the daemon can recover without manufacturing the preferred port.
 */
export function resolveTranscriptStreamUrl(
  explicitUrl = process.env.PORT_DADDY_URL,
  discovery: DaemonPortDiscoveryOptions = {},
): string {
  return new URL('/transcripts/stream', resolvePublishedDaemonUrl(explicitUrl, discovery)).toString();
}

export async function handleTranscriptsWatch(_args: string[], options: CLIOptions): Promise<void> {
  if (IS_TTY && !isQuiet(options)) {
    ui.info('Tailing new transcripts; waiting for the published daemon endpoint.');
    console.error('  Press Ctrl+C to stop');
    console.error('');
  }

  let buf = '';
  let abort = false;
  const ctrl = new AbortController();

  function handleSignal(): void {
    abort = true;
    ctrl.abort();
    if (!isQuiet(options) && IS_TTY) {
      console.error('');
      ui.warn('Watch stopped');
    }
    process.exit(0);
  }
  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  // Reconnect loop with exponential backoff
  let backoff = 1000;
  let announcedUrl: string | null = null;
  while (!abort) {
    try {
      const url = resolveTranscriptStreamUrl();
      if (IS_TTY && !isQuiet(options) && announcedUrl !== url) {
        ui.info(`Transcript stream target resolved to ${url}`);
        announcedUrl = url;
      }
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/event-stream' } });
      if (!res.ok || !res.body) {
        if (!isQuiet(options)) ui.warn(`Stream returned status ${res.status}; retrying in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(30000, backoff * 2);
        continue;
      }
      backoff = 1000;
      const reader = (res.body as unknown as NodeJS.ReadableStream)[Symbol.asyncIterator]
        ? (res.body as unknown as NodeJS.ReadableStream)
        : null;
      if (!reader) {
        if (!isQuiet(options)) ui.warn('Stream body not iterable; falling back to poll');
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      for await (const chunk of reader) {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataStr = '';
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
            else if (line.startsWith(':')) { /* comment / heartbeat */ }
          }
          if (!dataStr) continue;
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataStr); } catch { continue; }
          renderEvent(event, payload, options);
        }
      }
    } catch (err) {
      if (abort) return;
      if (!isQuiet(options)) ui.warn(`Stream error: ${(err as Error).message}; retrying in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(30000, backoff * 2);
    }
  }
}

function renderEvent(event: string, payload: Record<string, unknown>, options: CLIOptions): void {
  if (isJson(options)) {
    console.log(JSON.stringify({ event, payload }));
    return;
  }
  const ts = new Date().toISOString().slice(11, 19);
  switch (event) {
    case 'connected':
      console.error(`[${ts}] connected to fleet:transcript-stream`);
      return;
    case 'start':
      console.error(`[${ts}] START   ${clean(payload.ship)}/${clean(payload.id)}  ${clean(payload.backend)}  ${clean(payload.trigger)}`);
      return;
    case 'update':
      console.error(`[${ts}] UPDATE  ${clean(payload.ship)}/${clean(payload.id)}  status=${clean(payload.status)}`);
      return;
    case 'end': {
      const cost = payload.cost_usd != null ? `$${(payload.cost_usd as number).toFixed(4)}` : '—';
      console.error(`[${ts}] END     ${clean(payload.ship)}/${clean(payload.id)}  status=${clean(payload.status)}  cost=${cost}`);
      return;
    }
    default:
      console.error(`[${ts}] ${event} ${JSON.stringify(payload)}`);
  }
}

// =============================================================================
// cost
// =============================================================================

interface CostRollupResponse {
  since: number;
  until: number;
  total_runs: number;
  total_cost_usd: number;
  total_tokens_in: number;
  total_tokens_out: number;
  by_ship: Array<{ ship: string; runs: number; cost_usd: number }>;
  by_day: Array<{ bucket: string; ship: string; runs: number; cost_usd: number; tokens_in: number; tokens_out: number }>;
}

export async function handleTranscriptsCost(_args: string[], options: CLIOptions): Promise<void> {
  const sinceArg = options.since && typeof options.since === 'string' ? options.since : '1d';
  const ms = parseDuration(sinceArg) ?? 24 * 60 * 60 * 1000;
  const since = Date.now() - ms;
  const params = new URLSearchParams({ since: String(since) });

  const res: PdFetchResponse = await pdFetch(`/transcripts/cost?${params.toString()}`, { method: 'GET' });
  const data = await res.json();
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to fetch cost rollup');
    process.exit(1);
  }

  const rollup = data as unknown as CostRollupResponse;

  if (isJson(options)) {
    console.log(JSON.stringify(rollup, null, 2));
    return;
  }

  if (isQuiet(options)) {
    for (const s of rollup.by_ship) {
      console.log(`${clean(s.ship)}\t${s.runs}\t${s.cost_usd.toFixed(6)}`);
    }
    return;
  }

  console.error('');
  console.error(`Cost rollup — since ${new Date(rollup.since).toISOString()}`);
  console.error('─'.repeat(60));
  console.error(`Total runs:        ${rollup.total_runs}`);
  console.error(`Total cost:        $${rollup.total_cost_usd.toFixed(6)}`);
  console.error(`Total tokens in:   ${rollup.total_tokens_in}`);
  console.error(`Total tokens out:  ${rollup.total_tokens_out}`);
  console.error('');
  console.error('By ship:');
  console.error('  SHIP'.padEnd(28) + 'RUNS'.padEnd(8) + 'COST');
  for (const s of rollup.by_ship) {
    console.error('  ' + clean(s.ship).padEnd(26) + String(s.runs).padEnd(8) + `$${s.cost_usd.toFixed(6)}`);
  }
  if (rollup.by_day && rollup.by_day.length > 0) {
    console.error('');
    console.error('By day:');
    console.error('  DAY'.padEnd(14) + 'SHIP'.padEnd(24) + 'RUNS'.padEnd(8) + 'COST');
    for (const d of rollup.by_day) {
      console.error('  ' + clean(d.bucket).padEnd(12) + clean(d.ship).padEnd(24) + String(d.runs).padEnd(8) + `$${d.cost_usd.toFixed(6)}`);
    }
  }
  console.error('');
}

// =============================================================================
// delete
// =============================================================================

export async function handleTranscriptsDelete(args: string[], options: CLIOptions): Promise<void> {
  const id = args[0];
  if (!id) {
    console.error('Usage: pd transcripts delete <id>');
    process.exit(1);
  }

  const forced = !!options.yes || !!options.force;
  if (!forced) {
    if (!IS_TTY) {
      ui.error('pd transcripts delete is destructive. Pass --yes to confirm in non-TTY mode.');
      process.exit(1);
    }
    const ok = await promptConfirm(`Delete transcript ${id}? This cannot be undone.`, false);
    if (!ok) {
      if (!isQuiet(options)) ui.warn('Aborted');
      return;
    }
  }

  const res: PdFetchResponse = await pdFetch(`/transcripts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) {
    ui.error((data.error as string) || 'Failed to delete transcript');
    process.exit(1);
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!isQuiet(options)) ui.success(`Deleted transcript ${id}`);
}
