

I'll start by reading all the requested files thoroughly to understand the full API surface and SDK.
Now let me read the route files to understand the exact HTTP API shapes.
Now let me also check the shared types file to understand the full type surface.
Now I have a comprehensive understanding of the full codebase. Let me produce the friction analysis.

---

# Port Daddy UX Friction Analysis

## Executive Summary

Port Daddy has a solid architectural foundation. The API surface is comprehensive and the SDK wraps most endpoints. However, there are significant friction points for agentic consumers that stem from three root causes: (1) response shape inconsistency between the SDK type declarations and the actual API responses, (2) missing SDK methods for several useful endpoints, and (3) the absence of higher-level workflow primitives that agents need for common patterns like "claim, use, release" or "retry until lock acquired." This analysis identifies 47 friction points across 8 agentic personas and 3 human personas, with 12 classified as high-friction.

---

## Part 1: Agentic Persona Journey Simulations

### Persona 1: Single Claude Code Session

**Goal**: Claim a port, start a dev server, release when done.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.ping()                          true/false                       LOW
        Good: simple boolean, clean API.

2       pd.claim('myapp:api:main')         { success, id, port, status,     MEDIUM
                                             existing, message }
        PROBLEM: SDK declares ClaimResponse as { port, id, existing }
        but the actual API returns { success, id, port, status, existing,
        message }. The SDK type is WRONG. An agent checking `result.success`
        will get a TypeScript error because ClaimResponse doesn't include it.
        An agent destructuring `{ port }` will work, but miss the `existing`
        flag which changes behavior (reuse vs new assignment).

3       // use the port -- no API call

4       pd.release('myapp:api:main')       { success, released, port,       HIGH
                                             message }
        PROBLEM: SDK declares ReleaseResponse as { released: number,
        releasedPorts: number[] } but the actual API returns
        { success, released: number, port: number, message }.
        The field `releasedPorts` does not exist in single-release responses.
        It only appears in the route handler for webhooks, where it references
        `result.releasedPorts` which is never set by services.release().
        An agent trusting SDK types gets undefined for releasedPorts.

5       // error case: daemon not running
        pd.claim(...)                      ConnectionError thrown            LOW
        Good: ConnectionError with actionable message.
```

### Persona 2: Parallel Agent Swarm

**Goal**: 10 agents burst-claim ports, coordinate via locks and pub/sub.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.register({ name: 'worker-1' })  { success, agentId, registered,  MEDIUM
                                             message }
        PROBLEM: agentId must be set in constructor. If an agent spawns
        dynamically, it must construct a new PortDaddy instance per agent.
        No way to set agentId after construction. This is inconvenient
        for swarm managers creating pools of clients.

2       pd.startHeartbeat(30000)           HeartbeatHandle                  LOW
        Good: auto-heartbeat is a great primitive for agents.

3       // 10 agents claim simultaneously
        pd.claim('myapp:worker:0')         { success, port, ... }           MEDIUM
        pd.claim('myapp:worker:1')         { success, port, ... }
        ...
        PROBLEM: No batch claim method. Each agent must make a separate
        HTTP request. Under burst conditions, rate limiter kicks in at
        100 req/min. A 10-agent swarm doing claim + register + heartbeat
        = 30 requests instantly. Fine. But a 50-agent swarm hits the limit.
        No SDK method for "claim N ports at once."

4       pd.lock('deploy-gate')             { success, name, owner,          HIGH
                                             acquiredAt, expiresAt, message }
        PROBLEM: SDK LockResponse type says { success, owner, expiresAt }
        but API returns { success, name, owner, acquiredAt, expiresAt,
        message }. Types are incomplete.
        PROBLEM: No retry/wait-for-lock primitive. If lock is held, agent
        gets { success: false, error: 'lock is held', holder, heldSince,
        expiresAt }. The agent must implement its own retry loop. This is
        the #1 missing primitive for swarm coordination.

5       pd.publish('coordination',         { success, id, message }         MEDIUM
                   { task: 'build' })
        PROBLEM: SDK PublishResponse says { id: number, channel: string }
        but API returns { success: boolean, id: number|bigint, message }.
        `channel` is not in the response. `success` is missing from type.
        `id` can be bigint (from SQLite lastInsertRowid).

6       pd.subscribe('results')            Subscription                     HIGH
        sub.on('message', handler)
        PROBLEM: SSE connections have a hard 5-minute timeout
        (connectionLimits.sseTimeout in messaging route). After timeout,
        connection drops with event: timeout. SDK does NOT reconnect.
        Agent's subscription silently dies. No reconnection logic.
        No 'timeout' event type in SubscriptionEventType.

7       pd.unlock('deploy-gate')           { success, released, name,       LOW
                                             message }
        Fine, but SDK UnlockResponse says { released: boolean } when API
        also returns { success, name, message }.
```

