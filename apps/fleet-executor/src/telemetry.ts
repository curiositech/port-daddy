/**
 * Port Daddy cloud telemetry for the fleet executor.
 *
 * When PORT_DADDY_TELEMETRY_URL is configured, the executor mirrors per-ship
 * cost + failure activity back to the Port Daddy daemon (or its public tunnel) at
 * POST /telemetry/cloud-app. That feeds `lib/cloud-app-telemetry.ts` → the
 * daemon's `GET /metrics/cost` → FleetBar's cost panel, AND the `errorEvents` /
 * `draining` aggregations that surface a degraded cloud run to the operator.
 *
 * The old github-app-receiver emitted this; the fleet-executor never did, so the
 * FleetBar cost panel went dark and cloud ship failures reached no operator
 * surface. Ported here (self-contained — no Node deps, Workers-safe).
 *
 * TRANSPORT SEAM: today this is a direct HTTP POST to the daemon URL — the only
 * cross-cloud transport that actually works (the pd-relay is built + ADR-accepted
 * but not deployed/consumed; see ADR-0098). When the relay ships, this one
 * function moves onto `/v1/publish` without touching its call sites.
 */

export interface PortDaddyTelemetryEnv {
  PORT_DADDY_TELEMETRY_URL?: string;
  PORT_DADDY_TELEMETRY_TOKEN?: string;
  PORT_DADDY_TELEMETRY_TIMEOUT_MS?: string;
}

export interface CloudAppTelemetryPayload {
  id?: string;
  timestamp?: number;
  source?: string;
  provider?: string;
  appSlug?: string | null;
  deliveryId?: string | null;
  event?: string;
  action?: string | null;
  owner?: string | null;
  repo?: string | null;
  prNumber?: number | null;
  sha?: string | null;
  ship?: string | null;
  role?: string | null;
  status?: string;
  conclusion?: string | null;
  backend?: string | null;
  model?: string | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  costIsEstimate?: boolean | null;
  commentUrl?: string | null;
  checkRunId?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface TelemetryEmitResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}

function parseTimeout(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 15_000) : 3_000;
}

/**
 * Emit one telemetry event. Best-effort by contract: an unconfigured URL is a
 * clean `{ ok: true, skipped: true }` no-op, and any transport failure returns
 * `{ ok: false }` WITHOUT throwing — telemetry must never destabilize a fleet run
 * or change a merge gate.
 */
export async function emitCloudTelemetry(
  payload: CloudAppTelemetryPayload,
  env: PortDaddyTelemetryEnv,
  fetcher: typeof fetch = fetch,
): Promise<TelemetryEmitResult> {
  const url = env.PORT_DADDY_TELEMETRY_URL?.trim();
  if (!url) return { ok: true, skipped: true };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = env.PORT_DADDY_TELEMETRY_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), parseTimeout(env.PORT_DADDY_TELEMETRY_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'fleet-executor',
        provider: 'github',
        appSlug: 'port-daddy-fleet',
        ...payload,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, status: response.status, error: `telemetry returned ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTokenCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value >= 0 ? Math.round(value) : undefined;
}

/**
 * Pull token counts out of a Workers AI `ai.run` result's `usage` object. Reads
 * both the standard (`prompt_tokens`/`completion_tokens`) and Responses-API
 * (`input_tokens`/`output_tokens`) shapes, plus cached-input tokens where the
 * model reports them (prefix-cached tokens bill lower — see the cost table).
 */
export function extractWorkersAiUsage(result: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
} {
  const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const usage =
    record.usage && typeof record.usage === 'object' ? (record.usage as Record<string, unknown>) : {};
  const details =
    usage.prompt_tokens_details && typeof usage.prompt_tokens_details === 'object'
      ? (usage.prompt_tokens_details as Record<string, unknown>)
      : {};
  return {
    inputTokens: normalizeTokenCount(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: normalizeTokenCount(usage.completion_tokens ?? usage.output_tokens),
    cachedInputTokens: normalizeTokenCount(usage.cached_tokens ?? details.cached_tokens),
  };
}
