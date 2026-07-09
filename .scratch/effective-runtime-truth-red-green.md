# Effective Runtime Truth RED/GREEN Evidence

Base before PR: `origin/main` at `65f2ea03e fix(spawner): finalize Cloudflare backend timeouts (#1186)`.

This file is self-contained: each section below includes the exact command and output captured with `tee`. The raw tee files were removed from the branch so the PR keeps one review artifact instead of several large scratch logs.

## Contract Surface Note

This branch intentionally updates the narrow server/client surface that exists today: `lib/spawner.ts` is the authoritative runtime resolver/executor, `routes/spawn.ts` preserves request provenance when preflight has already selected an effective backend, `lib/transcripts.ts` stores/readbacks the runtime provenance columns, and `lib/client.ts` mirrors the public SDK result/list shape with backward-aware optional fields. I did not find a shared generated TypeScript contract for `SpawnSpec`/`SpawnResult` in this repo, and this PR should not invent one. Follow-up work should add a one-command generated spawn contract so `lib/spawner.ts`, `lib/client.ts`, HTTP/OpenAPI docs, MCP, and CLI consumers stop carrying manually duplicated runtime types.

## RED

Purpose: prove the new tests fail against pre-fix production code. I created a detached temp worktree at current `origin/main`, copied only `tests/unit/spawner-runtime-truth.test.js` into it, and ran the focused test file. No production implementation was present in that temp worktree.

Exit code: `1`

Captured output:

