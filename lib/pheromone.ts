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

export function createPheromoneManager(db: Database.Database, config: PheromoneConfig = { decayRate: 0.95, intervalMs: 60000 }) {

  // Pre-built statements per table — eliminates SQL interpolation entirely.
  // Table names are compile-time constants from ALLOWED_TABLES, never user input.
  // Some tables may not exist yet (created lazily), so prep is best-effort.
  const tableStmts: Record<string, {
    selectAll: ReturnType<typeof db.prepare> | null;
    selectById: ReturnType<typeof db.prepare> | null;
    update: ReturnType<typeof db.prepare> | null;
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

              if (metadata && metadata.pheromones && typeof metadata.pheromones === 'object') {
                let changed = false;

                for (const [key, value] of Object.entries(metadata.pheromones)) {
                  if (typeof value === 'number') {
                    metadata.pheromones[key] = value * config.decayRate;
                    if (metadata.pheromones[key] < 0.01) {
                      delete metadata.pheromones[key];
                    }
                    changed = true;
                  }
                }

                if (changed && s.update) {
                  s.update.run(JSON.stringify(metadata), row.id);
                }
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

    const factor = Math.pow(config.decayRate, intervals);
    let changed = false;

    for (const [key, value] of Object.entries(pheromones)) {
      if (typeof value !== 'number') continue;
      const decayed = value * factor;
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
   * List all non-zero pheromones across all tracked tables.
   */
  function list(): Array<{ table: string; id: string; pheromones: Record<string, number> }> {
    const results: Array<{ table: string; id: string; pheromones: Record<string, number> }> = [];

    for (const table of ['services', 'projects', 'sessions', 'agents']) {
      if (!ALLOWED_TABLES.has(table)) continue;
      try {
        const rows = db.prepare(`SELECT id, metadata FROM ${table} WHERE metadata IS NOT NULL`).all() as any[];
        for (const row of rows) {
          try {
            const metadata = JSON.parse(row.metadata);
            if (metadata?.pheromones && Object.keys(metadata.pheromones).length > 0) {
              results.push({ table, id: row.id, pheromones: metadata.pheromones });
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
    list,
  };
}
