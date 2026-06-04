# Code Style & Conventions

## TypeScript
- ESM modules (`type: "module"` in package.json)
- `.ts` source files import with `.js` extension (NodeNext resolution)
- Explicit type annotations on function parameters and return types
- `const` preferred over `let`
- Interfaces defined near usage
- Factory pattern: `createXxx(db: Database.Database)` returns object with methods

## Testing
- Jest with `@swc/jest` transform for TypeScript
- `tests/setup-unit.js` provides `createTestDb()` for in-memory SQLite
- Test files: `tests/unit/*.test.js` (plain JS, not TS)
- Import from `../setup-unit.js` and `../../lib/module.js`
- Each test gets fresh DB via `beforeEach`
- Use `describe` blocks with test count in name
- `afterEach` closes db

## CLI
- TTY-aware output: human-friendly to stderr, machine output to stdout
- `--json`, `--quiet` (`-q`), `--export` output modes
- Auto-identity from package.json when no id given
- pdFetch() wraps HTTP calls to daemon

## Naming
- Snake_case for DB columns
- camelCase for JS/TS
- Semantic identities: `project:stack:context`
