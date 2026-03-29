/**
 * Semantic Trie — In-Memory Prefix Tree for Port Daddy
 *
 * Adaptive Radix Tree optimized for semantic identity lookups:
 *   project:stack:context
 *
 * Replaces SQL LIKE '%pattern%' queries with O(k) prefix lookups
 * where k is the length of the key, not the number of entries.
 *
 * Supports:
 *   - Exact lookup: trie.get('myapp:api:main')
 *   - Prefix search: trie.prefix('myapp:*') → all tokens under myapp
 *   - Wildcard match: trie.match('myapp:*:main') → all stacks with main context
 *   - Insert/delete with metadata
 *   - Harbor bitmask filtering (future: O(1) scope checks)
 *   - 1:N values per key via entryId (multiple agents can share an identity)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrieEntry<T = unknown> {
  key: string;
  entryId?: string;   // For 1:N keys — dedup identifier
  value: T;
  harbors?: bigint;   // 64-bit bitmask for harbor membership
  insertedAt: number;
}

interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  entries: TrieEntry<T>[];
  /** Cumulative harbor bitmask of all descendants (for branch pruning) */
  harborMask: bigint;
  /** Count of entries in this subtree */
  size: number;
}

// ─── Trie Implementation ────────────────────────────────────────────────────

export function createTrie<T = unknown>() {
  const root: TrieNode<T> = {
    children: new Map(),
    entries: [],
    harborMask: 0n,
    size: 0,
  };

  const SEPARATOR = ':';

  function getSegments(key: string): string[] {
    return key.split(SEPARATOR);
  }

  /**
   * Insert a key-value pair into the trie.
   *
   * Without entryId: 1:1 mode — overwrites existing entry at this key (backward compat).
   * With entryId: 1:N mode — multiple entries per key, deduped by entryId.
   */
  function insert(key: string, value: T, harbors?: bigint, entryId?: string): void {
    const segments = getSegments(key);
    let node = root;

    for (const seg of segments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          children: new Map(),
          entries: [],
          harborMask: 0n,
          size: 0,
        });
      }
      node = node.children.get(seg)!;
    }

    const newEntry: TrieEntry<T> = {
      key, value, harbors: harbors ?? 0n, insertedAt: Date.now(), entryId,
    };
    let sizeChanged = false;

    if (entryId !== undefined) {
      // 1:N mode: dedup by entryId
      const existingIdx = node.entries.findIndex(e => e.entryId === entryId);
      if (existingIdx >= 0) {
        node.entries[existingIdx] = newEntry;
      } else {
        node.entries.push(newEntry);
        sizeChanged = true;
      }
    } else {
      // 1:1 mode: overwrite first entry (backward compat)
      if (node.entries.length === 0) {
        node.entries.push(newEntry);
        sizeChanged = true;
      } else {
        node.entries[0] = newEntry;
      }
    }

    // Update sizes and harbor masks up the path
    if (sizeChanged) {
      let updateNode = root;
      updateNode.size++;
      if (harbors) updateNode.harborMask |= harbors;
      for (const seg of segments) {
        updateNode = updateNode.children.get(seg)!;
        updateNode.size++;
        if (harbors) updateNode.harborMask |= harbors;
      }
    } else if (harbors) {
      // Just update harbor masks
      let updateNode = root;
      updateNode.harborMask |= harbors;
      for (const seg of segments) {
        updateNode = updateNode.children.get(seg)!;
        updateNode.harborMask |= harbors;
      }
    }
  }

  /**
   * Exact lookup — returns the first entry at this key (backward compat).
   */
  function get(key: string): TrieEntry<T> | null {
    const segments = getSegments(key);
    let node = root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) return null;
      node = child;
    }

    return node.entries.length > 0 ? node.entries[0] : null;
  }

  /**
   * Get ALL entries at a key (for 1:N lookups).
   */
  function getAll(key: string): TrieEntry<T>[] {
    const segments = getSegments(key);
    let node = root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) return [];
      node = child;
    }

    return [...node.entries];
  }

  /**
   * Delete ALL entries at a key. Returns true if any existed.
   */
  function remove(key: string): boolean {
    const segments = getSegments(key);
    const path: TrieNode<T>[] = [root];
    let node = root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) return false;
      path.push(child);
      node = child;
    }

    if (node.entries.length === 0) return false;
    const removedCount = node.entries.length;
    node.entries = [];

    // Update sizes
    for (const n of path) n.size -= removedCount;

    // Prune empty leaf nodes (bottom-up)
    for (let i = segments.length - 1; i >= 0; i--) {
      const parent = path[i];
      const child = path[i + 1];
      if (child.size === 0 && child.children.size === 0) {
        parent.children.delete(segments[i]);
      } else {
        break;
      }
    }

    return true;
  }

  /**
   * Remove a specific entry by entryId from a key. Returns true if found.
   * For 1:N keys where you need to remove one agent without affecting others.
   */
  function removeEntry(key: string, entryId: string): boolean {
    const segments = getSegments(key);
    const path: TrieNode<T>[] = [root];
    let node = root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) return false;
      path.push(child);
      node = child;
    }

    const idx = node.entries.findIndex(e => e.entryId === entryId);
    if (idx < 0) return false;

    node.entries.splice(idx, 1);

    // Update sizes
    for (const n of path) n.size--;

    // Prune empty leaf nodes if this key is now empty
    if (node.entries.length === 0) {
      for (let i = segments.length - 1; i >= 0; i--) {
        const parent = path[i];
        const child = path[i + 1];
        if (child.size === 0 && child.children.size === 0) {
          parent.children.delete(segments[i]);
        } else {
          break;
        }
      }
    }

    return true;
  }

  /**
   * Prefix search: find all entries whose key starts with the given prefix.
   * Supports wildcard segments: 'myapp:*' matches all stacks under myapp.
   */
  function prefix(pattern: string, harborFilter?: bigint): TrieEntry<T>[] {
    const results: TrieEntry<T>[] = [];
    const segments = getSegments(pattern.replace(/\*$/, '').replace(/:$/, ''));

    // Navigate to the prefix node
    let node = root;
    for (const seg of segments) {
      if (seg === '' || seg === '*') break;
      const child = node.children.get(seg);
      if (!child) return results;

      // Harbor bitmask pruning: skip branches that don't contain the target harbor
      if (harborFilter && !(child.harborMask & harborFilter)) return results;

      node = child;
    }

    // Collect all entries under this node
    collectEntries(node, results, harborFilter);
    return results;
  }

  /**
   * Wildcard match: 'myapp:*:main' matches any middle segment.
   * Supports multiple wildcards: '*:api:*'
   */
  function match(pattern: string, harborFilter?: bigint): TrieEntry<T>[] {
    const segments = getSegments(pattern);
    const results: TrieEntry<T>[] = [];
    matchRecursive(root, segments, 0, results, harborFilter);
    return results;
  }

  function matchRecursive(
    node: TrieNode<T>,
    segments: string[],
    depth: number,
    results: TrieEntry<T>[],
    harborFilter?: bigint
  ): void {
    if (depth === segments.length) {
      for (const entry of node.entries) {
        if (!harborFilter || (entry.harbors && (entry.harbors & harborFilter))) {
          results.push(entry);
        }
      }
      return;
    }

    const seg = segments[depth];

    if (seg === '*') {
      // Wildcard: try all children
      for (const [, child] of node.children) {
        if (harborFilter && !(child.harborMask & harborFilter)) continue;
        matchRecursive(child, segments, depth + 1, results, harborFilter);
      }
    } else {
      // Exact segment match
      const child = node.children.get(seg);
      if (child) {
        if (harborFilter && !(child.harborMask & harborFilter)) return;
        matchRecursive(child, segments, depth + 1, results, harborFilter);
      }
    }
  }

  function collectEntries(node: TrieNode<T>, results: TrieEntry<T>[], harborFilter?: bigint): void {
    for (const entry of node.entries) {
      if (!harborFilter || (entry.harbors && (entry.harbors & harborFilter))) {
        results.push(entry);
      }
    }
    for (const [, child] of node.children) {
      if (harborFilter && !(child.harborMask & harborFilter)) continue;
      collectEntries(child, results, harborFilter);
    }
  }

  /**
   * Get all entries in the trie.
   */
  function all(): TrieEntry<T>[] {
    const results: TrieEntry<T>[] = [];
    collectEntries(root, results);
    return results;
  }

  /**
   * Total number of entries.
   */
  function size(): number {
    return root.size;
  }

  /**
   * Clear the entire trie.
   */
  function clear(): void {
    root.children.clear();
    root.entries = [];
    root.harborMask = 0n;
    root.size = 0;
  }

  /**
   * Debug: return the trie structure as a nested object.
   */
  function dump(): unknown {
    function dumpNode(node: TrieNode<T>): unknown {
      const result: Record<string, unknown> = {};
      if (node.entries.length === 1) result['_entry'] = node.entries[0].key;
      if (node.entries.length > 1) result['_entries'] = node.entries.map(e => e.entryId ?? e.key);
      if (node.size) result['_size'] = node.size;
      for (const [key, child] of node.children) {
        result[key] = dumpNode(child);
      }
      return result;
    }
    return dumpNode(root);
  }

  return {
    insert,
    get,
    getAll,
    remove,
    removeEntry,
    prefix,
    match,
    all,
    size,
    clear,
    dump,
  };
}

export type SemanticTrie<T = unknown> = ReturnType<typeof createTrie<T>>;
