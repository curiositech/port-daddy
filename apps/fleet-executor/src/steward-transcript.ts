/**
 * Transcript recorder for the steward's cron sweep.
 *
 * MOTIVATION: the executor's own `Transcript` (src/execute.ts) is bound to a
 * FleetRunJob — it takes a delivery-derived run id and writes a `fleet_runs`
 * header alongside its steps. A cron sweep has no delivery and no PR of its
 * own, so reusing that class would mean inventing a fake job just to satisfy a
 * constructor. This is the same append-only `fleet_run_steps` writer with a
 * synthetic sweep id instead.
 *
 * DESIGN — the audit trail is the product. The steward's most important output
 * is not a merge; it is the record of every refusal, with the code and the
 * reason. An operator asking "why has this PR not landed?" must be able to read
 * the answer rather than re-derive it. So every pass writes a step whether or
 * not anything happened.
 *
 * Best-effort by construction: a missing or failing D1 binding degrades to
 * console logging and NEVER changes what the steward does. An audit failure
 * must not become a merge failure — nor, more importantly, a merge.
 */

/**
 * Append-only step recorder scoped to one steward sweep.
 *
 * Structurally compatible with the `TranscriptLike` shape the ships use
 * (src/purser.ts), so the steward can be driven by either recorder in tests.
 */
export class StewardSweepTranscript {
  private seq = 0;
  private readonly runId: string;

  /**
   * @param db Relay D1 binding; `undefined` degrades to console-only logging.
   * @param now Epoch ms used to derive the sweep id, injectable for tests.
   */
  constructor(
    private readonly db: D1Database | undefined,
    now: number = Date.now(),
  ) {
    // Sweep ids are time-derived rather than random so consecutive sweeps sort
    // naturally in the transcript and a reader can find "the 14:00 sweep".
    this.runId = `steward:${new Date(now).toISOString()}`;
  }

  /**
   * Record one step of the sweep.
   *
   * @param kind Machine-readable step kind (e.g. `steward-decision`).
   * @param ship Always `'steward'` here; kept for shape parity with ships.
   * @param title One-line human summary.
   * @param detail Arbitrary JSON-serializable payload; `null` when there is none.
   * @returns Nothing; write failures are logged and swallowed on purpose.
   */
  async step(kind: string, ship: string | null, title: string, detail: unknown): Promise<void> {
    const seq = this.seq++;
    if (!this.db) {
      console.log(`[fleet-executor] steward[${seq}] ${kind}: ${title}`);
      return;
    }
    try {
      await this.db
        .prepare(
          `INSERT OR REPLACE INTO fleet_run_steps (run_id, seq, kind, ship, title, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          this.runId,
          seq,
          kind,
          ship,
          title,
          detail == null ? null : JSON.stringify(detail),
          Math.floor(Date.now() / 1000),
        )
        .run();
    } catch (err) {
      console.error(
        `[fleet-executor] steward transcript step failed run=${this.runId} seq=${seq}: ${String(err)}`,
      );
    }
  }
}