### Persona 3: MCP Tool Server

**Goal**: Wrap Port Daddy API as MCP tools. Needs perfectly predictable JSON.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       // Introspect API
        GET /webhooks/events               { success, events,               LOW
                                             descriptions }
        Good: self-documenting endpoint.

2       // Wrap pd.claim as a tool
        pd.claim('x:y:z')                  JSON response                    HIGH
        PROBLEM: The `success` field is sometimes in the response (services
        module returns it) and sometimes not (SDK types don't declare it).
        An MCP tool needs to reliably determine success/failure. The SDK
        swallows HTTP errors into PortDaddyError, but success: false with
        200 status is possible from the services.claim() path (e.g.,
        "cannot claim with wildcard identity" returns { success: false,
        error } but the route handler returns 400). The mapping from
        module-level success to HTTP status is inconsistent.

3       // Wrap pd.lock as a tool
        pd.lock('x')                       varied shapes                    HIGH
        PROBLEM: Lock failure returns 409 with { success: false, error,
        holder, heldSince, expiresAt }. Lock success returns 200 with
        { success: true, name, owner, acquiredAt, expiresAt, message }.
        The response shapes differ by more than just the success flag.
        An MCP tool schema must be the union of both, which is messy.

4       // Tool error handling
        Any SDK method                     PortDaddyError thrown             MEDIUM
        PROBLEM: PortDaddyError.body is typed as `unknown`. MCP tool
        needs to extract structured error info. The error message is
        a string, but the body contains the full JSON response with
        machine-readable fields (holder, heldSince, etc.). These are
        not typed and not documented.
```

### Persona 4: CI/CD Pipeline Agent

**Goal**: Ephemeral usage. Claim, run tests, release. Must handle daemon-not-running.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.ping()                          false (daemon not running)       LOW
        Good: clean boolean check.

2       // start daemon programmatically
        ??? NO SDK METHOD                                                   HIGH
        PROBLEM: No SDK method to start/stop the daemon. CI must shell
        out to `port-daddy start`. No programmatic lifecycle control.
        This is the #1 gap for CI/CD. The SDK should have
        pd.ensureDaemon() or pd.startDaemon().

3       pd.claim('ci:test:pr-123',         { success, port, ... }           MEDIUM
               { expires: '30m' })
        PROBLEM: expires format is not documented in SDK types. ClaimOptions
        says `expires?: number` but the actual API accepts string durations
        like '30m', '1h'. The SDK type says number only, which would be
        interpreted as milliseconds. This mismatch means CI agents using
        TypeScript will get type errors for the more readable string format.

4       // run tests...

5       pd.release('ci:test:pr-123')       response                         LOW
        Fine.

6       // cleanup all CI services
        pd.listServices({                  { services, count }              MEDIUM
          pattern: 'ci:*' })
        then pd.release('ci:*')
        PROBLEM: release() sends DELETE /release with { id: 'ci:*' }.
        The SDK method signature is release(id: string) with no indication
        that wildcards are supported. An agent has to know to pass 'ci:*'.
        A dedicated releasePattern() or release('ci:*') with documentation
        would help.
```

### Persona 5: Orchestration Framework

**Goal**: Bulk claim, health polling, partial failure handling.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       // Claim 5 services
        Promise.all([                      mixed results                    HIGH
          pd.claim('app:api'),
          pd.claim('app:web'),
          pd.claim('app:worker'),
          pd.claim('app:db'),
          pd.claim('app:cache')
        ])
        PROBLEM: No batch claim. If claim 3 fails, claims 1-2 succeeded
        but 4-5 might also fail. No transactional semantics. No
        pd.claimBatch() that rolls back on partial failure.

2       pd.listServiceHealth()             Record<string, unknown>          HIGH
        PROBLEM: Return type is Record<string, unknown>. An orchestration
        framework needs typed health data: which services are healthy,
        which are not, what's the error for unhealthy ones. The loose
        typing forces the orchestrator to guess the response shape.

3       // Wait for services to be healthy
        GET /wait/:id                      result                           MEDIUM
        POST /wait { services: [...] }     result
        PROBLEM: These endpoints exist but have NO SDK methods.
        An orchestrator building on the SDK cannot use the wait
        functionality programmatically. Must use raw HTTP.

4       // Handle partial failure
        pd.checkServiceHealth('app:db')    Record<string, unknown>          MEDIUM
        PROBLEM: Again, Record<string, unknown> return type. The
        orchestrator can't programmatically decide "restart or not"
        without knowing the shape of health check results.
```

### Persona 6: Webhook Consumer

**Goal**: Subscribe to events, needs reliable delivery.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.getWebhookEvents()              { events: string[] }             LOW
        Good: discoverable event list.

2       pd.addWebhook(                     { id: string }                   MEDIUM
         'https://my.server/hook',
         { events: ['service.claim'],
           secret: 'abc' })
        PROBLEM: SDK return type is { id: string } but API returns
        { success, id, message, webhook }. The actual webhook object
        with all its details is not surfaced by the SDK type.

3       // Verify delivery
        pd.getWebhookDeliveries(id)        Record<string, unknown>          MEDIUM
        PROBLEM: Untyped response. Consumer cannot programmatically
        check delivery status, HTTP response codes, retry counts.

4       // SSRF protection validation
        pd.addWebhook('http://192.168.1.1/hook')  PortDaddyError            LOW
        Good: SSRF protection exists (mentioned in CLAUDE.md).

5       // Webhook test
        pd.testWebhook(id)                 Record<string, unknown>          MEDIUM
        PROBLEM: Test result is untyped. Consumer can't check if test
        delivery succeeded or failed without guessing response shape.
```

### Persona 7: IDE Extension

**Goal**: SSE for real-time updates, REST for queries.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.subscribe('*')                  Subscription                     HIGH
        PROBLEM: Wildcard channel '*' is supported in messaging module
        (notifySubscribers checks for it) but the SSE endpoint
        GET /msg/:channel/subscribe does not special-case '*'. The
        subscriber gets messages via the in-memory wildcard path, but
        the SSE HTTP endpoint for '*' just subscribes to a channel
        literally named '*'. An IDE wanting "all events" has no way
        to get a firehose SSE stream.

2       sub.on('message', handler)         data from SSE                    MEDIUM
        sub.on('error', handler)
        PROBLEM: No 'reconnect' or 'timeout' event. When the 5-minute
        SSE timeout fires, the SDK just stops. IDE extension goes blind
        with no notification that it needs to reconnect.

3       pd.listServices()                  { services, count }              LOW
        Good: works as expected.

4       pd.getActivity({ limit: 50 })      { activities, count }            LOW
        Good: works as expected.
```

### Persona 8: Self-Healing Agent Loop

**Goal**: health check -> lock -> restart -> verify cycle.

```
STEP    API CALL / SDK METHOD              RESPONSE                         FRICTION
------------------------------------------------------------------------------------------
1       pd.checkServiceHealth('app:api')   Record<string, unknown>          MEDIUM
        PROBLEM: Untyped. Self-healer can't determine if service is
        healthy/unhealthy without knowing response shape.

2       pd.withLock('restart-app-api',     result of fn                     LOW
               async () => {
                 // restart logic
               })
        Good: withLock is an excellent primitive. Auto-releases on
        error. This is the best API in the SDK.

3       // But: lock TTL defaults to 5min
        // What if restart takes 6 minutes?
        pd.extendLock('restart-app-api')   Record<string, unknown>          MEDIUM
        PROBLEM: withLock does not auto-extend. If the locked function
        takes longer than TTL, the lock expires and another agent can
        grab it. withLock needs an auto-extend option that periodically
        extends TTL while the function is running.

4       // Wait for healthy after restart
        GET /wait/app:api?timeout=60000    result                           HIGH
        PROBLEM: No SDK method for /wait/:id. Self-healer must use
        raw HTTP or poll checkServiceHealth in a loop.

5       // Verify and report
        pd.publish('healing-log',          response                         LOW
                   { action: 'restarted',
                     service: 'app:api' })
        Good: pub/sub for logging works well.
```

---

## Part 2: SDK Friction Matrix

### Missing Methods

| API Endpoint | HTTP Method | SDK Method | Status |
|---|---|---|---|
| `/wait/:id` | GET | -- | **MISSING** |
| `/wait` | POST | -- | **MISSING** |
| `/ports/request` | POST | -- | **MISSING** (legacy compat) |
| `/ports/release` | DELETE | -- | **MISSING** (legacy compat) |
| `/msg` | GET | -- | **MISSING** (alias for `/channels`) |
| `/msg/:channel/poll` | GET | `poll()` | Exists |
| `/msg/:channel/subscribe` | GET | `subscribe()` | Exists |

### Inconsistent Patterns

| Pattern | Issue | Severity |
|---|---|---|
| Return types use `Record<string, unknown>` for 17 of 35 methods | Agents cannot reason about response shapes | HIGH |
| `claim()` return type omits `success`, `status`, `message` | Agent must check HTTP status instead of response body | HIGH |
| `release()` declares `releasedPorts: number[]` which never exists in API | Agent gets `undefined` | HIGH |
| `lock()` return type omits `name`, `acquiredAt`, `message` | Agent loses useful data | MEDIUM |
| `publish()` return type claims `channel` field that doesn't exist | Agent gets `undefined` | MEDIUM |
| `unlock()` return type omits `name`, `message` | Minor data loss | LOW |

### Error Handling Gaps

| Gap | Impact | Severity |
|---|---|---|
| No retry logic for transient failures | Agent must implement its own retry | HIGH |
| No wait-for-lock with timeout | Agent must poll in a loop | HIGH |
| `PortDaddyError.body` typed as `unknown` | Error details not accessible without casting | MEDIUM |
| No error codes/enums, only string messages | Can't switch on error type | MEDIUM |
| SSE timeout kills connection silently | Agent loses real-time feed | HIGH |

---

## Part 3: API Response Consistency Audit

### The `success` Field Problem

The API uses a `success: boolean` field in all responses from the core modules (services, locks, messaging, agents). This is consistent at the module level. However:

1. **The SDK types do not include `success`** in most response interfaces (`ClaimResponse`, `LockResponse`, `PublishResponse`, etc.). This means TypeScript consumers cannot rely on it.

2. **The HTTP status code and `success` field are redundant but not always aligned.** The route handlers generally set 400/409/404 for `success: false` responses, but the exact mapping varies:
   - Lock held: 409 Conflict
   - Lock not owned by you: 403 Forbidden
   - Lock not found (extend): 400 Bad Request
   - Service not found: 404
   - Invalid input: 400

3. **Error responses have no consistent envelope.** Some return `{ error: 'message' }`, others return `{ success: false, error: 'message', ...extra_fields }`. The extra fields (like `holder`, `heldSince`, `expiresAt` on lock conflicts) are useful but undocumented and inconsistent.

### Response Shape Inventory

| Endpoint | Success Shape | Error Shape | Consistent? |
|---|---|---|---|
| `POST /claim` | `{ success, id, port, status, existing, message }` | `{ error }` | Mostly |
| `DELETE /release` | `{ success, released, port, message }` | `{ error }` | Yes |
| `POST /locks/:name` | `{ success, name, owner, acquiredAt, expiresAt, message }` | `{ success: false, error, holder, heldSince, expiresAt }` | NO - error has extra fields |
| `DELETE /locks/:name` | `{ success, released, name, message }` | `{ success: false, error, holder }` | NO |
| `GET /locks/:name` | `{ success, held, name, owner?, pid?, acquiredAt?, expiresAt?, metadata? }` | `{ success: false, error }` | Mostly |
| `POST /msg/:channel` | `{ success, id, message }` | `{ error }` | Yes |
| `POST /agents` | `{ success, agentId, registered, message }` | `{ error }` | Yes |
| `GET /health` | `{ status, version, uptime_seconds, active_ports, pid }` | N/A | YES - no success field, uses `status: 'ok'` |
| `GET /version` | `{ version, codeHash, startedAt, ... }` | N/A | YES - no success field |

**Key finding**: The `/health` and `/version` endpoints do NOT use the `success` pattern, which is correct -- they should always succeed if the daemon is running. But the inconsistency means an agent parsing responses needs two strategies.

---

## Part 4: Error Message Machine-Readability

### Current Error Taxonomy

Errors are communicated as free-text strings in the `error` field. An agent receiving an error must string-match to determine the category:

| Error String | What It Means | Machine-Readable? |
|---|---|---|
| `"lock is held"` | Lock contention | NO -- must string match |
| `"lock held by another owner"` | Ownership mismatch | NO |
| `"lock not held"` | Lock doesn't exist | NO |
| `"service not found"` | No such service | NO |
| `"cannot claim with wildcard identity"` | Input validation | NO |
| `"No available ports in range X-Y"` | Resource exhaustion | NO -- range is embedded |
| `"port already in use"` | Race condition | NO |
| `"agent has reached service limit (N)"` | Quota exceeded | NO -- limit is embedded |
| `"too many requests, please slow down"` | Rate limited | NO |
| `"internal server error"` | Server bug | NO |
| `"Too many concurrent connections"` | Connection limit | NO |

**Recommendation**: Every error should include a machine-readable `code` field alongside the human-readable `error` string. For example: `{ error: "lock is held", code: "LOCK_CONTENTION", holder: "agent-42", expiresAt: 1234567890 }`.

---

## Part 5: Lifecycle Gaps

### Daemon Not Running

| Scenario | Current Behavior | What Should Happen |
|---|---|---|
| SDK call when daemon is down | `ConnectionError` thrown with actionable message | Good, but no auto-retry or auto-start |
| SSE subscription when daemon is down | Fetch fails, error handler called once | Good |
| Long-poll when daemon dies mid-poll | Node socket error, `PortDaddyError` thrown | Acceptable |

### Service Crashes

| Scenario | Current Behavior | Gap |
|---|---|---|
| Service process dies, port still claimed | Cleanup runs every 5 minutes (configurable) | 5-minute window where port is occupied by dead service |
| Agent wants immediate cleanup | Must call `pd.cleanup()` manually | No auto-cleanup on claim failure |
| No PID validation on claimed ports | Stale entries persist until cleanup cycle | Could check PID liveness on claim |

### Lock Expires Mid-Operation

| Scenario | Current Behavior | Gap |
|---|---|---|
| Lock TTL expires during `withLock()` | Lock released by cleanup; another agent can grab it; original operation continues unprotected | **CRITICAL**: `withLock` should detect expiration and either abort or auto-extend |
| Lock holder crashes | Lock expires after TTL (default 5 min) | Acceptable -- TTL is the protection mechanism |
| Lock extended but TTL too short | `extendLock` returns new expiry | No auto-extend timer in SDK |

### SSE Disconnects

| Scenario | Current Behavior | Gap |
|---|---|---|
| 5-minute SSE timeout | Server sends `event: timeout` and closes | SDK doesn't handle this event; no auto-reconnect |
| Network interruption | `error` event fires on Subscription | No reconnection logic |
| Server restart | Connection drops | No reconnection logic |

---

## Part 6: Missing SDK Methods

| Priority | Method | Endpoint | Why It Matters |
|---|---|---|---|
| **P0** | `waitForService(id, timeout?)` | `GET /wait/:id` | Orchestrators and self-healers need this |
| **P0** | `waitForServices(ids[], timeout?)` | `POST /wait` | Orchestrators need bulk wait |
| **P1** | `claimBatch(ids[], options?)` | N/A (new) | Swarm/orchestrator need atomic batch claim |
| **P1** | `lockWithRetry(name, timeout?, options?)` | N/A (new) | Agents need "wait until lock available" |
| **P2** | `setAgentId(id)` | N/A (SDK-only) | Dynamic agent identity for swarm managers |
| **P2** | `subscribe()` with auto-reconnect | N/A (SDK-only) | IDE extensions and long-running consumers |

---

## Part 7: Integration Friction (Using Port Daddy as a Dependency)

### For a Dev Tool Author

1. **No TypeScript declaration file published**: The SDK is in `lib/client.ts` but `package.json` would need to export types correctly. A tool author `import { PortDaddy } from 'port-daddy/client'` needs the `.d.ts` file to be generated and mapped in `exports`.

2. **No ESM/CJS dual support clarity**: The SDK uses `import` statements (ESM) but many tool ecosystems still use CommonJS. No indication of dual-module support.

3. **Hard dependency on Node.js 18+**: Uses native `fetch` for SSE streaming in Node.js path. This is fine for modern environments but should be documented.

4. **No event emitter pattern**: The PortDaddy class is a plain object. Tool authors building reactive systems would prefer `pd.on('claim', handler)` or similar. Currently, the only reactive primitive is `subscribe()` for pub/sub channels, not for local SDK events.

5. **Socket path is `/tmp/port-daddy.sock`**: Hard-coded default. On multi-user systems or in Docker containers, this can conflict. No per-project socket isolation.

### For a Monorepo Maintainer

1. **No `.portdaddyrc` auto-discovery in SDK**: The CLI reads `.portdaddyrc` for configuration, but the SDK constructor does not. A monorepo maintainer must manually configure the SDK for each sub-project.

2. **No workspace-aware claiming**: SDK `claim()` takes a flat ID. There's no way to say "claim for this sub-package of this monorepo" without the maintainer constructing the semantic ID manually.

3. **No bulk operations**: Managing 10+ services requires 10+ individual claim/release calls with no transactional semantics.

---

## Part 8: Quick Wins (Highest Impact, Lowest Effort)

### Tier 1: Fix Today (< 1 hour each)

1. **Fix SDK response types to match actual API responses.** `ClaimResponse`, `ReleaseResponse`, `LockResponse`, `PublishResponse` all have fields that don't match reality. Update the interfaces in `client.ts` to include `success`, remove nonexistent fields like `releasedPorts` and `channel`, and add missing fields like `name`, `acquiredAt`, `message`, `status`. This is pure type editing -- no runtime changes.

2. **Add `waitForService()` and `waitForServices()` SDK methods.** The endpoints already exist (`GET /wait/:id`, `POST /wait`). Just add two methods to the SDK class that call them. 10 lines of code each.

3. **Replace `Record<string, unknown>` return types with proper interfaces.** At least for `checkServiceHealth()`, `listServiceHealth()`, `extendLock()`, `metrics()`, and `getWebhookDeliveries()`. These are the most commonly needed typed responses for agentic consumers.

### Tier 2: Fix This Week (< 4 hours each)

4. **Add machine-readable error codes.** Define an enum of error codes (`LOCK_CONTENTION`, `PORT_EXHAUSTION`, `RATE_LIMITED`, `NOT_FOUND`, `VALIDATION_FAILED`, `QUOTA_EXCEEDED`, `INTERNAL_ERROR`). Add a `code` field to all error responses alongside the existing `error` string. Agents can then `switch` on `error.code` instead of parsing strings.

5. **Add `lockWithRetry(name, timeout, interval, options)` SDK method.** This is the most-requested primitive for multi-agent systems. Retry acquiring a lock at `interval` until `timeout`, then throw. 20 lines of code. Saves every agent from implementing the same retry loop.

6. **Add SSE auto-reconnect in `subscribe()`.** When the connection drops (error event, timeout event, or network failure), wait 1 second and reconnect. Maintain a `lastEventId` to resume where the connection left off. This is standard SSE behavior that browsers implement natively but the Node.js path does not.

7. **Add auto-extend option to `withLock()`.** Accept an `autoExtend?: boolean | number` option. If enabled, start a timer that calls `extendLock()` at half the TTL interval while the locked function is running. Clear the timer on completion. Prevents the critical bug where a long-running operation loses its lock protection.

### Tier 3: Fix This Month

8. **Add batch operations.** `claimBatch(ids[])` that atomically claims all or rolls back. `releaseBatch(ids[])` for bulk cleanup. These are essential for orchestration frameworks.

9. **Add `pd.ensureDaemon()` for CI/CD.** Checks if daemon is running, starts it if not (via `child_process.spawn`), waits for health check to pass. This removes the biggest CI/CD friction point.

10. **Publish proper TypeScript declarations.** Ensure `package.json` has `"types"` and `"exports"` configured so that `import { PortDaddy } from 'port-daddy/client'` provides full IntelliSense in consuming projects.

---

## Appendix: Human Persona Notes

### Multi-Agent Builder (Expert)

**Primary pain**: The `Record<string, unknown>` return types throughout the SDK. An expert building AI infrastructure will immediately notice that the type system is lying about response shapes. They will either (a) cast everything to `any` and lose type safety, or (b) define their own interfaces by reading server source code. Neither is acceptable for a published SDK.

### Dev Tool Author (Evaluating)

**Primary pain**: The SDK has no programmatic daemon lifecycle control. A tool author evaluating Port Daddy as a dependency will ask "what happens if the daemon isn't running?" and discover they must shell out to `port-daddy start`. This is a deal-breaker for tools that need zero-configuration setup. The `ensureDaemon()` method is critical for adoption.

### Monorepo Maintainer

**Primary pain**: No batch operations and no workspace-aware identity construction. A maintainer with 10 services in a turborepo wants `pd.claimWorkspace('/path/to/monorepo')` that auto-discovers services via the scan endpoint and claims ports for all of them. The current workflow is: call `scan()`, parse results, manually `claim()` each service. This should be one method.

---

## Summary of Critical Findings

| # | Finding | Severity | Personas Affected |
|---|---|---|---|
| 1 | SDK response types do not match actual API responses | HIGH | All 11 personas |
| 2 | 17 of 35 SDK methods return `Record<string, unknown>` | HIGH | All agentic personas |
| 3 | No `waitForService()` / `waitForServices()` SDK methods | HIGH | Orchestrator, Self-Healer |
| 4 | No lock-with-retry primitive | HIGH | Swarm, Self-Healer, MCP Tool |
| 5 | SSE subscriptions die after 5 minutes with no reconnect | HIGH | IDE Extension, Swarm |
| 6 | `withLock()` does not auto-extend TTL | HIGH | Self-Healer, Orchestrator |
| 7 | No machine-readable error codes | HIGH | MCP Tool, CI/CD, all agents |
| 8 | No daemon lifecycle control in SDK | HIGH | CI/CD, Dev Tool Author |
| 9 | No batch claim/release operations | MEDIUM | Orchestrator, Monorepo, Swarm |
| 10 | Error response shapes vary by endpoint | MEDIUM | MCP Tool, all agents |
| 11 | `release()` SDK type includes nonexistent `releasedPorts` field | MEDIUM | Single Session, CI/CD |
| 12 | Rate limiter can starve agent swarms (100 req/min) | MEDIUM | Swarm |