```text
# temp worktree
Preparing worktree (detached HEAD 65f2ea03e)
Updating files:  32% (2922/9103)Updating files:  33% (3004/9103)Updating files:  34% (3096/9103)Updating files:  35% (3187/9103)Updating files:  36% (3278/9103)Updating files:  37% (3369/9103)Updating files:  38% (3460/9103)Updating files:  39% (3551/9103)Updating files:  40% (3642/9103)Updating files:  41% (3733/9103)Updating files:  42% (3824/9103)Updating files:  43% (3915/9103)Updating files:  44% (4006/9103)Updating files:  45% (4097/9103)Updating files:  46% (4188/9103)Updating files:  47% (4279/9103)Updating files:  48% (4370/9103)Updating files:  49% (4461/9103)Updating files:  50% (4552/9103)Updating files:  51% (4643/9103)Updating files:  52% (4734/9103)Updating files:  53% (4825/9103)Updating files:  54% (4916/9103)Updating files:  55% (5007/9103)Updating files:  56% (5098/9103)Updating files:  57% (5189/9103)Updating files:  58% (5280/9103)Updating files:  59% (5371/9103)Updating files:  60% (5462/9103)Updating files:  61% (5553/9103)Updating files:  62% (5644/9103)Updating files:  63% (5735/9103)Updating files:  64% (5826/9103)Updating files:  65% (5917/9103)Updating files:  66% (6008/9103)Updating files:  67% (6100/9103)Updating files:  68% (6191/9103)Updating files:  69% (6282/9103)Updating files:  70% (6373/9103)Updating files:  71% (6464/9103)Updating files:  72% (6555/9103)Updating files:  73% (6646/9103)Updating files:  74% (6737/9103)Updating files:  75% (6828/9103)Updating files:  76% (6919/9103)Updating files:  77% (7010/9103)Updating files:  78% (7101/9103)Updating files:  79% (7192/9103)Updating files:  80% (7283/9103)Updating files:  81% (7374/9103)Updating files:  82% (7465/9103)Updating files:  83% (7556/9103)Updating files:  83% (7579/9103)Updating files:  84% (7647/9103)Updating files:  85% (7738/9103)Updating files:  86% (7829/9103)Updating files:  87% (7920/9103)Updating files:  88% (8011/9103)Updating files:  89% (8102/9103)Updating files:  90% (8193/9103)Updating files:  91% (8284/9103)Updating files:  92% (8375/9103)Updating files:  93% (8466/9103)Updating files:  94% (8557/9103)Updating files:  95% (8648/9103)Updating files:  96% (8739/9103)Updating files:  97% (8830/9103)Updating files:  98% (8921/9103)Updating files:  99% (9012/9103)Updating files: 100% (9103/9103)Updating files: 100% (9103/9103), done.
HEAD is now at 65f2ea03e fix(spawner): finalize Cloudflare backend timeouts (#1186)

# command
NODE_PATH=/Users/erichowens/coding/port-daddy/node_modules /usr/local/bin/node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --rootDir . tests/unit/spawner-runtime-truth.test.js --runInBand

# output
(node:12996) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
  console.log
    [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-04de14fda092 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1634:15)

  console.log
    [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-04de14fda092 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1635:46)

  console.log
    [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-78a9d2318c79 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1634:15)

  console.log
    [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-78a9d2318c79 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1635:46)

  console.log
    [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-0cb007a645cb backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1634:15)

  console.log
    [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-0cb007a645cb backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1635:46)

FAIL unit tests/unit/spawner-runtime-truth.test.js
  spawner effective runtime truth
    ✕ forced CLI backend records the effective runtime while preserving requested provenance (24 ms)
    ✕ no forced override keeps requested and effective runtime identical without bogus provenance noise (5 ms)
    ✕ POST /spawn persists effective runtime truth readable through transcript routes (43 ms)

  ● spawner effective runtime truth › forced CLI backend records the effective runtime while preserving requested provenance

    expect(jest.fn()).toHaveBeenCalledWith(...expected)

    Expected: ObjectContaining {"cli": "codex", "model": "codex-cli"}
    Received: {"cli": "codex", "cwd": undefined, "env": {}, "model": "gpt-5-mini", "onChild": [Function onChildProcess], "onStreamLine": [Function anonymous], "permissionMode": undefined, "prompt": "say exactly hello", "timeoutMs": undefined, "tube": undefined, "tubeClient": undefined}

    Number of calls: 1

      131 |     });
      132 |
    > 133 |     expect(mockSpawnViaCliTube).toHaveBeenCalledWith(expect.objectContaining({
          |                                 ^
      134 |       cli: 'codex',
      135 |       model: 'codex-cli',
      136 |     }));

      at Object.<anonymous> (tests/unit/spawner-runtime-truth.test.js:133:33)

  ● spawner effective runtime truth › no forced override keeps requested and effective runtime identical without bogus provenance noise

    expect(received).toEqual(expected) // deep equality

    - Expected  -  6
    + Received  + 15

    - ObjectContaining {
    + Object {
    +   "agentId": "spawned-78a9d2318c79",
        "backend": "openai",
    -   "backendOverrideSource": "none",
    -   "effectiveBackend": "openai",
    -   "effectiveModel": "gpt-5-mini",
    +   "coastGuard": null,
    +   "completedAt": 1783621376721,
    +   "error": null,
        "model": "gpt-5-mini",
    -   "requestedBackend": "openai",
    -   "requestedModel": "gpt-5-mini",
    +   "name": "Test Runtime Truth",
    +   "output": "openai actually ran",
    +   "startedAt": 1783621376720,
    +   "status": "completed",
    +   "telemetry": Object {
    +     "costUsd": 0.001,
    +     "inputTokens": 12,
    +     "outputTokens": 4,
    +     "rateMode": "exact",
    +   },
      }

      199 |
      200 |     expect(mockSpawnViaCliTube).not.toHaveBeenCalled();
    > 201 |     expect(result).toEqual(expect.objectContaining({
          |                    ^
      202 |       backend: 'openai',
      203 |       model: 'gpt-5-mini',
      204 |       requestedBackend: 'openai',

      at Object.<anonymous> (tests/unit/spawner-runtime-truth.test.js:201:20)

  ● spawner effective runtime truth › POST /spawn persists effective runtime truth readable through transcript routes

    expect(received).toEqual(expected) // deep equality

    - Expected  -  6
    + Received  + 16

    - ObjectContaining {
    + Object {
    +   "agentId": "spawned-0cb007a645cb",
        "backend": "cli:codex",
    -   "backendOverrideSource": "env",
    -   "effectiveBackend": "cli:codex",
    -   "effectiveModel": "codex-cli",
    -   "requestedBackend": "openai",
    -   "requestedModel": "gpt-5-mini",
    +   "coastGuard": null,
    +   "completedAt": 1783621376763,
    +   "error": null,
    +   "model": "codex-cli",
    +   "name": "Test Route Runtime Truth",
    +   "output": "codex actually ran",
    +   "startedAt": 1783621376762,
    +   "status": "completed",
        "success": true,
    +   "telemetry": Object {
    +     "costUsd": 0.001,
    +     "inputTokens": 4,
    +     "outputTokens": 5,
    +     "rateMode": "estimated",
    +   },
      }

      273 |       });
      274 |       expect(spawnRes.statusCode).toBe(200);
    > 275 |       expect(spawnRes.json()).toEqual(expect.objectContaining({
          |                               ^
      276 |         success: true,
      277 |         backend: 'cli:codex',
      278 |         requestedBackend: 'openai',

      at Object.<anonymous> (tests/unit/spawner-runtime-truth.test.js:275:31)

Test Suites: 1 failed, 1 total
Tests:       3 failed, 3 total
Snapshots:   0 total
Time:        0.248 s
Ran all test suites matching tests/unit/spawner-runtime-truth.test.js.

```

The RED failure shows requested/effective runtime truth was wrong or absent before the fix: forced `PD_USE_CLI_BACKEND=codex` executed `cli:codex` but still passed/requested `gpt-5-mini`, and both `SpawnResult` plus `/spawn` response lacked `requestedBackend`, `effectiveBackend`, `requestedModel`, `effectiveModel`, and `backendOverrideSource`.

