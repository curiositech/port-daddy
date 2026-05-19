/**
 * Daemon-wide Config — small key/value store for operator-tunable knobs.
 *
 * The project-local `.portdaddyrc` (lib/config.ts) handles per-project
 * services + port ranges. This module handles daemon-wide knobs that don't
 * belong in any specific project's rc: spawn depth caps, default gather
 * policies, etc. Stored in a tiny SQLite table so every CLI invocation /
 * SDK call / route handler reads the same source of truth without an
 * environment-variable juggling act.
 *
 * Keys are whitelisted with type + range validation. Random unknown keys
 * are refused at write time so a typo can't silently get persisted as the
 * wrong knob; this also gives the operator a discoverable `pd config list`
 * surface that's the entire schema, not "anything anyone has ever written".
 */

import type { DatabaseInstance } from './sqlite-runtime.js';

export const DAEMON_CONFIG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS daemon_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    type TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

export type ConfigValueType = 'number' | 'string' | 'boolean';

export interface ConfigKeySpec {
  key: string;
  type: ConfigValueType;
  description: string;
  default: number | string | boolean;
  /** Optional bounds for `type: 'number'`. Inclusive on both ends. */
  min?: number;
  max?: number;
  /** Optional allow-list for `type: 'string'`. */
  oneOf?: string[];
}

/**
 * The full schema of supported daemon-config keys. Adding a key here is the
 * single source of truth — the route, the CLI, and the validator all
 * derive from this table.
 */
export const DAEMON_CONFIG_KEYS: Record<string, ConfigKeySpec> = {
  'spawn.max_depth': {
    key: 'spawn.max_depth',
    type: 'number',
    description: 'Maximum spawn ancestry depth before refusal (cycle/runaway guard).',
    default: 4,
    min: 1,
    max: 32,
  },
};

export interface DaemonConfigRow {
  key: string;
  value: number | string | boolean;
  type: ConfigValueType;
  spec: ConfigKeySpec;
  isDefault: boolean;
  updatedAt: number | null;
}

export class ConfigKeyError extends Error {
  readonly code = 'CONFIG_KEY';
  constructor(message: string) {
    super(message);
  }
}

export class ConfigValueError extends Error {
  readonly code = 'CONFIG_VALUE';
  constructor(message: string) {
    super(message);
  }
}

export interface DaemonConfig {
  /** Returns the typed value (or the spec default if unset). Throws on unknown keys. */
  get(key: string): number | string | boolean;
  /** Convenience: numeric getter with caller-supplied fallback (handles unknown keys gracefully). */
  getNumber(key: string, fallback: number): number;
  /** Convenience: boolean getter with caller-supplied fallback. */
  getBoolean(key: string, fallback: boolean): boolean;
  /** Set a value. Validates type + bounds. Throws ConfigKeyError / ConfigValueError. */
  set(key: string, rawValue: unknown): DaemonConfigRow;
  /** Remove an override so the spec default takes over again. */
  unset(key: string): void;
  /** List every known key with its current value (or default) and metadata. */
  list(): DaemonConfigRow[];
  /** Schema lookup. */
  spec(key: string): ConfigKeySpec | null;
}

function ensureSchema(db: DatabaseInstance): void {
  db.exec(DAEMON_CONFIG_SCHEMA_SQL);
}

function parseStoredValue(spec: ConfigKeySpec, raw: string): number | string | boolean {
  switch (spec.type) {
    case 'number': {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        throw new ConfigValueError(
          `daemon_config row for '${spec.key}' has non-numeric value '${raw}'. ` +
          `Run: pd config unset ${spec.key} to restore the default (${spec.default}).`,
        );
      }
      return n;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'string':
      return raw;
  }
}

