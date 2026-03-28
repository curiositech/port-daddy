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
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TrieEntry<T = unknown> {
  key: string;
  value: T;
  harbors?: bigint;  // 64-bit bitmask for harbor membership
  insertedAt: number;
}

interface TrieNode<T> {
  children: Map<string, TrieNode<T>>;
  entry: TrieEntry<T> | null;
  /** Cumulative harbor bitmask of all descendants (for branch pruning) */
  harborMask: bigint;
  /** Count of entries in this subtree */
  size: number;
}

// ─── Trie Implementation ────────────────────────────────────────────────────

export function createTrie<T = unknown>() {
  const root: TrieNode<T> = {
    children: new Map(),
    entry: null,
    harborMask: 0n,
    size: 0,
  };

  const SEPARATOR = ':';

  function getSegments(key: string): string[] {
    return key.split(SEPARATOR);
  }

  /**
   * Insert a key-value pair into the trie.
   */
  function insert(key: string, value: T, harbors?: bigint): void {
    const segments = getSegments(key);
    let node = root;

    for (const seg of segments) {
      if (!node.children.has(seg)) {
        node.children.set(seg, {
          children: new Map(),
          entry: null,
          harborMask: 0n,
          size: 0,
        });
      }
      node = node.children.get(seg)!;
    }

    const isNew = node.entry === null;
    node.entry = { key, value, harbors: harbors ?? 0n, insertedAt: Date.now() };

    // Update sizes and harbor masks up the path
    if (isNew) {
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
   * Exact lookup.
   */
  function get(key: string): TrieEntry<T> | null {
    const segments = getSegments(key);
    let node = root;

    for (const seg of segments) {
      const child = node.children.get(seg);
      if (!child) return null;
      node = child;
    }

    return node.entry;
  }

  /**
   * Delete a key from the trie. Returns true if the key existed.
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

    if (!node.entry) return false;
    node.entry = null;

    // Update sizes
    for (const n of path) n.size--;

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
      if (node.entry) {
        if (!harborFilter || (node.entry.harbors && (node.entry.harbors & harborFilter))) {
          results.push(node.entry);
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
    if (node.entry) {
      if (!harborFilter || (node.entry.harbors && (node.entry.harbors & harborFilter))) {
        results.push(node.entry);
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
    root.entry = null;
    root.harborMask = 0n;
    root.size = 0;
  }

  /**
   * Debug: return the trie structure as a nested object.
   */
  function dump(): unknown {
    function dumpNode(node: TrieNode<T>): unknown {
      const result: Record<string, unknown> = {};
      if (node.entry) result['_entry'] = node.entry.key;
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
    remove,
    prefix,
    match,
    all,
    size,
    clear,
    dump,
  };
}

export type SemanticTrie<T = unknown> = ReturnType<typeof createTrie<T>>;
