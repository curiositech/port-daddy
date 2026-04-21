/**
 * CLI `pd say` — the consolidated write verb
 *
 * PD has many write primitives (notes, tuples, pheromones, inbox, pub/sub).
 * Operators shouldn't need to learn which one to pick per message. `pd say`
 * is the one verb that fans out based on flags:
 *
 *   pd say "fixed auth bug"                               → note (session audit)
 *   pd say "fixed auth bug" --pin                         → note + tuple (cross-session)
 *   pd say "fixed auth bug" --heat src/auth.ts=0.8        → note + pheromone
 *   pd say "fixed auth bug" --broadcast alerts            → note + pub/sub
 *   pd say "fixed auth bug" --pin --heat src/auth.ts=0.8  → all three
 *
 * The flags compose. A single `pd say` is zero-to-four HTTP calls, executed
 * in parallel. If any single fanout fails, the others still land and the
 * command reports the partial failure — coordination beats atomicity here.
 *
 * WHY: The old pattern was `pd note "X"; pd tuple out …; pd pheromone spray
 * files X heat 0.6; pd pub alerts "X"` — four commands, four shell escapes,
 * four chances to drift. One `pd say` removes that drift.
 *
 * DESIGN: This command has NO --dm flag in 3.8.4 because the agent-directory
 * and inbox-targeting surfaces are under active development (session
 * 2471d576). Once that lands, `pd say "X" --dm <agent>` will add a fifth
 * fanout to `/agents/:id/inbox`.
 *
 * @example
 *   # Finished a fix — broadcast to all current sessions:
 *   pd say "flash of unstyled content on hydrate — fixed in Hero.tsx" \
 *     --pin --heat website-v2/src/components/landing/Hero.tsx=0.7
 *
 *   # Alert channel (fire-and-forget):
 *   pd say "build broken on main — rolling back" --broadcast alerts
 */

import { pdFetch, PORT_DADDY_URL } from '../utils/fetch.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';
import type { PdFetchResponse } from '../utils/fetch.js';
import * as ui from '../utils/ui.js';

interface FanoutResult {
  target: string;
  ok: boolean;
  detail?: string;
  error?: string;
}

async function writeNote(text: string): Promise<FanoutResult> {
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    const data = await res.json();
    if (res.ok) {
      return { target: 'note', ok: true, detail: `session=${(data.sessionId as string) || '?'}` };
    }
    return { target: 'note', ok: false, error: (data.error as string) || `HTTP ${res.status}` };
  } catch (e) {
    return { target: 'note', ok: false, error: (e as Error).message };
  }
}

async function writeTuple(
  text: string,
  kind: string,
  harbor: string,
  asAgent: string | undefined,
): Promise<FanoutResult> {
  try {
    const slug = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const tuple = [kind, slug, { text, at: Date.now() }];
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/tuples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tuple, harbor, writtenBy: asAgent }),
    });
    const data = await res.json();
    if (res.ok) {
      return { target: 'tuple', ok: true, detail: `harbor=${harbor} kind=${kind}` };
    }
    return { target: 'tuple', ok: false, error: (data.error as string) || `HTTP ${res.status}` };
  } catch (e) {
    return { target: 'tuple', ok: false, error: (e as Error).message };
  }
}

/**
 * Parse `--heat <path>[=strength]` into {path, strength}.
 * Default strength 0.6 — a meaningful-but-not-dominant signal.
 */
function parseHeat(spec: string): { path: string; strength: number } | null {
  const eq = spec.indexOf('=');
  if (eq === -1) return { path: spec, strength: 0.6 };
  const path = spec.slice(0, eq);
  const strengthStr = spec.slice(eq + 1);
  const strength = parseFloat(strengthStr);
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) return null;
  return { path, strength };
}

async function sprayHeat(spec: string): Promise<FanoutResult> {
  const parsed = parseHeat(spec);
  if (!parsed) {
    return { target: 'pheromone', ok: false, error: `Invalid --heat value: ${spec} (expected <path>[=0..1])` };
  }
  try {
    const res: PdFetchResponse = await pdFetch(`${PORT_DADDY_URL}/pheromone/spray`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: 'files', id: parsed.path, key: 'heat', strength: parsed.strength }),
    });
    const data = await res.json();
    if (res.ok) {
      return { target: 'pheromone', ok: true, detail: `files/${parsed.path}=${parsed.strength}` };
    }
    return { target: 'pheromone', ok: false, error: (data.error as string) || `HTTP ${res.status}` };
  } catch (e) {
    return { target: 'pheromone', ok: false, error: (e as Error).message };
  }
}

async function publishChannel(channel: string, text: string, sender: string | undefined): Promise<FanoutResult> {
  try {
    const body: Record<string, unknown> = { payload: text };
    if (sender) body.sender = sender;
    const res: PdFetchResponse = await pdFetch(
      `${PORT_DADDY_URL}/msg/${encodeURIComponent(channel)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json();
    if (res.ok) {
      return { target: 'broadcast', ok: true, detail: `channel=${channel}` };
    }
    return { target: 'broadcast', ok: false, error: (data.error as string) || `HTTP ${res.status}` };
  } catch (e) {
    return { target: 'broadcast', ok: false, error: (e as Error).message };
  }
}

/**
 * Handle `pd say <text> [flags]` — the consolidated write verb.
 *
 * Fanout is parallel (Promise.all); all targets complete before reporting.
 * Exit code is 0 if the note landed, 1 if ALL fanouts failed. Partial
 * failures are reported but still exit 0 — the note is the anchor.
 */
export async function handleSay(text: string | undefined, options: CLIOptions): Promise<void> {
  if (!text || typeof text !== 'string') {
    ui.error('Usage: pd say "<text>" [--pin] [--heat <path>[=N]] [--broadcast <channel>]');
    process.exit(1);
  }

  const asAgent = options.as as string | undefined;
  const harbor = (options.harbor as string) || 'fleet';
  const kind = (options.kind as string) || 'finding';

  // Build fanout list based on flags (note always fires).
  const tasks: Promise<FanoutResult>[] = [writeNote(text)];

  if (options.pin) {
    tasks.push(writeTuple(text, kind, harbor, asAgent));
  }
  if (options.heat) {
    const heatSpec = options.heat as string;
    tasks.push(sprayHeat(heatSpec));
  }
  if (options.broadcast) {
    const channel = options.broadcast as string;
    tasks.push(publishChannel(channel, text, asAgent));
  }

  const results = await Promise.all(tasks);

  if (isJson(options)) {
    console.log(JSON.stringify({ success: results.every((r) => r.ok), text, results }, null, 2));
    return;
  }

  if (isQuiet(options)) {
    console.log(results.every((r) => r.ok) ? 'ok' : 'partial');
    return;
  }

  for (const r of results) {
    if (r.ok) {
      ui.success(`${r.target.padEnd(10)} ${r.detail || ''}`);
    } else {
      ui.error(`${r.target.padEnd(10)} ${r.error || 'failed'}`);
    }
  }

  const noteOk = results[0]?.ok === true;
  if (!noteOk && results.every((r) => !r.ok)) {
    process.exit(1);
  }
}
