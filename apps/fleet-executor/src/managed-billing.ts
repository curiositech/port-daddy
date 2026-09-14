/**
 * Fail-closed managed-inference billing for Fleet.
 *
 * A run may reach Workers AI only after an explicit installation entitlement
 * has atomically reserved retail credit. Money is represented only as integer
 * micro-USD. The reservation fixes the provider-cost ceiling at one quarter of
 * reserved retail, preserving the platform's 75% gross-margin floor.
 */

export const MICROUSD_PER_USD = 1_000_000;
export const PROVIDER_COST_SHARE_DENOMINATOR = 4;

export type ReservationState = 'reserved' | 'settled' | 'released';

export interface ManagedEntitlement {
  installationId: number;
  retailBalanceMicrousd: number;
  runRetailMicrousd: number;
}

export interface ManagedRunReservation {
  runId: string;
  installationId: number;
  retailMicrousd: number;
  providerCostCapMicrousd: number;
  providerCostMicrousd: number | null;
  state: ReservationState;
}

export interface ManagedShipSpend {
  runId: string;
  ship: string;
  installationId: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  providerCostMicrousd: number;
}

export class ManagedBillingError extends Error {
  constructor(
    public readonly code:
      | 'db-unavailable'
      | 'entitlement-missing'
      | 'entitlement-invalid'
      | 'reservation-denied'
      | 'reservation-conflict'
      | 'reservation-terminal'
      | 'spend-conflict'
      | 'margin-exceeded'
      | 'accounting-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ManagedBillingError';
  }
}

function requireDb(db: D1Database | undefined): D1Database {
  if (!db) throw new ManagedBillingError('db-unavailable', 'managed billing requires the shared D1 binding');
  return db;
}

function integer(value: unknown, label: string, min = 0): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) {
    throw new ManagedBillingError('entitlement-invalid', `${label} must be a safe integer >= ${min}`);
  }
  return n;
}

function reservationFrom(row: Record<string, unknown>): ManagedRunReservation {
  const state = String(row.state) as ReservationState;
  if (!['reserved', 'settled', 'released'].includes(state)) {
    throw new ManagedBillingError('reservation-conflict', `reservation has invalid state ${String(row.state)}`);
  }
  return {
    runId: String(row.run_id),
    installationId: integer(row.installation_id, 'reservation installation_id', 1),
    retailMicrousd: integer(row.retail_microusd, 'reservation retail_microusd', 1),
    providerCostCapMicrousd: integer(row.provider_cost_cap_microusd, 'reservation provider_cost_cap_microusd'),
    providerCostMicrousd: row.provider_cost_microusd == null
      ? null
      : integer(row.provider_cost_microusd, 'reservation provider_cost_microusd'),
    state,
  };
}

async function readReservation(db: D1Database, runId: string): Promise<ManagedRunReservation | null> {
  const row = await db.prepare(
    `SELECT run_id, installation_id, retail_microusd, provider_cost_cap_microusd,
            provider_cost_microusd, state
       FROM fleet_run_reservations
      WHERE run_id = ?`,
  ).bind(runId).first<Record<string, unknown>>();
  return row ? reservationFrom(row) : null;
}

/** Resolve an explicit, active entitlement. Missing schema/rows/read failures deny inference. */
export async function resolveManagedEntitlement(
  dbBinding: D1Database | undefined,
  installationId: number,
): Promise<ManagedEntitlement> {
  const db = requireDb(dbBinding);
  try {
    const row = await db.prepare(
      `SELECT installation_id, retail_balance_microusd, run_retail_microusd
         FROM fleet_managed_entitlements
        WHERE installation_id = ? AND state = 'active'`,
    ).bind(installationId).first<Record<string, unknown>>();
    if (!row) {
      throw new ManagedBillingError(
        'entitlement-missing',
        `installation ${installationId} has no active managed-inference entitlement`,
      );
    }
    return {
      installationId: integer(row.installation_id, 'entitlement installation_id', 1),
      retailBalanceMicrousd: integer(row.retail_balance_microusd, 'retail_balance_microusd'),
      runRetailMicrousd: integer(row.run_retail_microusd, 'run_retail_microusd', 1),
    };
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', 'managed entitlement read failed', { cause: error });
  }
}