## GREEN Focused Runtime And Migration Tests

Purpose: prove the implementation fixes runtime truth and that old transcript DB schemas/rows migrate safely. The migration proof is the focused test `migrates old fleet_transcripts rows with runtime provenance defaults` in `tests/unit/transcripts.test.js`.

Exit code: `0`

Captured output:

```text
# command
NODE_PATH=/Users/erichowens/coding/port-daddy/node_modules /usr/local/bin/node --experimental-vm-modules /Users/erichowens/coding/port-daddy/node_modules/jest/bin/jest.js --rootDir . tests/unit/spawner-runtime-truth.test.js tests/unit/transcripts.test.js --runInBand

# output
(node:17434) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS unit tests/unit/spawner-runtime-truth.test.js
  ● Console

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-249613c9b69a backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-249613c9b69a backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-2b1eb25c4146 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-2b1eb25c4146 backend=openai

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-aae51b4690f3 backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-aae51b4690f3 backend=cli:codex

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

PASS unit tests/unit/transcripts.test.js

Test Suites: 2 passed, 2 total
Tests:       35 passed, 35 total
Snapshots:   0 total
Time:        0.308 s, estimated 1 s
Ran all test suites matching tests/unit/spawner-runtime-truth.test.js|tests/unit/transcripts.test.js.

```

## GREEN Typecheck

Purpose: public result/client/transcript types changed, so compile the branch with local dependencies installed under Node 22.17.1.

Setup command run before typecheck:

```sh
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm ci
```

Setup output summary:

```text
npm warn deprecated boolean@3.2.0: Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.

added 635 packages, and audited 636 packages in 6s

141 packages are looking for funding
  run `npm fund` for details

19 vulnerabilities (2 low, 10 moderate, 7 high)

To address all issues, run:
  npm audit fix

Run `npm audit` for details.
```

Exit code: `0`

Captured output:

```text
# command
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm run typecheck

# output

> port-daddy@3.24.2 typecheck
> tsc --noEmit


```

## GREEN Adjacent Spawner/Transcript Route Tests

Purpose: preserve merged #1176/#1186 spawner transcript and Cloudflare/default timeout behavior while touching `lib/spawner.ts`.

Exit code: `0`

Captured output:

