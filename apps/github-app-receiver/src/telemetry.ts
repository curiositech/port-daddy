/**
 * Optional Port Daddy telemetry emission for the cloud GitHub App receiver.
 *
 * The Worker can run completely standalone. When PORT_DADDY_TELEMETRY_URL is
 * configured, it mirrors webhook/check/ship activity back to a Port Daddy daemon
 * or public tunnel at POST /telemetry/cloud-app.
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

function normalizeUrl(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed;
}

export async function emitCloudTelemetry(
  payload: CloudAppTelemetryPayload,
  env: PortDaddyTelemetryEnv,
  fetcher: typeof fetch = fetch,
): Promise<TelemetryEmitResult> {
  const url = normalizeUrl(env.PORT_DADDY_TELEMETRY_URL);
  if (!url) return { ok: true, skipped: true };

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const token = env.PORT_DADDY_TELEMETRY_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), parseTimeout(env.PORT_DADDY_TELEMETRY_TIMEOUT_MS));
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'github-app-receiver',
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

export function extractWorkersAiUsage(result: unknown): { inputTokens?: number; outputTokens?: number } {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const usage = record.usage && typeof record.usage === 'object'
    ? record.usage as Record<string, unknown>
    : {};
  return {
    inputTokens: normalizeTokenCount(usage.prompt_tokens ?? usage.input_tokens),
    outputTokens: normalizeTokenCount(usage.completion_tokens ?? usage.output_tokens),
  };
}
