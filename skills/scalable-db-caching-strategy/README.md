# Scalable DB Caching Strategy

Decides whether a scaling, database-backed web app actually needs a cache layer (typically Redis)
and where to place it — diagnosing query/index/N+1 problems first, then choosing cache-aside vs
write-through and TTL vs event-based invalidation at the right granularity. This is a decision skill:
it tells you *whether* and *where* to cache, not how to implement deep invalidation mechanics or
multi-tier CDN architecture (see the `pairs-with` skills in SKILL.md frontmatter for those).

## Structure

```
scalable-db-caching-strategy/
├── SKILL.md                              # Core decision tree, patterns, anti-patterns (<500 lines)
├── CHANGELOG.md                          # Version history
├── README.md                             # This file
└── references/
    ├── query-fix-first.md                # Step 1 diagnostic checklist (index/N+1/pagination)
    └── stampede-and-eviction.md          # Step 5 implementation: single-flight lock,
                                           # probabilistic early expiration, maxmemory-policy
```

## Quick Start

1. Read SKILL.md's Core Process — it walks the query-fix-vs-cache decision, then cache-aside vs
   write-through, then TTL vs event-based invalidation, in that order.
2. If you're stuck diagnosing whether the slow endpoint is actually a query problem, open
   `references/query-fix-first.md`.
3. Once caching is justified and you're implementing it, open `references/stampede-and-eviction.md`
   for stampede mitigation code and `maxmemory-policy` guidance.
4. Check the Anti-Patterns section in SKILL.md before shipping a caching proposal — it covers the
   four most common mistakes (caching a bad query, wrong-granularity caching, unbounded key growth,
   defaulting to write-behind).
