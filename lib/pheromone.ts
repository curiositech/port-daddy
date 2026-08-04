/**
 * Pheromone Module — Stigmergic Evaporation
 *
 * Implements the "decay" of semantic pheromones stored in 
 * Port Daddy metadata. This allows agents to coordinate via 
 * environmental traces that fade over time.
 */

import type Database from 'better-sqlite3';

export interface PheromoneConfig {
  decayRate: number; // 0.0 to 1.0 (e.g., 0.95 means 5% loss per interval)
  intervalMs: number;
}

const ALLOWED_TABLES = new Set(['services', 'projects', 'sessions', 'agents', 'locks']);

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (no DB) — RCP-7a resolution damping + RCP-12 coverage scan.
// Exported so the math is unit-testable without a database.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anti-inflammatory damping (RCP-7a, soma's resolution traces): once a problem
 * on an entity is *resolved*, a resolution trace suppresses its pheromone so
 * agents stop piling onto solved work. effective = raw · (1 − clamp(damping·res)).
 */
export function dampedStrength(raw: number, resolution: number, damping = 1): number {
  if (!Number.isFinite(resolution) || resolution <= 0) return raw;
  const r = Math.min(1, Math.max(0, damping * resolution));
  return raw * (1 - r);
}

/** Apply {@link dampedStrength} across a pheromone map given a resolution map. */
export function applyResolutionDamping(
  pheromones: Record<string, number>,
  resolutions: Record<string, number>,
  damping = 1,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(pheromones)) {
    if (typeof raw !== 'number') continue;
    const eff = dampedStrength(raw, resolutions[key] ?? 0, damping);
    if (eff >= 0.01) out[key] = eff;
  }
  return out;
}

/**
 * The one decay law, extracted from {@link createPheromoneManager}'s
 * `decayOnRead` factor math so it is unit-testable and reusable without a
 * database.
 *
 * Motivation: the reconcile loop (`lib/squid/reconcile.ts`) stores drained
 * shell pheromone appends in its own durable `ink_pheromones` table (the DB
 * decay engine here is keyed to entity-row metadata — services/projects/
 * sessions — which file-subjects are not). To avoid a SECOND decay
 * implementation drifting from this one, both consumers call this single pure
 * function: `eff = value * decayRate^(elapsed / intervalMs)`.
 *
 * Design: mirrors decayOnRead's negligible-elapsed guard (`intervals < 0.1`
 * returns the value unchanged) so read-time decay behaves identically in both
 * stores.
 *
 * @param value the stored (raw) intensity
 * @param elapsedMs milliseconds since the value was last written/decayed
 * @param cfg decay configuration; defaults match {@link createPheromoneManager}
 * @returns the effective (decayed) intensity — never negative, NaN-safe (0)
 */
export function decayedValue(
  value: number,
  elapsedMs: number,
  cfg: PheromoneConfig = { decayRate: 0.95, intervalMs: 60000 },
): number {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return value;
  const intervals = elapsedMs / cfg.intervalMs;
  if (intervals < 0.1) return value; // negligible — parity with decayOnRead
  return value * Math.pow(cfg.decayRate, intervals);
}

export interface Coverage {
  total: number;
  seen: number;
  coverage: number; // seen / total, in [0,1]; 1 when the universe is empty
  unseen: string[];
}

/**
 * Coverage of an entity universe given the set of seen (pheromone-bearing) ids
 * (RCP-12 epistemic scan). The pheromone blackboard *is* the visit record: a
 * sprayed entity is "seen". Tells an innate-scan driver what is still invisible.
 */
export function coverageOf(universe: string[], seen: Iterable<string>): Coverage {
  const seenSet = new Set(seen);
  const uniq = [...new Set(universe)];
  const unseen = uniq.filter((id) => !seenSet.has(id));
  const total = uniq.length;
  return {
    total,
    seen: total - unseen.length,
    coverage: total === 0 ? 1 : (total - unseen.length) / total,
    unseen,
  };
}

