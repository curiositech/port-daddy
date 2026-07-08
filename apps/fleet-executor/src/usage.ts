/**
 * Per-run Workers AI usage accounting for the cloud fleet — the RELAY sink.
 *
 * The executor already extracts each ship's token usage into a ShipMetrics
 * (see execute.ts `accumulateUsage` / `extractWorkersAiUsage`) and emits it to
 * the DAEMON via `emitCloudTelemetry` (the FleetBar/`/metrics/cost` path). This
 * meter is the second, RELAY sink: after each ship completes, its per-ship
 * totals are folded in here, and at run end the summary is written onto the
 * relay's `fleet_runs` row (`input_tokens`/`output_tokens`/`neurons`/`cost_usd`/
 * `models_csv`). That makes cost/tokens/model durable on the Cloudflare relay
 * fabric — the pd-console / `/v1/fleet/*` Cloud Fleet surface — not only on the
 * daemon.
 *
 * One extraction, two sinks: we do NOT re-read `res.usage` here — we accept the
 * already-extracted per-ship counts, so the relay and daemon figures agree.
 *
 * Cost is summed per model at that model's rate ({@link costForModel}); a model
 * with no known rate contributes tokens but not cost, and `costUsd` is null only
 * when NO model in the run is priced (partial cost survives).
 */

import { costForModel } from './pricing.js';

/** Finalized per-run usage summary written onto the fleet_runs row. */
export interface RunUsageSummary {
  /** Summed prompt tokens across every ship/call in the run. */
  inputTokens: number;
  /** Summed completion tokens across every ship/call in the run. */
  outputTokens: number;
  /** input + output — the value written to the `neurons` column. */
  totalTokens: number;
  /** Derived USD cost, or null when no model in the run has a known rate. */
  costUsd: number | null;
  /** Distinct Workers AI model ids used, sorted + comma-separated. */
  modelsCsv: string;
}

export class UsageMeter {
  private readonly perModel = new Map<string, { in: number; out: number }>();

  /**
   * Fold one ship's already-extracted token totals (its ShipMetrics, covering
   * that ship's MAP + REDUCE calls) into the run under the model it ran on.
   * Tolerates negatives/NaN defensively (a bad count is clamped to 0, never a
   * guess).
   */
  add(model: string, inputTokens: number, outputTokens: number): void {
    const inTok = Math.max(0, Math.round(Number(inputTokens) || 0));
    const outTok = Math.max(0, Math.round(Number(outputTokens) || 0));
    if (!model) return;
    const cur = this.perModel.get(model) ?? { in: 0, out: 0 };
    cur.in += inTok;
    cur.out += outTok;
    this.perModel.set(model, cur);
  }

  /** Finalize the run's usage into the row-writable summary. */
  summary(): RunUsageSummary {
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    let anyPriced = false;
    for (const [model, t] of this.perModel) {
      inputTokens += t.in;
      outputTokens += t.out;
      const c = costForModel(model, t.in, t.out);
      if (c !== null) {
        cost += c;
        anyPriced = true;
      }
    }
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: anyPriced ? Math.round(cost * 1e6) / 1e6 : null,
      modelsCsv: [...this.perModel.keys()].sort().join(','),
    };
  }
}
