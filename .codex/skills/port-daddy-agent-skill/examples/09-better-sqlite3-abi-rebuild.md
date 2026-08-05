---
title: "Example 09: isolate a better-sqlite3 ABI mismatch"
purpose: "Recognize one worktree dependency mismatch behind a broad test cascade."
last_verified: 2026-08-04
---

# Isolate a better-sqlite3 ABI mismatch

Many suites can fail from one local native module compiled for a different Node
ABI. The literal signal is `NODE_MODULE_VERSION` mismatch.

```bash
pd attention
pd briefing
git fetch origin
node -p 'process.version + " ABI=" + process.versions.modules'
```

Confirm that every failure shares the same native-module load error. Compare
against current CI and another clean linked worktree before treating dozens of
suites as independent defects.

Use the repository's supported Node version and reinstall the worktree's
dependencies with Bun, then run one formerly failing suite before the sweep:

```bash
bun install --force
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand \
  tests/unit/<one-affected-suite>.test.js
```

This is worktree dependency state. It is not evidence that the installed Bun
daemon, the Homebrew keg, or a named feature daemon changed. Keep those runtime
identities separate.

Escalate beyond dependency repair when failures do not share an ABI error, a
fresh install reproduces them, or current CI fails the same focused suite.
