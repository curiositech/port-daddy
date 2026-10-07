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

export interface ManagedRunLease { runId: string; owner: string; fence: number; expiresAt: number }
export interface ManagedCallRequest { ship: string; model: string; maxInputTokens: number; maxOutputTokens: number }
export interface ManagedCallAuthorization { authorizationId: string; authorizedCostMicrousd: number }

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

/** Acquire the sole execution fence for a delivery. A live foreign lease denies before AI. */
export async function acquireManagedRunLease(
  dbBinding: D1Database | undefined, runId: string, owner: string, now: number, expiresAt: number,
): Promise<ManagedRunLease> {
  const db = requireDb(dbBinding);
  try {
    const row = await db.prepare(
      `UPDATE fleet_run_reservations SET lease_owner = ?, lease_fence = lease_fence + 1,
              lease_expires_at = ?, updated_at = ?
        WHERE run_id = ? AND state = 'reserved'
          AND (lease_owner IS NULL OR lease_expires_at <= ?)
       RETURNING run_id, lease_owner, lease_fence, lease_expires_at`,
    ).bind(owner, expiresAt, now, runId, now).first<Record<string, unknown>>();
    if (!row) throw new ManagedBillingError('reservation-conflict', `run ${runId} already has a live executor`);
    return { runId, owner: String(row.lease_owner), fence: integer(row.lease_fence, 'lease fence', 1), expiresAt: integer(row.lease_expires_at, 'lease expiry', 1) };
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `managed lease failed for ${runId}`, { cause: error });
  }
}

/** Yield after a durable checkpoint so the next continuation can take a new fence. */
export async function yieldManagedRunLease(dbBinding: D1Database | undefined, lease: ManagedRunLease, now: number): Promise<void> {
  const db = requireDb(dbBinding);
  const result = await db.prepare(
    `UPDATE fleet_run_reservations SET lease_owner=NULL, lease_expires_at=NULL, updated_at=?
      WHERE run_id=? AND state='reserved' AND lease_owner=? AND lease_fence=?`,
  ).bind(now, lease.runId, lease.owner, lease.fence).run();
  if (!result.success) throw new ManagedBillingError('accounting-failed', `managed lease yield failed for ${lease.runId}`);
}

/**
 * Reap only expired fences. Calls authorized by a crashed executor are settled
 * at actual-or-worst-case cost; a reservation with no calls is released.
 * Every mutation compares the observed fence and expiry so a renewed owner wins.
 */
export async function sweepStaleManagedReservations(dbBinding: D1Database | undefined, now: number, limit = 100): Promise<number> {
  const db = requireDb(dbBinding);
  const stale = await db.prepare(
    `SELECT run_id, lease_fence, lease_expires_at,
            EXISTS(SELECT 1 FROM fleet_run_call_authorizations a WHERE a.run_id=r.run_id) AS has_calls
       FROM fleet_run_reservations r WHERE state='reserved' AND (lease_expires_at<=? OR (lease_owner IS NULL AND updated_at<=?))
       ORDER BY COALESCE(lease_expires_at,0) LIMIT ?`,
  ).bind(now, now-14_400, limit).all<Record<string, unknown>>();
  let changed = 0;
  for (const row of stale.results ?? []) {
    const runId=String(row.run_id); const fence=integer(row.lease_fence,'lease fence'); const expiry=row.lease_expires_at==null?0:integer(row.lease_expires_at,'lease expiry');
    const state = Number(row.has_calls) ? 'settled' : 'released';
    const result = await db.prepare(
      state === 'settled'
        ? `UPDATE fleet_run_reservations SET state='settled', provider_cost_microusd=COALESCE((SELECT SUM(COALESCE(actual_cost_microusd,authorized_cost_microusd)) FROM fleet_run_call_authorizations WHERE run_id=?),0), settled_at=?,updated_at=? WHERE run_id=? AND state='reserved' AND lease_fence=? AND COALESCE(lease_expires_at,0)=?`
        : `UPDATE fleet_run_reservations SET state='released',released_at=?,updated_at=? WHERE run_id=? AND state='reserved' AND lease_fence=? AND COALESCE(lease_expires_at,0)=? AND NOT EXISTS(SELECT 1 FROM fleet_run_call_authorizations WHERE run_id=?)`,
    ).bind(...(state === 'settled' ? [runId,now,now,runId,fence,expiry] : [now,now,runId,fence,expiry,runId])).run();
    changed += Number(result.meta?.changes ?? 0);
  }
  return changed;
}

/** Finalize a known terminal run only when no executor currently owns it. */
export async function finalizeUnleasedManagedRun(dbBinding: D1Database | undefined, runId: string, now: number): Promise<void> {
  const db=requireDb(dbBinding);
  await db.prepare(`UPDATE fleet_run_reservations SET state=CASE WHEN EXISTS(SELECT 1 FROM fleet_run_call_authorizations WHERE run_id=?) THEN 'settled' ELSE 'released' END, provider_cost_microusd=CASE WHEN EXISTS(SELECT 1 FROM fleet_run_call_authorizations WHERE run_id=?) THEN COALESCE((SELECT SUM(COALESCE(actual_cost_microusd,authorized_cost_microusd)) FROM fleet_run_call_authorizations WHERE run_id=?),0) ELSE NULL END, settled_at=CASE WHEN EXISTS(SELECT 1 FROM fleet_run_call_authorizations WHERE run_id=?) THEN ? ELSE NULL END, released_at=CASE WHEN NOT EXISTS(SELECT 1 FROM fleet_run_call_authorizations WHERE run_id=?) THEN ? ELSE NULL END, updated_at=? WHERE run_id=? AND state='reserved' AND lease_owner IS NULL`)
    .bind(runId,runId,runId,runId,now,runId,now,now,runId).run();
}