/**
 * Atomically reserve one run's retail price. Settled reservations consume the
 * prepaid balance permanently; released reservations return it. A deterministic
 * run id makes queue retries idempotent.
 */
export async function reserveManagedRun(
  dbBinding: D1Database | undefined,
  runId: string,
  installationId: number,
  createdAt: number,
): Promise<ManagedRunReservation> {
  const db = requireDb(dbBinding);
  try {
    const inserted = await db.prepare(
      `INSERT INTO fleet_run_reservations
         (run_id, installation_id, retail_microusd, provider_cost_cap_microusd, state, created_at, updated_at)
       SELECT ?, e.installation_id, e.run_retail_microusd,
              CAST(e.run_retail_microusd / 4 AS INTEGER), 'reserved', ?, ?
         FROM fleet_managed_entitlements e
        WHERE e.installation_id = ?
          AND e.state = 'active'
          AND e.run_retail_microusd > 0
          AND e.retail_balance_microusd >= e.run_retail_microusd + COALESCE((
                SELECT SUM(r.retail_microusd)
                  FROM fleet_run_reservations r
                 WHERE r.installation_id = e.installation_id
                   AND r.state IN ('reserved', 'settled')
              ), 0)
       ON CONFLICT(run_id) DO NOTHING
       RETURNING run_id, installation_id, retail_microusd, provider_cost_cap_microusd,
                 provider_cost_microusd, state`,
    ).bind(runId, createdAt, createdAt, installationId).first<Record<string, unknown>>();
    if (inserted) return reservationFrom(inserted);

    const existing = await readReservation(db, runId);
    if (!existing) {
      throw new ManagedBillingError(
        'reservation-denied',
        `installation ${installationId} has no reservable managed-inference credit`,
      );
    }
    if (existing.installationId !== installationId) {
      throw new ManagedBillingError('reservation-conflict', `run ${runId} belongs to another installation`);
    }
    if (existing.state === 'released') {
      throw new ManagedBillingError('reservation-terminal', `run ${runId} was already released`);
    }
    return existing;
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `managed reservation failed for ${runId}`, { cause: error });
  }
}

/** Write one deterministic per-ship spend identity and verify its read-back. */
export async function recordManagedShipSpend(
  dbBinding: D1Database | undefined,
  spend: ManagedShipSpend,
  createdAt: number,
): Promise<void> {
  const db = requireDb(dbBinding);
  for (const [label, value] of Object.entries({
    installationId: spend.installationId,
    inputTokens: spend.inputTokens,
    outputTokens: spend.outputTokens,
    providerCostMicrousd: spend.providerCostMicrousd,
    createdAt,
  })) integer(value, label, label === 'installationId' ? 1 : 0);
  try {
    await db.prepare(
      `INSERT INTO fleet_run_spend_v2
         (run_id, ship, installation_id, model, input_tokens, output_tokens,
          provider_cost_microusd, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
         FROM fleet_run_reservations
        WHERE run_id = ? AND installation_id = ? AND state = 'reserved'
       ON CONFLICT(run_id, ship) DO NOTHING`,
    ).bind(
      spend.runId, spend.ship, spend.installationId, spend.model,
      spend.inputTokens, spend.outputTokens, spend.providerCostMicrousd, createdAt,
      spend.runId, spend.installationId,
    ).run();
    const row = await db.prepare(
      `SELECT installation_id, model, input_tokens, output_tokens, provider_cost_microusd
         FROM fleet_run_spend_v2 WHERE run_id = ? AND ship = ?`,
    ).bind(spend.runId, spend.ship).first<Record<string, unknown>>();
    if (!row || Number(row.installation_id) !== spend.installationId || String(row.model) !== spend.model
      || Number(row.input_tokens) !== spend.inputTokens || Number(row.output_tokens) !== spend.outputTokens
      || Number(row.provider_cost_microusd) !== spend.providerCostMicrousd) {
      throw new ManagedBillingError('spend-conflict', `spend identity conflict for ${spend.runId}/${spend.ship}`);
    }
    const total = await db.prepare(
      `SELECT r.provider_cost_cap_microusd,
              COALESCE(SUM(s.provider_cost_microusd), 0) AS provider_cost_microusd
         FROM fleet_run_reservations r
         LEFT JOIN fleet_run_spend_v2 s ON s.run_id = r.run_id
        WHERE r.run_id = ?
        GROUP BY r.run_id, r.provider_cost_cap_microusd`,
    ).bind(spend.runId).first<Record<string, unknown>>();
    if (!total) throw new ManagedBillingError('spend-conflict', `run ${spend.runId} has no reservation`);
    if (integer(total.provider_cost_microusd, 'aggregate provider_cost_microusd')
      > integer(total.provider_cost_cap_microusd, 'provider_cost_cap_microusd')) {
      throw new ManagedBillingError(
        'margin-exceeded',
        `run ${spend.runId} provider cost exceeds 25% of its reserved retail`,
      );
    }
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `managed spend write failed for ${spend.runId}/${spend.ship}`, { cause: error });
  }
}

