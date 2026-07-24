/**
 * Capability-URL builder for the human-facing fleet run page (ADR-0101 Phase 0).
 *
 * The relay serves GET /fleet/runs/:id as HTML, gated by an HMAC token derived
 * from the run id. GitHub's own repo ACL decides who ever *sees* the link (it
 * is only surfaced as the check run's details_url), and the HMAC makes the
 * page unguessable even though run ids are deterministic (`run:<deliveryId>`).
 *
 * Both env values are optional: unset ⇒ no details_url on check runs (the
 * pre-ADR-0101 behavior). The secret MUST match the relay's RUN_PAGE_SECRET.
 */

export interface RunPageEnv {
  /** Public base URL of the relay, e.g. "https://relay.example.workers.dev". */
  RUN_DETAILS_BASE_URL?: string;
  /** Shared HMAC secret; must equal the relay's RUN_PAGE_SECRET. */
  RUN_PAGE_SECRET?: string;
}

/** hex(HMAC-SHA256(secret, runId)) — the run page capability token. */
export async function runPageToken(secret: string, runId: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(runId));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Full details_url for a run, or null when the feature is unconfigured.
 * Never throws: a misconfigured secret must not fail the merge gate.
 */
export async function runDetailsUrl(env: RunPageEnv, runId: string): Promise<string | null> {
  const base = env.RUN_DETAILS_BASE_URL?.replace(/\/+$/, '');
  const secret = env.RUN_PAGE_SECRET;
  if (!base || !secret || secret.length < 32) return null;
  try {
    const token = await runPageToken(secret, runId);
    // Versioned token (ADR-0101 Z1): the `v1.` prefix lets the relay rotate the
    // signing secret without breaking previously-stamped links. The relay
    // accepts both `v1.<hmac>` and the legacy bare `<hmac>` during the grace
    // window.
    return `${base}/fleet/runs/${encodeURIComponent(runId)}?t=v1.${token}`;
  } catch {
    return null;
  }
}
