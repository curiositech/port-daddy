/**
 * Semantic Index — In-memory trie backed by SQLite
 *
 * Maintains a live index of all semantic identities in the daemon.
 * Populated from SQLite on startup, updated on every register/claim/release.
 * Provides O(k) wildcard lookups instead of SQL LIKE scans.
 *
 * Supports 1:N entries per key via entryId — multiple agents can share
 * the same identity, and each can be independently removed.
 */

import type Database from 'better-sqlite3';
import { createTrie, type SemanticTrie } from './trie.js';

export interface IndexEntry {
  type: 'service' | 'agent' | 'session' | 'harbor';
  id: string;
  identity: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

// ─── SQLite row shapes (typed instead of `as any[]`) ─────────────────────────

interface ServiceRow {
  id: string;
  metadata: string | null;
}

interface AgentRow {
  id: string;
  identity_project: string | null;
  identity_stack: string | null;
  identity_context: string | null;
  status: string;
}

interface SessionRow {
  id: string;
  identity_project: string | null;
  status: string;
}

interface HarborRow {
  name: string;
  scope: string | null;
}

export function createSemanticIndex(db: Database.Database) {
  const trie: SemanticTrie<IndexEntry> = createTrie();
  let initialized = false;

  /**
   * Load all existing identities from SQLite into the trie.
   * Called once at daemon startup.
   */
  function initialize(): void {
    if (initialized) return;

    // Services (semantic IDs) — 1:1 keys (no entryId needed)
    try {
      const services = db.prepare('SELECT id, metadata FROM services').all() as ServiceRow[];
      for (const s of services) {
        trie.insert(s.id, { type: 'service', id: s.id, identity: s.id });
      }
    } catch (err) {
      // Table may not exist yet during early init; safe to skip
      console.error('[SemanticIndex] Skipping services:', (err as Error).message);
    }

    // Agents (with semantic identity) — 1:N keys (use agent ID as entryId)
    try {
      const agents = db.prepare(
        'SELECT id, identity_project, identity_stack, identity_context, status FROM agents'
      ).all() as AgentRow[];
      for (const a of agents) {
        const identity = [a.identity_project, a.identity_stack, a.identity_context]
          .filter(Boolean).join(':');
        if (identity) {
          trie.insert(identity, {
            type: 'agent', id: a.id, identity, status: a.status,
          }, undefined, a.id);
        }
      }
    } catch (err) {
      console.error('[SemanticIndex] Skipping agents:', (err as Error).message);
    }

    // Sessions (with identity_project) — 1:N keys (use session ID as entryId)
    try {
      const sessions = db.prepare(
        "SELECT id, identity_project, status FROM sessions WHERE status = 'active'"
      ).all() as SessionRow[];
      for (const s of sessions) {
        if (s.identity_project) {
          trie.insert(s.identity_project, {
            type: 'session', id: s.id, identity: s.identity_project, status: s.status,
          }, undefined, s.id);
        }
      }
    } catch (err) {
      console.error('[SemanticIndex] Skipping sessions:', (err as Error).message);
    }

    // Harbors — 1:1 keys
    try {
      const harbors = db.prepare('SELECT name, scope FROM harbors').all() as HarborRow[];
      for (const h of harbors) {
        trie.insert(h.name, { type: 'harbor', id: h.name, identity: h.name });
      }
    } catch (err) {
      console.error('[SemanticIndex] Skipping harbors:', (err as Error).message);
    }

    initialized = true;
    console.error(`[SemanticIndex] Loaded ${trie.size()} entries from SQLite`);
  }

  /**
   * Index a new entry. For 1:1 keys (services), omit entryId.
   * For 1:N keys (agents, sessions), pass the entity's unique ID as entryId.
   */
  function index(identity: string, entry: IndexEntry, entryId?: string): void {
    trie.insert(identity, entry, undefined, entryId);
  }

  /**
   * Remove ALL entries at an identity key (1:1 removal for services).
   */
  function unindex(identity: string): boolean {
    return trie.remove(identity);
  }

  /**
   * Remove a specific entry by entryId from an identity key.
   * For 1:N keys where you need to remove one agent without affecting others.
   */
  function unindexEntry(identity: string, entryId: string): boolean {
    return trie.removeEntry(identity, entryId);
  }

  /**
   * Exact lookup — returns the first entry (backward compat).
   */
  function lookup(identity: string): IndexEntry | null {
    const entry = trie.get(identity);
    return entry ? entry.value : null;
  }

  /**
   * Get ALL entries at an exact identity key (for 1:N lookups).
   */
  function lookupAll(identity: string): IndexEntry[] {
    return trie.getAll(identity).map(e => e.value);
  }

  /**
   * Find all entries matching a pattern (supports * wildcards).
   */
  function find(pattern: string): IndexEntry[] {
    if (pattern.includes('*')) {
      if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
        // Simple prefix: 'myapp:*' or 'myapp:api:*'
        return trie.prefix(pattern).map(e => e.value);
      }
      // Complex wildcard: 'myapp:*:main' or '*:api:*'
      return trie.match(pattern).map(e => e.value);
    }
    // Exact match — return ALL entries at this key (not just first)
    return trie.getAll(pattern).map(e => e.value);
  }

  /**
   * Get all indexed entries.
   */
  function all(): IndexEntry[] {
    return trie.all().map(e => e.value);
  }

  return {
    initialize,
    index,
    unindex,
    unindexEntry,
    lookup,
    lookupAll,
    find,
    all,
    size: () => trie.size(),
    dump: () => trie.dump(),
  };
}

export type SemanticIndex = ReturnType<typeof createSemanticIndex>;
