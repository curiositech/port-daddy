# Operator runbook — Cloudflare Workers AI HTTP 400 / code 7000 ("No route for that URI")

**Symptom:** Fleet ships running on the `cloudflare` backend (cartographer, spider, tenderfoot, and any other ship with `backend: cloudflare` in `pd-fleet.yml`) all fail with the same wire error:

```
Cloudflare Workers AI HTTP 400: {"success":false,"errors":[{"code":7000,"message":"No route for that URI"}],"messages":[],"result":null}
```

Every model slug returns 7000 — including the long-stable `@cf/meta/llama-3.1-8b-instruct`. That is the tell that the bug is **not in the model slug**. It is in the URL the daemon is building.

---

## Root cause

`lib/llm-call.ts` ≤ v3.14.x used `encodeURIComponent(model)` on the whole slug:

```ts
// BROKEN — pre-fix
const res = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`,
  // …
);
```

For a slug like `@cf/qwen/qwen3-30b-a3b-fp8`, `encodeURIComponent` encodes the slashes (`/` → `%2F`) and the `@` (`@` → `%40`). Cloudflare's router treats the entire encoded string as **one literal path segment**, finds no route for it, and returns 7000.

The fix on `main` (PR [#120](https://github.com/curiositech/port-daddy/pull/120), commit `7ebc50fb`, shipped in **v3.15.0**) splits the slug on `/`, URL-encodes each segment individually, and restores `@` so the account path stays Cloudflare-shaped:

```ts
function cloudflareModelPath(model: string): string {
  const segments = model.trim().replace(/^\/+/, '').split('/');
  if (!segments.length || segments.some(s => !s || s === '.' || s === '..')) {
    throw new Error('invalid Cloudflare Workers AI model id');
  }
  return segments
    .map(s => encodeURIComponent(s).replace(/%40/g, '@'))
    .join('/');
}
```

This is a **one-encoder bug in the daemon**. No model slugs need updating.

### Wire-level confirmation (2026-05-20)

Running the FIXED builder against live Cloudflare with the operator's tokens:

```
[200] @cf/qwen/qwen3-30b-a3b-fp8
[200] @cf/zai-org/glm-4.7-flash
[200] @cf/moonshotai/kimi-k2.6
[200] @cf/openai/gpt-oss-120b
[200] @cf/nvidia/nemotron-3-120b-a12b
[200] @cf/meta/llama-4-scout-17b-16e-instruct
[200] @cf/meta/llama-3.1-8b-instruct
[200] @cf/meta/llama-3.3-70b-instruct-fp8-fast
```

All six slugs currently in `pd-fleet.yml` and `lib/backend-catalog.ts` are live. With the BROKEN builder the same first slug returns the 7000 error verbatim. The split-and-encode swap is the entire fix.

---

## Why both ships fail with the same error

- **cartographer**, **spider**, **tenderfoot**, **qa**, **test-hunter**, **documentarian**, **simplifier** all use `backend: cloudflare` in `pd-fleet.yml`.
- The wire error is identical because they all flow through the same `cloudflareAdapter` in `lib/llm-call.ts`.
- This is one bug, not two. Fixing the daemon fixes every ship that pings Cloudflare.

---

## Remediation — which daemon is actually running?

The launchd plist at `~/Library/LaunchAgents/com.portdaddy.daemon.plist` may be pointing at a stale tsx-based worktree instead of the brewed binary. Check first:

```bash
plutil -p ~/Library/LaunchAgents/com.portdaddy.daemon.plist | sed -n '/ProgramArguments/,/]/p'
```

There are two valid recoveries depending on what you see.

### Path A — launchd is already pointed at the brewed binary

```bash
brew update
brew upgrade port-daddy        # or `brew reinstall port-daddy` if 3.15.0 is already pinned but the binary on disk is stale
pd version                     # should report 3.15.0+
launchctl kickstart -k gui/$(id -u)/com.portdaddy.daemon
pd status                      # confirm uptime resets
```

Then smoke-test:

```bash
pd spawn --backend cloudflare \
  --model '@cf/qwen/qwen3-30b-a3b-fp8' \
  --purpose 'cf-7000 smoke' \
  --budget 0.02 \
  -j -- 'say hi in one word'
```

You want `"status": "success"` and a non-null `"output"`.

### Path B — launchd is pointed at a tsx worktree (the case observed 2026-05-20)

The plist's `ProgramArguments` was:

```
/Users/erichowens/coding/port-daddy-live-demo/node_modules/.bin/tsx
/Users/erichowens/coding/port-daddy-live-demo/server.ts
```

That worktree is pinned at commit `662e4511` (2026-05-16), which predates the 2026-05-19 fix. The CLAUDE.md house rule "never tsx daemon — binary path only" applies here. Swap launchd onto the brewed binary:

```bash
# 1. Stop the tsx daemon.
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.portdaddy.daemon.plist

# 2. Ensure the brewed binary is current.
brew update && brew upgrade port-daddy
pd version  # 3.15.0+

# 3. Re-register the launchd service from the brewed plist.
#    `pd install` regenerates the plist pointing at `/opt/homebrew/bin/pd`.
pd install --force

# 4. Confirm + smoke-test.
pd status
pd spawn --backend cloudflare \
  --model '@cf/qwen/qwen3-30b-a3b-fp8' \
  --purpose 'cf-7000 smoke after rebrew' \
  --budget 0.02 -j -- 'say hi in one word'
```

---

## Verification checklist

After the daemon is on v3.15.0+:

1. `pd version` → `3.15.0` or newer.
2. `pd spawn --backend cloudflare --model '@cf/qwen/qwen3-30b-a3b-fp8' --purpose 'verify' --budget 0.02 -j -- 'say hi'` returns `status: success` with non-null `output`.
3. Watch the fleet for a cycle (`pd notes --limit 20`). Cloudflare ships should stop emitting `HTTP 400` / `code: 7000`.
4. Spider in particular: it runs on `schedule: "0 */2 * * *"` (every 2h, see `pd-fleet.yml`), or fires on `spark:idea`. Either trigger one with `pd ideas add` or wait for the next slot. Look for a `spider:connections` publish on the event bus.

---

## What does NOT need to change

- `lib/backend-catalog.ts` — all six Cloudflare model entries are valid.
- `pd-fleet.yml` — `@cf/qwen/qwen3-30b-a3b-fp8` and `@cf/moonshotai/kimi-k2.6` are valid.
- `lib/cost-tracker.ts` — exact rate entries for the configured models are present.

This is **not** a model-slug deprecation. Do not chase replacement slugs.

---

## Why this was hard to spot

- The error message at the wire layer (`No route for that URI`) reads like the slug is unknown to Cloudflare.
- The catalog and pd-fleet.yml slugs are correctly formatted, so they look fine to grep.
- Cloudflare's routing collapses `%40cf%2Fqwen%2F…` into a single literal segment and emits 7000 — the same wording it uses for a genuinely deprecated model. There's no signal in the response body that points at URL encoding.
- The fix shipped on the same day v3.15.0 was tagged, so any operator still on v3.14.x sees the broken behavior.

A regression test for this exists in `tests/unit/llm-call.test.js` (added by PR [#120](https://github.com/curiositech/port-daddy/pull/120)) — it asserts the URL contains a literal `/` between the namespace and the model and that `@` is preserved.