function coerceAndValidate(spec: ConfigKeySpec, rawValue: unknown): { value: number | string | boolean; serialized: string } {
  switch (spec.type) {
    case 'number': {
      let n: number;
      if (typeof rawValue === 'number') n = rawValue;
      else if (typeof rawValue === 'string' && rawValue.trim()) n = Number(rawValue);
      else {
        throw new ConfigValueError(`'${spec.key}' expects a number (got ${typeof rawValue}).`);
      }
      if (!Number.isFinite(n)) {
        throw new ConfigValueError(`'${spec.key}' must be a finite number (got '${rawValue}').`);
      }
      if (!Number.isInteger(n) && spec.min !== undefined && spec.max !== undefined) {
        // Most daemon knobs are integers; if a spec wants a float it can omit min/max
        // or we can add a `float` type later.
        throw new ConfigValueError(`'${spec.key}' must be an integer (got ${n}).`);
      }
      if (spec.min !== undefined && n < spec.min) {
        throw new ConfigValueError(`'${spec.key}' must be >= ${spec.min} (got ${n}).`);
      }
      if (spec.max !== undefined && n > spec.max) {
        throw new ConfigValueError(`'${spec.key}' must be <= ${spec.max} (got ${n}).`);
      }
      return { value: n, serialized: String(n) };
    }
    case 'boolean': {
      let b: boolean;
      if (typeof rawValue === 'boolean') b = rawValue;
      else if (typeof rawValue === 'string') {
        const t = rawValue.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(t)) b = true;
        else if (['false', '0', 'no', 'off'].includes(t)) b = false;
        else throw new ConfigValueError(`'${spec.key}' must be a boolean (got '${rawValue}').`);
      } else {
        throw new ConfigValueError(`'${spec.key}' must be a boolean (got ${typeof rawValue}).`);
      }
      return { value: b, serialized: b ? 'true' : 'false' };
    }
    case 'string': {
      if (typeof rawValue !== 'string') {
        throw new ConfigValueError(`'${spec.key}' must be a string (got ${typeof rawValue}).`);
      }
      if (spec.oneOf && !spec.oneOf.includes(rawValue)) {
        throw new ConfigValueError(
          `'${spec.key}' must be one of: ${spec.oneOf.join(', ')} (got '${rawValue}').`,
        );
      }
      return { value: rawValue, serialized: rawValue };
    }
  }
}

export function createDaemonConfig(db: DatabaseInstance): DaemonConfig {
  ensureSchema(db);

  const selOne = db.prepare('SELECT key, value, type, updated_at FROM daemon_config WHERE key = ?');
  const selAll = db.prepare('SELECT key, value, type, updated_at FROM daemon_config');
  const upsert = db.prepare(
    'INSERT INTO daemon_config (key, value, type, updated_at) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value=excluded.value, type=excluded.type, updated_at=excluded.updated_at',
  );
  const del = db.prepare('DELETE FROM daemon_config WHERE key = ?');

  function specFor(key: string): ConfigKeySpec {
    const sp = DAEMON_CONFIG_KEYS[key];
    if (!sp) {
      const known = Object.keys(DAEMON_CONFIG_KEYS).sort().join(', ');
      throw new ConfigKeyError(`Unknown daemon config key '${key}'. Known keys: ${known || '(none)'}.`);
    }
    return sp;
  }

  function get(key: string): number | string | boolean {
    const sp = specFor(key);
    const row = selOne.get(key) as { value: string; type: ConfigValueType } | undefined;
    if (!row) return sp.default;
    return parseStoredValue(sp, row.value);
  }

  function getNumber(key: string, fallback: number): number {
    try {
      const v = get(key);
      return typeof v === 'number' ? v : fallback;
    } catch {
      // Unknown key, parse failure, etc. — caller doesn't want to crash.
      return fallback;
    }
  }

  function getBoolean(key: string, fallback: boolean): boolean {
    try {
      const v = get(key);
      return typeof v === 'boolean' ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function set(key: string, rawValue: unknown): DaemonConfigRow {
    const sp = specFor(key);
    const { value, serialized } = coerceAndValidate(sp, rawValue);
    const now = Date.now();
    upsert.run(key, serialized, sp.type, now);
    return { key, value, type: sp.type, spec: sp, isDefault: false, updatedAt: now };
  }

  function unset(key: string): void {
    specFor(key);  // Validate the key exists in the schema.
    del.run(key);
  }

  function list(): DaemonConfigRow[] {
    const rows = selAll.all() as Array<{ key: string; value: string; type: ConfigValueType; updated_at: number }>;
    const overridden = new Map<string, { value: string; updated_at: number }>();
    for (const r of rows) {
      overridden.set(r.key, { value: r.value, updated_at: r.updated_at });
    }
    return Object.values(DAEMON_CONFIG_KEYS).map((sp) => {
      const row = overridden.get(sp.key);
      if (!row) {
        return { key: sp.key, value: sp.default, type: sp.type, spec: sp, isDefault: true, updatedAt: null };
      }
      return {
        key: sp.key,
        value: parseStoredValue(sp, row.value),
        type: sp.type,
        spec: sp,
        isDefault: false,
        updatedAt: row.updated_at,
      };
    });
  }

  function spec(key: string): ConfigKeySpec | null {
    return DAEMON_CONFIG_KEYS[key] ?? null;
  }

  return { get, getNumber, getBoolean, set, unset, list, spec };
}
