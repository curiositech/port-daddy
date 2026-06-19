# Semantic Identity Grammar

Authoritative source: `lib/identity.ts` in the port-daddy repo.

## Grammar

```
identity   = project [ ":" stack [ ":" context ] ]
project    = segment
stack      = segment | "*"
context    = segment | "*"
segment    = 1*64 ( ALPHA / DIGIT / "." / "_" / "-" / "*" )
```

- **At most 3 segments**, separated by `:`. Four or more is a parse error.
- **Allowed character class**: `[a-zA-Z0-9._*-]`. Anything else (whitespace, `/`, emoji) is rejected.
- **Max segment length**: 64 characters. Longer is a parse error.
- **Wildcard**: `*` is valid in any segment for *patterns* (`pd find`, `pd salvage --project`). It is **not** valid for claims — you can't `pd claim foo:*:main`.

## Component Semantics

| Segment | Meaning | Examples |
|---|---|---|
| `project` | The repo / app / system. Stable for the lifetime of the codebase. | `myapp`, `port-daddy`, `bosun` |
| `stack` | The role / layer inside the project. | `api`, `frontend`, `worker`, `db`, `fleet` |
| `context` | The variant — branch, feature, env, agent name. | `main`, `feature-auth`, `staging`, `qa-bot` |

## Determinism

`pd claim <identity>` always returns the same port for the same identity. Never assume a port number — read it from `pd claim ... -q` or `pd find <identity>`.

## Pattern Matching

- `myapp` matches services where `project=myapp` (any stack, any context).
- `myapp:*` matches every stack under `myapp`.
- `myapp:*:main` matches every stack with `context=main`.
- `*:frontend:*` matches every project's frontend.

## Common Mistakes

| Wrong | Right | Why |
|---|---|---|
| `myapp_api_main` | `myapp:api:main` | Underscore is allowed in a segment, but `:` is what makes it queryable as a tree. |
| `myapp/api/main` | `myapp:api:main` | `/` is not in the character class. |
| `MyApp:API:Main` | `myapp:api:main` | Letters are case-sensitive in matching. Lowercase by convention. |
| `claim feature-auth` | `claim myapp:api:feature-auth` | Always namespace under the project so `pd find 'myapp:*'` finds it. |
| Reusing context for two roles | Split on stack | `myapp:api:main` and `myapp:web:main` are correct, not `myapp:main:api` and `myapp:main:web`. |

## Choosing a Context Segment

- **Branch-driven work**: use the branch name (`feature-auth`, `bug-2401`).
- **Environment**: use the env (`staging`, `prod`, `dev`).
- **Per-agent dev daemon or worktree**: use the agent or worktree name (`qa-bot`, `wt-erich`).
- **Single-instance default**: use `main`.

## Quick Validation (in code)

```js
import { parseIdentity } from 'port-daddy/lib/identity'
const r = parseIdentity('myapp:api:feature-auth')
if (!r.valid) throw new Error(r.error)
console.log(r.project, r.stack, r.context, r.hasWildcard)
```
