/**
 * HITL interruptions — fire-and-forget escalation of BLOCKING degradations to
 * a real human (docs/hitl-interruptions.md; relay: apps/relay/src/interruptions.ts).
 *
 * When a ship hits a wall only an operator can move — the GitHub App lacks
 * `contents: write` (403 on stacking), or `blockWithoutSandbox` forces a BLOCK
 * because no sandbox binding exists — it does not guess and does not fail
 * silently: it files an OPERATOR INTERRUPTION on the relay. The relay's
 * decay/nag engine then pages the operator on a full-jitter backoff schedule
 * until the ask is answered, acked, or expires.
 *
 * TRANSPORT: one POST to `env.INTERRUPTIONS_URL` (the relay's
 * POST /v1/interruptions) with `Authorization: Bearer <env.INTERRUPTIONS_TOKEN>`
 * (a pdu_ personal access token minted by the operator via the device flow —
 * the interruption lands scoped to THAT operator's account).
 *
 * CONTRACT (hard — mirrors src/squid-events.ts):
 *   - BOTH env vars unset/empty ⇒ feature silently disabled, zero fetches.
 *   - NEVER throws. NEVER awaited by callers. NEVER blocks or changes a run,
 *     a verdict, or the merge gate. A lost escalation is a lost escalation —
 *     the run's own transcript still records the degradation honestly.
 *   - The relay enforces the creation rate limit (≤5/h per source agent) and
 *     collapses excess into the newest open ask, so a looping ship cannot
 *     nag-bomb its operator even if it calls this every run.
 */

export type InterruptionUrgency = 'low' | 'normal' | 'high' | 'critical';

export interface InterruptionAsk {
  /** Short human headline, ≤200 chars (relay-enforced). */
  title: string;
  /** What happened + what the operator must do, ≤4000 chars. */
  body: string;
  urgency: InterruptionUrgency;
  /** e.g. 'fleet-executor/purser' — the relay's rate-limit key. */
  sourceAgent: string;
  /** Run id (`run:<deliveryId>`) so the ask links back to its transcript. */
  sourceSession?: string;
  /** GitHub App installation the degradation occurred under. */
  installationId?: number;
}

/** The minimal env surface needed (both fields optional ⇒ disabled). */
export interface InterruptionEnv {
  INTERRUPTIONS_URL?: string;
  INTERRUPTIONS_TOKEN?: string;
}

/**
 * File one interruption. Fire-and-forget by design: the fetch is started but
 * never awaited, every rejection is swallowed, and any synchronous failure
 * (bad URL, serialization) is caught. Returns nothing.
 */
export function emitInterruption(env: InterruptionEnv, ask: InterruptionAsk): void {
  const url = env.INTERRUPTIONS_URL;
  const token = env.INTERRUPTIONS_TOKEN;
  if (!url || !token) return; // feature disabled — silently, no fetch

  try {
    const body = JSON.stringify({
      title: ask.title,
      body: ask.body,
      urgency: ask.urgency,
      source_agent: ask.sourceAgent,
      ...(ask.sourceSession ? { source_session: ask.sourceSession } : {}),
      ...(typeof ask.installationId === 'number' ? { installation_id: ask.installationId } : {}),
    });
    void fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    }).catch(() => undefined);
  } catch {
    // Never let an escalation disturb the run.
  }
}
