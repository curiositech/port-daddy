/**
 * Envelope builder + forwarder for the GitHub webhook receiver.
 *
 * The Worker normalizes raw GitHub webhook payloads into a stable envelope
 * shape and POSTs it to the operator's Port Daddy daemon (or its
 * publicly-reachable tunnel). The daemon's fleet engine subscribes to
 * `github:webhook:<event>` channels via the existing `/msg/:channel`
 * routes and dispatches the relevant ships.
 *
 * This module is exported separately so the daemon-side receiver can
 * import the same types when consuming envelopes from a tube.
 */

export interface WebhookEnvelope {
  /** ISO-8601 timestamp the Worker stamped on receipt. */
  received_at: string;
  /** GitHub event name from X-GitHub-Event (e.g. "pull_request"). */
  event: string;
  /** GitHub delivery UUID from X-GitHub-Delivery. */
  delivery: string;
  /** Suggested PD tube channel: `github:webhook:<event>`. */
  channel: string;
  /** Top-level action field from the payload, if present. */
  action: string | null;
  /** Owner/name of the affected repository, if present. */
  repository: { full_name: string; id: number | null } | null;
  /** GitHub App installation id, if present. */
  installation_id: number | null;
  /** Sender login + id, if present. */
  sender: { login: string; id: number | null } | null;
  /** Raw GitHub payload, untouched. */
  payload: Record<string, unknown>;
}

interface BuildEnvelopeArgs {
  event: string;
  delivery: string;
  payload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function buildEnvelope(args: BuildEnvelopeArgs): WebhookEnvelope {
  const { event, delivery, payload } = args;

  const repoObj = asRecord(payload.repository);
  const repository = repoObj
    ? {
        full_name: asString(repoObj.full_name) ?? '',
        id: asNumber(repoObj.id),
      }
    : null;

  const installationObj = asRecord(payload.installation);
  const installation_id = installationObj ? asNumber(installationObj.id) : null;

  const senderObj = asRecord(payload.sender);
  const sender = senderObj
    ? {
        login: asString(senderObj.login) ?? '',
        id: asNumber(senderObj.id),
      }
    : null;

  return {
    received_at: new Date().toISOString(),
    event,
    delivery,
    channel: `github:webhook:${event}`,
    action: asString(payload.action),
    repository,
    installation_id,
    sender,
    payload,
  };
}

export interface ForwardOptions {
  url: string;
  authToken?: string;
  timeoutMs: number;
  fetcher: typeof fetch;
}

export interface ForwardResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Forward the envelope to the operator's daemon URL.
 *
 * Default semantics: a single POST with JSON body and 8s timeout.
 * The daemon (or the smee.io / cloudflared tunnel in front of it) is
 * expected to accept POST and return any 2xx. Anything else is a
 * forward failure and the caller surfaces 502 to GitHub so the App
 * redelivery queue retries naturally.
 */
export async function forwardEnvelope(
  envelope: WebhookEnvelope,
  opts: ForwardOptions,
): Promise<ForwardResult> {
  const { url, authToken, timeoutMs, fetcher } = opts;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-pd-webhook-event': envelope.event,
    'x-pd-webhook-delivery': envelope.delivery,
    'x-pd-webhook-channel': envelope.channel,
  };
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `daemon returned ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
