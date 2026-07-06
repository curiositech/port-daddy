/**
 * Per-run Workers AI usage accounting for the cloud fleet.
 *
 * Every MAP and REDUCE `env.AI.run(...)` call returns a `usage` block. The
 * {@link UsageMeter} sums those tokens per model across a whole fleet run so the
 * run header (`fleet_runs`) can record real token + cost telemetry: `neurons`
 * (its long-reserved "total AI token spend" column), the input/output split, the
 * derived USD cost, and the distinct models used.
 *
 * Cost is summed per model at that model's rate (see {@link costForModel}), so a
 * fleet that mixes models prices each correctly. A model with no known rate
 * contributes tokens but not cost; `costUsd` is `null` only when NO model in the
 * run is priced (partial cost survives, matching the cost-accrual contract).
 */

import { costForModel } from './pricing.js';

/** The subset of the Workers AI response `usage` block we consume. */
export interface WorkersAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

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

/** One call's recorded token split (returned so callers can log it per step). */
export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
}

export class UsageMeter {
  private readonly perModel = new Map<string, { in: number; out: number }>();

  /**
   * Record one Workers AI call against a model. Tolerates an absent/partial
   * `usage` block (best-effort: a missing count is 0, never a guess). Returns
   * the per-call split so the caller can attach it to a transcript step.
   */
  record(model: string, usage: WorkersAiUsage | undefined): CallUsage {
    const inputTokens = Math.max(0, Math.round(Number(usage?.prompt_tokens ?? 0)) || 0);
    const outputTokens = Math.max(0, Math.round(Number(usage?.completion_tokens ?? 0)) || 0);
    const cur = this.perModel.get(model) ?? { in: 0, out: 0 };
    cur.in += inputTokens;
    cur.out += outputTokens;
    this.perModel.set(model, cur);
    return { inputTokens, outputTokens };
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
