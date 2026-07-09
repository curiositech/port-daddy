# Effective Runtime Truth RED/GREEN Evidence

Base before PR: `origin/main` at `65f2ea03e fix(spawner): finalize Cloudflare backend timeouts (#1186)`.

The exact command outputs are committed verbatim next to this file. They were captured with `tee` from the commands below.

## RED

Purpose: prove the new tests fail against pre-fix production code. I created a detached temp worktree at current `origin/main`, copied only `tests/unit/spawner-runtime-truth.test.js` into it, and ran the focused test file.

Command:

```sh
NODE_PATH=/Users/erichowens/coding/port-daddy/node_modules /usr/local/bin/node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --rootDir . tests/unit/spawner-runtime-truth.test.js --runInBand
```

Exit code: `1`

Exact output: `.scratch/effective-runtime-truth-red.txt`

Key failing signal in that output:

```text
Expected: ObjectContaining {"cli": "codex", "model": "codex-cli"}
Received: {"cli": "codex", ... "model": "gpt-5-mini", ...}
```

It also shows `SpawnResult` and `/spawn` route responses lacked `requestedBackend`, `effectiveBackend`, `requestedModel`, `effectiveModel`, and `backendOverrideSource`.

## GREEN Focused

Purpose: prove the implementation fixes the forced runtime truth bug and that old transcript DBs migrate safely.

Command:

```sh
NODE_PATH=/Users/erichowens/coding/port-daddy/node_modules /usr/local/bin/node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --rootDir . tests/unit/spawner-runtime-truth.test.js tests/unit/transcripts.test.js --runInBand
```

Exit code: `0`

Exact output: `.scratch/effective-runtime-truth-green-focused.txt`

Pass summary from exact output:

```text
PASS unit tests/unit/spawner-runtime-truth.test.js
PASS unit tests/unit/transcripts.test.js

Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
```

## GREEN Typecheck

Purpose: public result/client/transcript types changed, so compile the branch with a local dependency install.

Setup command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm ci
```

Output summary:

```text
added 635 packages, and audited 636 packages in 6s
19 vulnerabilities (2 low, 10 moderate, 7 high)
```

Typecheck command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm run typecheck
```

Exit code: `0`

Exact output: `.scratch/effective-runtime-truth-typecheck.txt`

## GREEN Adjacent

Purpose: preserve merged #1176/#1186 spawner transcript and Cloudflare/default timeout behavior while touching `lib/spawner.ts`.

Command:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-transcripts.test.js tests/unit/transcripts-routes.test.js tests/unit/spawn-routes-preflight.test.js tests/unit/spawner-telemetry-policy.test.js
```

Exit code: `0`

Exact output: `.scratch/effective-runtime-truth-green-adjacent.txt`

Pass summary from exact output:

```text
Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
```

## Why The Tests Are Not Tautologies

`tests/unit/spawner-runtime-truth.test.js` mocks only the external launch/readiness seams. The direct spawner cases execute real `createSpawner`, real runtime resolution, real transcript recording, and real cost-tracker call sites. The route case goes through Fastify `POST /spawn`, the real spawn route, real spawner, real transcript DB writes, and transcript route readback. The RED run copied only the test file onto `origin/main`, so the failure came from pre-fix production behavior, not from testing a helper in isolation.
