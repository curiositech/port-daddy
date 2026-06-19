# 0003. Semantic Identity System (`project:stack:context`)

## Status

Accepted

## Context

A port management system needs a way to identify services. The naive approach — "just use a number" — breaks down immediately in multi-agent, multi-project development. An agent running `myapp`'s API server needs to reliably get the same port across daemon restarts. A developer working on two projects simultaneously needs port assignments that do not collide. An orchestration command like "restart all services for `myapp`" needs to know which services belong to `myapp`.

Early iterations of Port Daddy used arbitrary string identifiers with no structure. This led to:

- Name collisions between projects (two projects both using `api` as a service name)
- No way to query "all services for project X" — you had to know the exact names
- No convention for agents to discover each other's ports
- Wildcard releases (`pd release myapp:*`) were not possible

The system needed an identity format that was hierarchical, human-readable, and queryable.

## Decision Drivers

- **Collision resistance**: Two different projects should not be able to accidentally claim the same service identity.
- **Queryability**: It must be possible to list, release, or filter all services under a project or project+stack without knowing exact names.
- **Human-readable**: Developers and agents read these identities in logs, CLIs, and dashboards. They must be self-describing.
- **Wildcards**: Patterns like `myapp:*` (all stacks) and `myapp:api:*` (all contexts for the API stack) must work.
- **Brevity**: Partial identities should be valid — `myapp` and `myapp:api` should both be legal, not require filling out all three segments.
- **Database-friendly**: The format should map naturally to SQL `LIKE` patterns without escaping nightmares.

## Considered Options

### Option A: Three-segment colon-delimited string — `project:stack:context`

A hierarchical string with up to three segments separated by colons.

- `myapp` — just the project
- `myapp:api` — project + stack (the service type)
- `myapp:api:main` — project + stack + context (typically the branch or environment)

Wildcards use `*`: `myapp:*`, `*:frontend:*`.

**Pros:**
- Self-describing at a glance
- Maps directly to SQL `LIKE` patterns (`myapp:%` for all stacks)
- Partial identities are valid — agents can use just `project` or `project:stack`
- Consistent with semantic versioning and other hierarchical identifier systems that developers are familiar with
- The three levels correspond naturally to real development concerns: what project, what service type, what branch/context

**Cons:**
- Colon is not valid in some path-based contexts (Windows filenames), though Port Daddy is scoped to macOS/Linux dev environments
- Three levels may feel like overkill for simple single-stack projects

### Option B: URL-style path — `/project/stack/context`

Use forward-slash hierarchy (like URL paths).

**Pros:**
- Familiar from filesystem and URL contexts

**Cons:**
- Forward slashes in service identifiers create problems in HTTP route parameters (e.g., `/services/myapp/api/main` becomes ambiguous with `/services/:id` where `id = myapp`)
- Must be URL-encoded in API calls, reducing readability
- Does not map cleanly to SQL patterns

### Option C: Dot-notation — `project.stack.context`

Similar to Java package naming or DNS reverse notation.

**Pros:**
- Familiar from DNS and package naming

**Cons:**
- Dots are already used in version strings and domain names, creating ambiguity
- Less readable than colons in terminal output where dot-delimited strings appear frequently

### Option D: Flat arbitrary strings with prefix convention

Let users choose any string and rely on a community convention like `project-stack-context`.

**Pros:**
- Maximum flexibility

**Cons:**
- No enforced structure means no queryability
- Pattern releases require regex or glob matching, not simple SQL `LIKE`
- Agents cannot reliably discover each other's services without out-of-band coordination

### Option E: UUID-based identifiers

Assign UUIDs and maintain a separate name registry.

**Pros:**
- Guaranteed uniqueness

**Cons:**
- Not human-readable — agents and developers cannot tell what a UUID refers to without a lookup
- Destroys the self-describing property that makes the system useful in logs and dashboards
- Adds indirection for no benefit in a single-machine tool

## Decision

Use a **three-segment colon-delimited hierarchical identity** — `project:stack:context` — as the universal identifier for all services, agents, and other resources.

The segments have defined semantics:
- **project**: The repository or application name (`myapp`, `windags`, `port-daddy`)
- **stack**: The service type within the project (`api`, `frontend`, `worker`, `db`)
- **context**: The instance qualifier, typically the git branch or environment (`main`, `feature-auth`, `staging`)

Partial identities are valid and normalized: `myapp` is equivalent to claiming `myapp` as the project with no stack or context. The parser in `lib/identity.ts` handles all three cases and enforces character validation (`[a-zA-Z0-9._*-]+`, max 64 chars per segment, max 3 segments).

Wildcards use `*` and are translated to SQL `%` for database queries via `patternToSql()` in `lib/identity.ts`. The pattern `myapp:*` becomes the SQL `LIKE 'myapp:%'`.

Identities are stored as normalized strings in the database (`project:stack:context` joined with colons, trailing null segments omitted). For agent registration, the three components are additionally stored in separate columns (`identity_project`, `identity_stack`, `identity_context`) to enable indexed prefix queries without string parsing in SQL.

## Rationale

The colon delimiter was chosen over slash (URL conflicts), dot (ambiguity with domain names), and dash (too flat) because it is unambiguous in HTTP routes, terminal output, and SQL patterns. Three levels was chosen because it maps exactly to the three dimensions of real development contexts: which application, which service type, and which instance/branch.

The fact that all three segments are optional makes the system approachable for simple projects. A developer with a single-service project can use just `myproject` and get a stable port without thinking about stacks or contexts.

The SQL mapping is elegant: `WHERE id LIKE 'myapp:%'` finds all services for a project; `WHERE id LIKE 'myapp:api:%'` finds all instances of the API stack. This is implemented in `lib/identity.ts:patternToSql()` and used throughout `lib/services.ts`, `lib/agents.ts`, and `lib/resurrection.ts`.

## Consequences

### Positive

- Wildcard operations work across the entire system: `pd release myapp:*` releases all services; `pd salvage --project myapp` shows only dead agents working on `myapp`
- Agent discovery is implicit: if two agents both use `myapp:api:main`, the second one knows the port the first one is using
- Logs, dashboards, and CLI output are self-describing — reading `myapp:api:feature-auth` instantly tells a developer what they are looking at
- The identity parser (`lib/identity.ts`) is shared across services, agents, and locks — one parsing implementation, consistent behavior everywhere
- `pd salvage --project myapp` is implementable: the `identity_project` column is indexed and queryable without parsing stored strings

### Negative

- The `project:stack:context` convention must be learned — it is not immediately obvious to first-time users what the three segments mean
- Identity collisions are still possible across teams on the same machine if they use the same project name (e.g., two developers both working on a project named `api`). This is mitigated by project-specific conventions.
- Segments are validated but not semantically enforced — `myapp:potato:snozzberry` is valid even if it makes no sense

### Neutral

- The maritime module (`lib/maritime.ts`) uses the identity format for its channel highlighting system, coloring each segment of a `scope:topic:qualifier` string differently in terminal output — cyan for scope, yellow for topic, green for qualifier.
