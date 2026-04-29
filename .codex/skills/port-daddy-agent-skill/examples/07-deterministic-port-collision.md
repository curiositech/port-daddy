# 07 — Deterministic Port "Collision"

**Scenario:** You wanted port 3000 for your dev server. `pd claim` gave you 3142. Or: two services on the same machine want overlapping port ranges.

The first complaint is usually a misunderstanding. The second is real.

## The misunderstanding

> "I asked for port 3000, but PD gave me a different one."

PD doesn't honor port preferences. **The identity is the request; the port is the response.** Same identity → same port, every time. Different identity → different port.

```bash
pd claim myapp:api:main          # always X
pd claim myapp:api:feature-auth  # always Y (different from X)
pd claim myapp:web:main          # always Z (different from both)
```

If you really want port 3000, you've left the contract. The fix is to bind your dev server to whatever PD returned and update the URL once:

```bash
PORT=$(pd claim myapp:api:main -q)
echo "API at http://localhost:$PORT"
npm run dev -- --port "$PORT"
```

If a downstream tool hardcodes 3000, fix the tool — don't fight PD. PD also exposes DNS:

```bash
pd dns myapp.local                   # resolves to whatever port myapp:api:main has
```

## The actual collision

> "Two services on the same daemon want the same port."

The hash function is deterministic but the port range is finite. Real collisions happen, especially with short identities. PD handles this with **bumping**: if the hashed port is already claimed by a *different* identity, the daemon picks the next free slot in the range and stores that mapping.

You don't have to do anything for this — but you should be aware:

- The mapping is now in `port-registry.db`, not pure hashing. Rebuilding the DB will rehash; bumped ports may move.
- `pd find <identity>` is the source of truth. **Never assume a port from the identity hash** — read it.

```bash
# Wrong:
PORT=$(echo "myapp:api:main" | sha256sum | ...)  # don't

# Right:
PORT=$(pd claim myapp:api:main -q)               # claim is idempotent; reads if exists
```

## Identity hygiene to avoid bumps

| Anti-pattern | Why it bumps | Fix |
|---|---|---|
| Single-segment identities (`api`) | Tiny namespace; collisions everywhere. | Always at least `project:stack`. |
| Reused context across projects (`*:api:main` everywhere) | The `:main` segment is the same string; hash collides on prefix. | Project-prefix everything. |
| Renaming repos without re-claiming | Old identity still claims old port; new identity gets a new port. | After rename, `pd release <old>` then `pd claim <new>`. |

## Releasing and reusing

```bash
pd release myapp:api:feature-auth
# the port is freed; if you `pd claim` the same identity again, you'll get the same port back
# (or a bump-shifted one if someone else grabbed it in the meantime)
```

## Inspecting the table

```bash
pd services                          # everything claimed right now
pd find 'myapp:*' --json | jq        # one project's services
sqlite3 port-registry.db "SELECT identity, port FROM services WHERE released_at IS NULL ORDER BY port;"
```

The DB is the truth. The hash function is just the seed.

## Special case: well-known / system ports

PD reserves < 1024 by default. If you really want port 80 or 443, you're outside the dev-coordination scope of PD — set up your reverse proxy outside, and use PD only for the upstream service identity.

```bash
caddy reverse_proxy localhost:$(pd claim myapp:api:main -q)
```

That's the conventional pattern. Don't make PD a load balancer.