/** Reserve worst-case provider cost atomically before the provider thunk starts. */
export async function authorizeManagedAiCall(
  dbBinding: D1Database | undefined, lease: ManagedRunLease, attemptId: string,
  request: ManagedCallRequest, authorizedCostMicrousd: number, now: number,
): Promise<ManagedCallAuthorization> {
  const db = requireDb(dbBinding);
  integer(authorizedCostMicrousd, 'authorized provider cost');
  try {
    const row = await db.prepare(
      `INSERT INTO fleet_run_call_authorizations
        (authorization_id, run_id, lease_fence, call_sequence, attempt_id, ship, model,
         max_input_tokens, max_output_tokens, authorized_cost_microusd, state, created_at)
       SELECT ? || ':' || ? || ':' || (COALESCE(MAX(a.call_sequence),0)+1), ?, ?,
              COALESCE(MAX(a.call_sequence),0)+1, ?, ?, ?, ?, ?, ?, 'authorized', ?
         FROM fleet_run_reservations r
         LEFT JOIN fleet_run_call_authorizations a ON a.run_id=r.run_id
        WHERE r.run_id=? AND r.state='reserved' AND r.lease_owner=?
          AND r.lease_fence=? AND r.lease_expires_at>?
        GROUP BY r.run_id, r.provider_cost_cap_microusd
       HAVING COALESCE(SUM(COALESCE(a.actual_cost_microusd,a.authorized_cost_microusd)),0)+?
              <= r.provider_cost_cap_microusd
       RETURNING authorization_id, authorized_cost_microusd`,
    ).bind(lease.runId, lease.fence, lease.runId, lease.fence, attemptId, request.ship, request.model,
      request.maxInputTokens, request.maxOutputTokens, authorizedCostMicrousd, now,
      lease.runId, lease.owner, lease.fence, now, authorizedCostMicrousd).first<Record<string, unknown>>();
    if (!row) throw new ManagedBillingError('margin-exceeded', `run ${lease.runId} has no safe provider-cost capacity`);
    return { authorizationId: String(row.authorization_id), authorizedCostMicrousd: integer(row.authorized_cost_microusd, 'authorized provider cost') };
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `AI call authorization failed for ${lease.runId}`, { cause: error });
  }
}

/** Reconcile once. Missing usage or any thrown/timeout call consumes the authorized worst case. */
export async function reconcileManagedAiCall(
  dbBinding: D1Database | undefined, authorization: ManagedCallAuthorization,
  actualCostMicrousd: number | null, outcome: 'reported'|'unreported'|'failed', now: number,
): Promise<void> {
  const db = requireDb(dbBinding);
  const charged = actualCostMicrousd == null ? authorization.authorizedCostMicrousd : integer(actualCostMicrousd, 'actual provider cost');
  if (charged > authorization.authorizedCostMicrousd) throw new ManagedBillingError('margin-exceeded', 'reported cost exceeded its preauthorization');
  try {
    await db.prepare(
      `UPDATE fleet_run_call_authorizations SET actual_cost_microusd=?, state=?, reconciled_at=?
        WHERE authorization_id=? AND state='authorized'`,
    ).bind(charged, outcome, now, authorization.authorizationId).run();
    const row = await db.prepare(`SELECT actual_cost_microusd,state FROM fleet_run_call_authorizations WHERE authorization_id=?`)
      .bind(authorization.authorizationId).first<Record<string, unknown>>();
    if (!row || Number(row.actual_cost_microusd) !== charged || String(row.state) !== outcome) {
      throw new ManagedBillingError('spend-conflict', `call reconciliation conflict for ${authorization.authorizationId}`);
    }
  } catch (error) {
    if (error instanceof ManagedBillingError) throw error;
    throw new ManagedBillingError('accounting-failed', `call reconciliation failed for ${authorization.authorizationId}`, { cause: error });
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
      `SELECT e.installation_id, e.retail_balance_microusd, e.run_retail_microusd
         FROM fleet_managed_entitlements e
         JOIN fleet_served_installations s USING (installation_id)
        WHERE e.installation_id = ? AND e.state = 'active' AND s.state = 'served'`,
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

/**
 * Write per-ship reported telemetry and verify read-back. This is explicitly
 * non-authoritative: settlement uses per-call actual-or-authorized charges.
 */
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
                SELECT SUM(COALESCE(actual_cost_microusd, authorized_cost_microusd)) FROM fleet_run_call_authorizations WHERE run_id = ?
              ), 0),
              settled_at = ?, updated_at = ?
        WHERE run_id = ? AND state = 'reserved'
          AND COALESCE((SELECT SUM(COALESCE(actual_cost_microusd, authorized_cost_microusd)) FROM fleet_run_call_authorizations WHERE run_id = ?), 0)
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
          AND NOT EXISTS (SELECT 1 FROM fleet_run_call_authorizations WHERE run_id = ?)
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
