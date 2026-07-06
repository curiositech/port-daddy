---
title: "Example 09: better-sqlite3 ABI mismatch after stable promotion"
purpose: "53 unit suites failing was 100% local node_modules ABI drift, not real bugs. How to recognize it."
last_verified: 2026-04-30
incident_date: 2026-04-29
---

# better-sqlite3 ABI Rebuild

## What the agent saw

```
Test Suites: 53 failed, 98 passed, 151 total
Tests:       1749 failed, 1 skipped, 3275 passed, 5025 total
```

53 unit suites failing. Looked catastrophic. Every failing suite reported:

```
The module '/.../node_modules/better-sqlite3/build/Release/better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 141. This version of Node.js requires
NODE_MODULE_VERSION 127. Please try re-compiling or re-installing
the module (for instance, using `npm rebuild` or `npm install`).
```

## What was actually happening

The stable agent had promoted under a Node version that maps to ABI 141 (Node 23+). My local checkout was on Node 22 (ABI 127). Running `npm test` loaded the binary native module compiled for the wrong ABI.

It wasn't 53 different bugs. It was ONE binary mismatch causing 53 cascade failures.

## How to detect this

```bash
# Your Node's ABI:
node -p "process.versions.modules"
# 127

# The compiled binary's ABI: (extract from error message, or:)
file node_modules/better-sqlite3/build/Release/better_sqlite3.node
# Mach-O 64-bit bundle arm64  (the platform, but the ABI is in the file's link metadata)

# Cross-check: did stable just promote?
git -C ~/port-daddy-stable log --oneline -3
# Recent commits + a "rebuilt better-sqlite3 for Node ABI 141" note in pd briefing
# means stable rebuilt against a newer ABI than your local has.

# Check pd notes for the smoking gun:
pd notes --limit 50 | grep -i "abi\|rebuild\|better-sqlite"
```

## The fix

```bash
npm rebuild better-sqlite3
```

That's it. ~30 seconds. Then re-run tests:

```bash
NODE_OPTIONS="--experimental-vm-modules" npx jest tests/unit/ --no-coverage
# Test Suites: 151 passed, 151 total
```

## Why this trap exists

- `package-lock.json` doesn't pin to a specific compiled ABI — only to source.
- Each developer's Node version determines the local ABI.
- `prebuildify`-built binaries are committed to `port-daddy-stable/node_modules/` for the daemon, but NOT to a developer worktree.
- A `git fetch` doesn't rebuild native modules.
- A `git checkout` doesn't either.

## How to avoid burning time on it

**Before opening a "53 tests failing" investigation:**

1. Run `pd briefing` and `pd notes --limit 30 | grep -i abi`. If stable promoted recently, this is your first hypothesis.
2. Check `node -p "process.versions.modules"` against the binary error.
3. Try `npm rebuild` for any native modules in your stack BEFORE assuming code regression.
4. Compare against `origin/main` — if origin's CI is green and yours isn't, the difference is your env.

## When it's NOT this

- A single specific suite is failing (not a sweep).
- Failing tests don't mention `NODE_MODULE_VERSION`.
- You haven't pulled or stable hasn't promoted in days.

## Lessons

- **Cascade failures on a single root cause are common.** Don't fan out to 53 hypotheses when one explains all.
- **Local node_modules drift faster than you think.** A test sweep is the wrong place to discover it; `pd briefing` first would have caught it.
- **Node ABI bumps happen.** When stable promotes, expect a `npm rebuild` step in your worktree.

## Related

- `decisions/something-broke.md` — "Many suites failing with NODE_MODULE_VERSION mismatch" branch.
- `examples/11-briefing-first-even-for-diagnostics.md` — the meta-lesson.