/** Settle exactly once, enforcing provider cost <= 25% of reserved retail. */
export async function settleManagedRun(
  dbBinding: D1Database | undefined,
  runId: string,
  settledAt: number,
): Promise<ManagedRunReservation> {
  const db = requireDb(dbBinding);
  try {
    const updated = await db.prepare(
      `UPDATE fleet_run_reservations
          SET state = 'settled',
              provider_cost_microusd = COALESCE((
                SELECT SUM(provider_cost_microusd) FROM fleet_run_spend_v2 WHERE run_id = ?
              ), 0),
              settled_at = ?, updated_at = ?
        WHERE run_id = ? AND state = 'reserved'
          AND COALESCE((SELECT SUM(provider_cost_microusd) FROM fleet_run_spend_v2 WHERE run_id = ?), 0)
              <= provider_cost_cap_microusd
       RETURNING run_id, installation_id, retail_microusd, provider_cost_cap_microusd,
                 provider_cost_microusd, state`,
    ).bind(runId, settledAt, settledAt, runId, runId).first<Record<string, unknown>>();
    if (updated) return reservationFrom(updated);
    const existing = await readReservation(db, runId);
    if (!existing) throw new ManagedBillingError('reservation-conflict', `run ${runId} has no reservation`);
    if (existing.state === 'settled') return existing;
    if (existing.state === 'released') {
      throw new ManagedBillingError('reservation-terminal', `run ${runId} was already released`);
    }
    throw new ManagedBillingError(
      'margin-exceeded',
      `run ${runId} provider cost exceeds 25% of its reserved retail`,
    );
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `managed settlement failed for ${runId}`, { cause: error });
  }
}

/** Release an unspent reservation exactly once. A run with recorded spend must settle. */
export async function releaseManagedRun(
  dbBinding: D1Database | undefined,
  runId: string,
  releasedAt: number,
): Promise<ManagedRunReservation> {
  const db = requireDb(dbBinding);
  try {
    const updated = await db.prepare(
      `UPDATE fleet_run_reservations
          SET state = 'released', released_at = ?, updated_at = ?
        WHERE run_id = ? AND state = 'reserved'
          AND NOT EXISTS (SELECT 1 FROM fleet_run_spend_v2 WHERE run_id = ?)
       RETURNING run_id, installation_id, retail_microusd, provider_cost_cap_microusd,
                 provider_cost_microusd, state`,
    ).bind(releasedAt, releasedAt, runId, runId).first<Record<string, unknown>>();
    if (updated) return reservationFrom(updated);
    const existing = await readReservation(db, runId);
    if (!existing) throw new ManagedBillingError('reservation-conflict', `run ${runId} has no reservation`);
    if (existing.state === 'released') return existing;
    if (existing.state === 'settled') return existing;
    throw new ManagedBillingError('reservation-terminal', `run ${runId} has spend and cannot be released`);
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `managed release failed for ${runId}`, { cause: error });
  }
}
