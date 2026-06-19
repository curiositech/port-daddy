# 0002. Module Factory Pattern for Dependency Injection

## Status

Accepted

## Context

Port Daddy's server (`server.ts`) composes around fifteen separate functional modules: services, sessions, agents, locks, messaging, activity log, webhooks, resurrection, DNS, briefing, sugar, and more. Each module needs a database connection. Some modules need references to other modules — for example, `sessions` needs the `activityLog` to record events; `briefing` needs `sessions`, `agents`, `resurrection`, `activityLog`, `services`, and `messaging`.

The central challenge: how should these modules be structured so that each module's tables are initialized when the module loads (not in a central migration script), tests can substitute an in-memory database without any global state, modules can be composed together without tight coupling, and TypeScript can type-check the dependencies each module expects.

## Decision Drivers

- **Testability**: Unit tests must be able to create an isolated module instance with an in-memory database in a single line. No singletons, no global state.
- **Composability**: `server.ts` should read as a clear wiring diagram — create module A, create module B using A, mount their routes.
- **Self-initializing schema**: Each module should be responsible for ensuring its own tables exist, not a central migration runner.
- **No magic**: Dependency injection should be explicit in code, not via decorators, reflection, or a DI container.
- **TypeScript friendliness**: Dependency interfaces should be expressible as TypeScript types without complex generics.

## Considered Options

### Option A: Module Factory Functions (`createFoo(db)` returns an object)

Each module exports a single factory function. The factory accepts a `better-sqlite3` `Database` instance (and any peer modules it needs), creates its tables, prepares its statements, and returns a plain object with method functions.

Pros:
- Pure functions — trivially testable with any `Database` instance
- No global state
- TypeScript infers the return type automatically
- Wiring is explicit and readable in `server.ts`

Cons:
- Circular dependencies require post-creation injection (e.g., `sessions.setActivityLog(activityLog)`)
- No automatic lifecycle management

### Option B: Class-based modules with constructor injection

Pros:
- Familiar OOP pattern
- Clear `this` binding for all methods

Cons:
- Classes in TypeScript with private fields require more boilerplate
- `this` binding issues when methods are passed as callbacks
- The codebase's functional style (closures over `stmts`) is cleaner without `this`

### Option C: Singleton modules (module-level state)

Export functions directly from modules using module-level variables for state.

Pros:
- Simpler call sites

Cons:
- Global mutable state makes parallel test suites impossible — two test files cannot run simultaneously without contaminating each other's database
- Impossible to test a module in isolation without coordinating initialization order

### Option D: A DI container (InversifyJS, TSyringe, etc.)

Pros:
- Automatic dependency resolution

Cons:
- Requires `experimentalDecorators` and `emitDecoratorMetadata` — adds TypeScript complexity
- Significant additional dependency for a system with ~15 modules
- Hides the wiring in annotations, making it harder for a new contributor to understand what depends on what
- Port Daddy's wiring is simple enough to be explicit

## Decision

Use **module factory functions** following the `createFoo(db)` convention throughout `lib/`.

Every functional module exports exactly one `createFoo` function. The function:

1. Accepts a `Database.Database` instance as its first parameter
2. Optionally accepts peer module instances or an options object for cross-module dependencies
3. Runs `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for its own tables immediately
4. Prepares all SQL statements upfront into a `stmts` object (closure variable)
5. Defines private helper functions using closure scope — access to `db` and `stmts` without needing `this`
6. Returns a plain object containing only the public API

`server.ts` reads as a linear wiring script:

```
const db = initDatabase({ dbPath: DB_PATH });
const services    = createServices(db);
const messaging   = createMessaging(db);
const locks       = createLocks(db);
const agents      = createAgents(db);
const activityLog = createActivityLog(db);
const sessions    = createSessions(db);
sessions.setActivityLog(activityLog);     // post-init injection for circular ref
const sugar = createSugar({ agents, sessions, activityLog });
```

For the rare case where two modules need references to each other (sessions and activityLog have a mild circular relationship — sessions wants to log, the log does not need sessions), a `setFoo()` post-initialization injection method is used rather than restructuring the initialization order.

## Rationale

The factory pattern was chosen because it is the simplest structure that satisfies all requirements. It produces plain JavaScript objects — no classes, no decorators, no DI framework. Every module is fully independent and testable in isolation:

```javascript
// tests/unit/locks.test.js
import { createTestDb } from '../setup-unit.js';
import { createLocks } from '../../lib/locks.js';

const db = createTestDb();
const locks = createLocks(db);
// locks is now a fully functional module against an in-memory database
```

This pattern makes the dependency graph visible. Reading `server.ts` from top to bottom tells you exactly what depends on what. A new contributor does not need to understand a DI container's resolution algorithm to add a new module.

The `stmts` pattern — preparing all SQL statements at factory creation time — provides two additional benefits: SQL syntax errors are caught at startup rather than at first call, and repeated statement parsing is avoided for hot paths like `claim` and `heartbeat`.

## Consequences

### Positive

- Every module can be unit-tested independently with an in-memory database — no daemon, no real files
- `server.ts` serves as a living architectural diagram of the entire system's composition
- Adding a new module follows a clear template: export `createFoo(db)`, initialize tables, return methods
- TypeScript infers return types without explicit interface declarations (though interfaces are added for complex cases)

### Negative

- Circular dependencies require the `setFoo()` injection escape hatch, which is slightly awkward
- All module instances are created at daemon startup even if some features are never used — a minor memory overhead acceptable at this scale

### Neutral

- Routes follow the same pattern: `createFooRoutes(deps)` returns an Express `Router`. Route factories accept the full deps bundle from `server.ts`, keeping route files thin and focused on HTTP marshaling.
- The `sugar` module (`lib/sugar.ts`) demonstrates the pattern at its most compositional: `createSugar({ agents, sessions, activityLog })` adds no new tables and operates purely on APIs exposed by other modules.
