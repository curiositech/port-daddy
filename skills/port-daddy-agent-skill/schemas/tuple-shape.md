# Tuple Shape & Pattern Grammar

Authoritative source: `lib/tuples.ts`.

## Tuple

A tuple is a JSON array of arbitrary values. Convention: first element is a **kind tag** (string), the rest are payload fields.

```json
["task", "build-auth", "pending"]
["connection", "trie+pubsub=routing", "spider", 0.9]
["finding", "src/auth.ts", "sql-injection", "high", "spotted by qa"]
```

Stored shape:

```ts
interface Tuple {
  id: number              // assigned by daemon
  harbor: string | null   // namespace; null = global
  fields: unknown[]       // the array you wrote
  written_by?: string     // agent identity
  created_at: number      // epoch ms
  expires_at?: number     // epoch ms; null = no TTL
}
```

## Harbor scoping

Tuples are addressable in two namespaces:

- **Global** (`harbor` omitted): visible to every agent on the daemon.
- **Harbor-scoped** (`harbor: "myapp:fleet"`): only visible inside that harbor.

A fleet should always pass `--harbor "$PROJECT:fleet"` so that one project's swarm doesn't read another project's tuples.

## TTL

Pass `ttl_ms` (write API) or `--ttl 60000` (CLI). After expiry the tuple is invisible to reads and reaped by the daemon.

## Pattern grammar (`pd tuple rd`, `pd tuple in`)

Patterns are also JSON arrays. Each position is matched independently:

| Pattern element | Matches |
|---|---|
| Literal value (`"task"`, `42`, `true`) | Exact equality. |
| `"*"` (string asterisk) | Any value at that position. |
| `">N"` / `"<N"` / `">=N"` / `"<=N"` (string) | Numeric comparison; tuple element must be a number. |
| Missing trailing positions | Treated as `*`. (Match by prefix.) |

Examples:

```bash
# Read every "connection" tuple from spider with confidence > 0.7
pd tuple rd '["connection", "*", "spider", ">0.7"]' --harbor myapp:fleet

# Take (atomic read+remove) the next pending build task
pd tuple in '["task", "*", "pending"]' --harbor myapp:fleet

# Scan everything in a harbor
pd tuple scan --harbor myapp:fleet
```

## Read vs Take

- `tuple rd` (HTTP `GET /tuples`) — non-destructive. Multiple agents can read the same tuple.
- `tuple in` (HTTP `DELETE /tuples`) — atomic read-and-remove. Only one agent claims it. This is the **work-stealing** primitive.

If you want fan-out, write once and let everyone `rd`.
If you want one-of-N, write once and have workers `in`.

## Anti-patterns

| Wrong | Right | Why |
|---|---|---|
| Storing big blobs (file contents, full diffs) | Store a path or a content-hash | Tuples sit in SQLite; large rows slow down pattern matching. |
| Using tuple-space as a queue without a kind tag | Always tag: `["task", ...]`, `["finding", ...]` | Patterns rely on the leading tag to disambiguate. |
| Writing without a harbor in a fleet | Pass `--harbor "$PROJECT:fleet"` | Cross-project bleed and noise. |
| Long-lived tuples that should expire | Always set TTL on transient state | The space is a board, not a database. |
