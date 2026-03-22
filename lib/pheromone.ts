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

  /**
   * Run one evaporation cycle.
   * Scans all services, projects, and sessions for pheromones in metadata.
   */
  function evaporate() {
    try {
      const tables = ['services', 'projects', 'sessions'];

      for (const table of tables) {
        if (!ALLOWED_TABLES.has(table)) {
          throw new Error(`pheromone: invalid table name: ${table}`);
        }
        try {
          const rows = db.prepare(`SELECT id, metadata FROM ${table} WHERE metadata IS NOT NULL`).all() as any[];
          
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
                
                if (changed) {
                  db.prepare(`UPDATE ${table} SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), row.id);
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

  let timer: NodeJS.Timeout | null = null;

  return {
    start() {
      if (timer) return;
      timer = setInterval(evaporate, config.intervalMs);
      console.error(`🧪 Pheromone Evaporator active (decay: ${config.decayRate}, interval: ${config.intervalMs}ms)`);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    evaporateNow: evaporate
  };
}