```text
# command
PATH=/Users/erichowens/.nvm/versions/node/v22.17.1/bin:$PATH npm test -- --runInBand tests/unit/spawner-transcripts.test.js tests/unit/transcripts-routes.test.js tests/unit/spawn-routes-preflight.test.js tests/unit/spawner-telemetry-policy.test.js

# output

> port-daddy@3.24.2 test
> node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/unit/spawner-transcripts.test.js tests/unit/transcripts-routes.test.js tests/unit/spawn-routes-preflight.test.js tests/unit/spawner-telemetry-policy.test.js

(node:24217) ExperimentalWarning: VM Modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
PASS unit tests/unit/spawner-transcripts.test.js
  ● Console

    console.error
      [1;97;41m TELEMETRY BYPASS ACTIVE [0m
      [1;31mOperator launches are running with enforceTelemetryPolicy:false.[0m
      confirmedBy=jest
      reason=Spawner+transcripts integration test — exercises legacy non-metered path

      307 |   if (telemetryBypassWarnings.has(warningKey)) return;
      308 |   telemetryBypassWarnings.add(warningKey);
    > 309 |   console.error([
          |           ^
      310 |     `${ANSI_BANNER_RED} TELEMETRY BYPASS ACTIVE ${ANSI_RESET}`,
      311 |     `${ANSI_BOLD_RED}Operator launches are running with enforceTelemetryPolicy:false.${ANSI_RESET}`,
      312 |     `confirmedBy=${confirmedBy}`,

      at error (lib/spawner.ts:309:11)
      at warnTelemetryBypass (lib/spawner.ts:1463:5)
      at Object.<anonymous> (tests/unit/spawner-transcripts.test.js:79:21)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-79e5c03756cd backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-79e5c03756cd backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-7705258fe9f3 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-7705258fe9f3 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-043f529edfe8 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-043f529edfe8 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-c62d47b19623 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-c62d47b19623 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-daea37a94a8c backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-daea37a94a8c backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.error
      [1;97;41m TRANSCRIPT RECORDING FAILED [0m
      [1;31mtranscript recording failed (start): db is on fire[0m

      1338 |       const msg = `transcript recording failed (${label}): ${detail}`;
      1339 |       if (enforceTranscriptPolicy) {
    > 1340 |         console.error(
           |                 ^
      1341 |           `${ANSI_BANNER_RED} TRANSCRIPT RECORDING FAILED ${ANSI_RESET}\n` +
      1342 |           `${ANSI_BOLD_RED}${msg}${ANSI_RESET}`,
      1343 |         );

      at error (lib/spawner.ts:1340:17)
      at recordOrThrow (lib/spawner.ts:1356:5)
      at Object.txStart [as spawn] (lib/spawner.ts:1842:22)
      at Object.<anonymous> (tests/unit/spawner-transcripts.test.js:200:34)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-e420b09a6555 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-e420b09a6555 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.error
      [1;97;41m TRANSCRIPT RECORDING FAILED [0m
      [1;31mtranscript recording failed (finalize): disk full at finalize[0m

      1338 |       const msg = `transcript recording failed (${label}): ${detail}`;
      1339 |       if (enforceTranscriptPolicy) {
    > 1340 |         console.error(
           |                 ^
      1341 |           `${ANSI_BANNER_RED} TRANSCRIPT RECORDING FAILED ${ANSI_RESET}\n` +
      1342 |           `${ANSI_BOLD_RED}${msg}${ANSI_RESET}`,
      1343 |         );

      at error (lib/spawner.ts:1340:17)
      at recordOrThrow (lib/spawner.ts:1444:5)
      at Object.txFinalize [as spawn] (lib/spawner.ts:2138:7)
      at Object.<anonymous> (tests/unit/spawner-transcripts.test.js:223:20)

    console.error
      [1;97;41m TRANSCRIPT RECORDING FAILED [0m
      [1;31mtranscript recording failed (finalize): disk full at finalize[0m

      1338 |       const msg = `transcript recording failed (${label}): ${detail}`;
      1339 |       if (enforceTranscriptPolicy) {
    > 1340 |         console.error(
           |                 ^
      1341 |           `${ANSI_BANNER_RED} TRANSCRIPT RECORDING FAILED ${ANSI_RESET}\n` +
      1342 |           `${ANSI_BOLD_RED}${msg}${ANSI_RESET}`,
      1343 |         );

      at error (lib/spawner.ts:1340:17)
      at recordOrThrow (lib/spawner.ts:1444:5)
      at Object.txFinalize [as spawn] (lib/spawner.ts:2143:13)
      at Object.<anonymous> (tests/unit/spawner-transcripts.test.js:223:20)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-d20247671556 backend=codex

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-d20247671556 backend=codex

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-cfc62bc999b3 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-cfc62bc999b3 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-f76854694b42 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-f76854694b42 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-e35fdee49ae8 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-e35fdee49ae8 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-bf63517bdbd8 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-bf63517bdbd8 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-ff7ca71f12f4 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-ff7ca71f12f4 backend=cloudflare

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

PASS unit tests/unit/spawn-routes-preflight.test.js
PASS unit tests/unit/transcripts-routes.test.js
PASS unit tests/unit/spawner-telemetry-policy.test.js
  ● Console

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-77688fa7a636 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-77688fa7a636 backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-f42bf42909e0 backend=codex

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-f42bf42909e0 backend=codex

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-65115857bddb backend=cli:agy

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-65115857bddb backend=cli:agy

      at Object.log [as spawn] (lib/spawner.ts:1713:46)

    console.log
      [spawner] bond priced $0.2500 — tier=full base=$0.0100 ×scope=25 ×dur=1 ×rep=1 floor=$0.2500 agent=spawned-b0bba4b1f1aa backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1712:15)

    console.log
      [spawner] bond scope advisory — priced tier=full exceeds the Coast Guard's enforced containment tier=read on this machine; the bond underwrites a blast radius the runtime does not yet structurally prevent (pricing ahead of containment — known advisory gap, deterrence sound) agent=spawned-b0bba4b1f1aa backend=claude

      at Object.log [as spawn] (lib/spawner.ts:1713:46)


Test Suites: 4 passed, 4 total
Tests:       43 passed, 43 total
Snapshots:   0 total
Time:        0.532 s, estimated 1 s
Ran all test suites matching tests/unit/spawner-transcripts.test.js|tests/unit/transcripts-routes.test.js|tests/unit/spawn-routes-preflight.test.js|tests/unit/spawner-telemetry-policy.test.js.

```

## Why The Tests Are Not Tautologies

`tests/unit/spawner-runtime-truth.test.js` mocks only external launch/readiness seams. The direct spawner cases execute real `createSpawner`, typed `ResolvedSpawnRuntime`, transcript recording, and cost-tracker call sites. The route case goes through Fastify `POST /spawn`, the real spawn route, real spawner, real transcript DB writes, and transcript route readback. The RED run copied only the test file onto `origin/main`, so the failure came from pre-fix production behavior rather than a helper tested against itself.

## Boyle Coordination

Sent a durable PD message to Boyle and left a session note requesting pd-console visual proof that shows requested/effective backend+model provenance after provider launch, or at minimum the transcript/session pane reflecting daemon-backed effective runtime truth for this branch.
