/**
 * CLI — `pd arrive`
 *
 * What an agent should be told the moment it starts: salvageable work that
 * looks like this work, roadmap items it belongs under, skills for it, and the
 * agents already standing on the same files.
 *
 * Designed to be called from a session-start hook, so the contract is shaped
 * for that: it prints nothing and exits 0 when nothing matches. A session-start
 * surface that always prints something is one agents learn to skip, and the
 * block that finally matters scrolls past unread with the rest.
 */

import { pdFetch } from '../utils/fetch.js';
import { readCurrentContext } from '../utils/current-context.js';
import { CLIOptions, isJson, isQuiet } from '../types.js';

/**
 * Handle `pd arrive`.
 *
 * Fails soft on every path. This runs on the critical path of an agent's first
 * turn, so a daemon that is down, slow, or older than this command must cost
 * the agent nothing but the briefing itself — never an error in its face and
 * never a non-zero exit that a hook wrapper might treat as fatal.
 */
export async function handleArrive(options: CLIOptions): Promise<void> {
  const actor = (options.actor as string) || process.env.PD_ACTOR || '';
  if (!actor) {
    // Not an error: an unidentified session simply has no one to brief.
    if (isJson(options)) console.log(JSON.stringify({ success: true, briefing: null, reason: 'no actor' }));
    return;
  }

  // Prefer THIS session's purpose over anything the daemon would infer.
  //
  // The route already fills unsupplied fields from the actor's newest active
  // session (`ownSession()`), which is a good default but a guess: an agent
  // legitimately holds several sessions at once, and "newest" is not always
  // "the one I am in". `readCurrentContext()` reads the actual current session
  // from PD_SESSION_ID / the context file, so when it can answer, its answer is
  // better. When it cannot, the server-side derivation still applies.
  const current = (() => {
    try {
      return readCurrentContext();
    } catch {
      return null;
    }
  })();

  const params = new URLSearchParams({ actor });
  const purpose = (options.purpose as string) || current?.purpose || '';
  const project = (options.project as string) || '';
  const files = (options.files as string) || '';
  const hints = (options.hints as string) || '';
  if (purpose) params.set('purpose', purpose);
  if (project) params.set('project', project);
  if (files) params.set('files', files);
  if (hints) params.set('hints', hints);

  let data: Record<string, unknown>;
  try {
    const res = await pdFetch(`/briefing/arrival?${params.toString()}`);
    data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      if (isJson(options)) console.log(JSON.stringify({ success: false, error: data.error ?? 'request failed' }));
      return;
    }
  } catch (err) {
    // Daemon down or unreachable. Silence is the correct output.
    if (isJson(options)) {
      console.log(JSON.stringify({ success: false, error: (err as Error).message }));
    }
    return;
  }

  if (isJson(options)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const rendered = typeof data.rendered === 'string' ? data.rendered : '';
  if (!rendered) return; // Nothing matched — say nothing.
  if (isQuiet(options)) return;

  console.log(rendered);
}
