# 0012. The Semantic Token Graph & Radix Trie

## Status

Accepted (Deep Engineering Revision)

## Context

AI agents navigate the Port Daddy environment using hierarchical semantic identities (`project:stack:context`). Currently, Port Daddy handles these via fixed database columns and SQL `LIKE` queries. While flexible, this approach has limitations:
- **Query Performance**: Wildcard matching like `myapp:*:web` requires linear SQL scans ($O(N)$), which scale poorly as the agent history grows.
- **Memory Overhead**: A standard Prefix Tree (Trie) for thousands of hierarchical tokens results in high RAM fragmentation and slow lookups due to pointer-chasing across scattered nodes.

## Decision

Implement a **Semantic Token Graph** utilizing an in-memory **Radix Tree** for high-frequency resolution.

### 1. Radix Tree (Compressed Trie)
Instead of a standard Trie where each character or segment is a node, the kernel implements a **Radix Tree** (Compressed Trie).
- **Prefix Collapsing**: Long common prefixes (e.g., `myapp:production:services:`) are collapsed into a single node.
- **Efficiency**: This reduces the total number of node allocations by ~60%, significantly improving CPU cache hit rates during wildcard traversal.

### 2. Harbor Bitmask Filtering
To support multi-tenancy without performance degradation, each Harbor is assigned a unique bit in a large bitmask (e.g., a bitset or 128-bit integer).
- **Node Bloom Filter**: Every node in the Radix Tree stores a cumulative bitmask of all descendant Harbors.
- **Fast Skipping**: When a search is scoped to `myapp:*`, the traversal instantly skips entire subtrees whose bitmasks do not intersect with the `myapp` bit. This allows the resolver to ignore 99% of the tree in high-density environments.

### 3. Lazy Promotion (Function Decomposition)
To prevent the SQLite database from bloating with static analysis data, code symbols (functions, classes) are **NOT** indexed automatically.
- **Interaction Threshold**: A symbol is promoted to a Graph node only after an agent explicitly `claims` it or mentions it in a session note.
- **Semantic Focus**: This ensures the Graph remains a map of **Active Intent** rather than just a mirror of the filesystem.

## Rationale

By moving from string-based SQL queries to a Radix Tree with bitmask skipping, we ensure sub-millisecond wildcard matching even with 100,000+ active tokens. This is the "Hard" invariant required for the Swarm Radio (pub/sub) to operate at agent speeds.

The use of Radix compression is the key engineering trade-off to keep the memory footprint below the 50MB invariant.

## Consequences

### Positive
- **Instant Discovery**: <300μs resolution for complex wildcard paths.
- **Memory Efficiency**: Minimal node fragmentation due to prefix collapsing.
- **Scalability**: Bitmask skipping provides $O(1)$ branch elimination for scoped queries.

### Negative
- **Implementation Complexity**: Building a thread-safe Radix Tree with bitmask propagation is significantly harder than using standard library Maps.
- **Reconstruction**: The Trie must be reconstructed from SQLite on boot (mitigated by asynchronous background loading).

### Neutral
- **Searchable Hive Mind**: The graph enables "Semantic Recall" (e.g., "Which agents have touched symbols called by this file?").