/**
 * The innate-scan choice: pick an unseen target so no node stays permanently
 * invisible. Deterministic given `rngValue` ∈ [0,1) (seeded-reproducible, like
 * soma); returns null when everything is already seen.
 */
export function pickUnseenTarget(unseen: string[], rngValue: number): string | null {
  if (unseen.length === 0) return null;
  const r = Number.isFinite(rngValue) ? Math.min(0.999999, Math.max(0, rngValue)) : 0;
  return unseen[Math.floor(r * unseen.length)] ?? unseen[0]!;
}

export function createPheromoneManager(db: Database.Database, config: PheromoneConfig = { decayRate: 0.95, intervalMs: 60000 }) {

  // Pre-built statements per table — eliminates SQL interpolation entirely.
  // Table names are compile-time constants from ALLOWED_TABLES, never user input.
  // Some tables may not exist yet (created lazily), so prep is best-effort.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tableStmts: Record<string, {
    selectAll: any;
    selectById: any;
    update: any;
  }> = {};

  for (const t of ALLOWED_TABLES) {
    try {
      tableStmts[t] = {
        selectAll: db.prepare(`SELECT id, metadata FROM ${t} WHERE metadata IS NOT NULL`),
        selectById: db.prepare(`SELECT metadata FROM ${t} WHERE id = ?`),
        update: db.prepare(`UPDATE ${t} SET metadata = ? WHERE id = ?`),
      };
    } catch {
      // Table doesn't exist yet — will be created by its own module
      tableStmts[t] = { selectAll: null, selectById: null, update: null };
    }
  }

  /** Get pre-built statements for a table, or null if not allowed/available */
  function getStmts(table: string) {
    if (!ALLOWED_TABLES.has(table)) return null;
    const s = tableStmts[table];
    if (!s || !s.selectById) {
      // Table may have been created after init — try to prepare now
      try {
        tableStmts[table] = {
          selectAll: db.prepare(`SELECT id, metadata FROM ${table} WHERE metadata IS NOT NULL`),
          selectById: db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`),
          update: db.prepare(`UPDATE ${table} SET metadata = ? WHERE id = ?`),
        };
        return tableStmts[table];
      } catch { return null; }
    }
    return s;
  }

  /**
   * Run one evaporation cycle.
   * Scans all services, projects, and sessions for pheromones in metadata.
   */
  function evaporate() {
    try {
      const tables = ['services', 'projects', 'sessions'];

      for (const table of tables) {
        const s = getStmts(table);
        if (!s || !s.selectAll) continue;
        try {
          const rows = s.selectAll.all() as any[];

          for (const row of rows) {
            try {
              if (!row.metadata) continue;
              const metadata = JSON.parse(row.metadata);

              let changed = false;

              if (metadata && metadata.pheromones && typeof metadata.pheromones === 'object') {
                for (const [key, value] of Object.entries(metadata.pheromones)) {
                  if (typeof value === 'number') {
                    metadata.pheromones[key] = value * config.decayRate;
                    if (metadata.pheromones[key] < 0.01) {
                      delete metadata.pheromones[key];
                    }
                    changed = true;
                  }
                }
              }

              // Resolution traces (RCP-7a) fade faster than pheromones —
              // anti-inflammatory damping is transient, not a permanent veto.
              if (metadata && metadata.resolutions && typeof metadata.resolutions === 'object') {
                const resDecay = config.decayRate * config.decayRate;
                for (const [key, value] of Object.entries(metadata.resolutions)) {
                  if (typeof value === 'number') {
                    metadata.resolutions[key] = value * resDecay;
                    if (metadata.resolutions[key] < 0.01) {
                      delete metadata.resolutions[key];
                    }
                    changed = true;
                  }
                }
              }

              if (changed && s.update) {
                s.update.run(JSON.stringify(metadata), row.id);
              }
            } catch (e) {
              // Ignore row-level JSON or update errors
            }
          }
        } catch (tableError) {
          // Ignore table-level missing or busy errors
        }
      }
    } catch (globalError) {
      console.error('⚠️ Pheromone Evaporator encountered a global error:', globalError);
    }
  }

  /**
   * Spray a pheromone: set or increase a value on an entity's metadata.
   */
  function spray(table: string, id: string, key: string, strength: number): { success: boolean; pheromones: Record<string, number> } {
    if (!ALLOWED_TABLES.has(table)) {
      return { success: false, pheromones: {} };
    }
    if (strength < 0 || strength > 1) {
      return { success: false, pheromones: {} };
    }

    const row = db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`).get(id) as { metadata: string | null } | undefined;
    if (!row) return { success: false, pheromones: {} };

    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    if (!metadata.pheromones) metadata.pheromones = {};
    metadata.pheromones[key] = strength;

    db.prepare(`UPDATE ${table} SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), id);
    return { success: true, pheromones: metadata.pheromones };
  }

  // Track last evaporation time per entity for read-time decay
  const lastDecayTime = new Map<string, number>();

  /**
   * Apply decay at read time based on elapsed time since last decay.
   * Returns the decayed pheromones and writes them back if changed.
   */
  function decayOnRead(table: string, id: string, pheromones: Record<string, number>): Record<string, number> {
    const cacheKey = `${table}:${id}`;
    const now = Date.now();
    const lastTime = lastDecayTime.get(cacheKey) || now;
    const elapsed = now - lastTime;

    if (elapsed < 1000) return pheromones; // less than 1 second, skip

    // Calculate how many decay intervals have passed
    const intervals = elapsed / config.intervalMs;
    if (intervals < 0.1) return pheromones; // negligible

    let changed = false;

    for (const [key, value] of Object.entries(pheromones)) {
      if (typeof value !== 'number') continue;
      // One decay law, one implementation — see the pure `decayedValue` export.
      const decayed = decayedValue(value, elapsed, config);
      if (decayed < 0.01) {
        delete pheromones[key];
        changed = true;
      } else if (Math.abs(decayed - value) > 0.001) {
        pheromones[key] = Math.round(decayed * 1000) / 1000; // 3 decimal places
        changed = true;
      }
    }

    lastDecayTime.set(cacheKey, now);

    // Write back if values changed
    if (changed) {
      try {
        const row = db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`).get(id) as { metadata: string | null } | undefined;
        if (row) {
          const metadata = row.metadata ? JSON.parse(row.metadata) : {};
          metadata.pheromones = pheromones;
          db.prepare(`UPDATE ${table} SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), id);
        }
      } catch {}
    }

    return pheromones;
  }

  /**
   * Sniff pheromones: read all pheromone values for an entity.
   * Applies read-time decay based on elapsed time since last access.
   */
  function sniff(table: string, id: string): { success: boolean; pheromones: Record<string, number> } {
    if (!ALLOWED_TABLES.has(table)) {
      return { success: false, pheromones: {} };
    }

    const row = db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`).get(id) as { metadata: string | null } | undefined;
    if (!row) return { success: false, pheromones: {} };

    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    const pheromones = metadata.pheromones || {};

    // Decay on read — accurate values without waiting for the background tick
    const decayed = decayOnRead(table, id, { ...pheromones });

    return { success: true, pheromones: decayed };
  }

  /**
   * Deposit a RESOLUTION trace (RCP-7a): mark `key` on an entity as resolved so
   * its pheromone is damped on effective reads. Stored in a separate
   * `metadata.resolutions` map; decays faster than pheromones (anti-inflammatory).
   */
  function sprayResolution(table: string, id: string, key: string, strength: number): { success: boolean; resolutions: Record<string, number> } {
    if (!ALLOWED_TABLES.has(table)) return { success: false, resolutions: {} };
    if (strength < 0 || strength > 1) return { success: false, resolutions: {} };

    const row = db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`).get(id) as { metadata: string | null } | undefined;
    if (!row) return { success: false, resolutions: {} };

    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    if (!metadata.resolutions) metadata.resolutions = {};
    metadata.resolutions[key] = strength;

    db.prepare(`UPDATE ${table} SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), id);
    return { success: true, resolutions: metadata.resolutions };
  }

  /**
   * Read pheromones with anti-inflammatory damping applied (RCP-7a). Where
   * `sniff` returns raw heat, `sniffEffective` suppresses entries that carry a
   * resolution trace — what an agent deciding "is this still worth flocking to?"
   * should read.
   */
  function sniffEffective(table: string, id: string, damping = 1): { success: boolean; pheromones: Record<string, number> } {
    if (!ALLOWED_TABLES.has(table)) return { success: false, pheromones: {} };
    const row = db.prepare(`SELECT metadata FROM ${table} WHERE id = ?`).get(id) as { metadata: string | null } | undefined;
    if (!row) return { success: false, pheromones: {} };

    const metadata = row.metadata ? JSON.parse(row.metadata) : {};
    const pheromones = decayOnRead(table, id, { ...(metadata.pheromones || {}) });
    const resolutions = (metadata.resolutions || {}) as Record<string, number>;
    return { success: true, pheromones: applyResolutionDamping(pheromones, resolutions, damping) };
  }

  /**
   * Coverage of a table (RCP-12): the pheromone blackboard is the visit record,
   * so "seen" = entities carrying any pheromone, and the universe is every row.
   * Surfaces what is still invisible so an innate scan can target it.
   */
  function coverage(table: string): { success: boolean; table: string } & Coverage {
    const empty = { success: false, table, total: 0, seen: 0, coverage: 1, unseen: [] as string[] };
    if (!ALLOWED_TABLES.has(table)) return empty;
    try {
      const universe = (db.prepare(`SELECT id FROM ${table}`).all() as Array<{ id: string }>).map((r) => r.id);
      const rows = db.prepare(`SELECT id, metadata FROM ${table} WHERE metadata IS NOT NULL`).all() as any[];
      const seen: string[] = [];
      for (const row of rows) {
        try {
          const md = JSON.parse(row.metadata);
          if (md?.pheromones && Object.keys(md.pheromones).length > 0) seen.push(row.id);
        } catch {}
      }
      return { success: true, table, ...coverageOf(universe, seen) };
    } catch {
      return empty;
    }
  }

  /**
   * List all non-zero pheromones across all tracked tables. Each entry also
   * carries its `resolutions` map (RCP-7a) — present (possibly empty) so
   * consumers can show effective (damped) heat without an extra fetch.
   */
  function list(): Array<{ table: string; id: string; pheromones: Record<string, number>; resolutions: Record<string, number> }> {
    const results: Array<{ table: string; id: string; pheromones: Record<string, number>; resolutions: Record<string, number> }> = [];

    for (const table of ['services', 'projects', 'sessions', 'agents']) {
      if (!ALLOWED_TABLES.has(table)) continue;
      try {
        const rows = db.prepare(`SELECT id, metadata FROM ${table} WHERE metadata IS NOT NULL`).all() as any[];
        for (const row of rows) {
          try {
            const metadata = JSON.parse(row.metadata);
            if (metadata?.pheromones && Object.keys(metadata.pheromones).length > 0) {
              results.push({ table, id: row.id, pheromones: metadata.pheromones, resolutions: metadata.resolutions ?? {} });
            }
          } catch {}
        }
      } catch {}
    }

    return results;
  }

  let timer: NodeJS.Timeout | null = null;

  return {
    start() {
      if (timer) return;
      timer = setInterval(evaporate, config.intervalMs);
      console.error('[Pheromone] Evaporator active (decay: ' + config.decayRate + ', interval: ' + config.intervalMs + 'ms)');
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    evaporateNow: evaporate,
    spray,
    sniff,
    sprayResolution,
    sniffEffective,
    coverage,
    list,
  };
}
