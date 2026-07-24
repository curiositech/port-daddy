# Incident Anatomy + Detection Playbook

Consult this file when auditing an existing codebase for the anti-patterns, or
when writing the post-mortem for a storm you just cleaned up.

---

## The reference incident: the 313 GB semantic-resolver storm

**Shape.** `semantic-resolver`'s `getEmbedder()` lazily loaded an ONNX embedding
model and memoized the promise:

```ts
let embedderPromise: Promise<Embedder> | undefined;
function getEmbedder() {
  if (!embedderPromise) embedderPromise = loadOnnxEmbedder(); // never reset on failure
  return embedderPromise;
}
```

The ONNX runtime dylib was missing in that environment, so `loadOnnxEmbedder()`
rejected. But `embedderPromise` was now a **permanently-rejected promise**. Every
one of 7,182 fleet-agent ticks called `await getEmbedder()`, re-awaited the same
dead promise, caught the rejection, and logged the full error object plus wrote a
DB row. Result: **7,182 retries → a 313 GB write storm**, an unrotated 255 MB
stdout capture, and a 231 MB database.

**Three independent bugs, each necessary:**

1. **Poison-pill memoization** — a *failure* was cached as if it were a value, so
   it was never re-attempted correctly and never cleared.
2. **No permanent-vs-transient classification** — a missing dylib (permanent) was
   retried forever as if it were a transient 503.
3. **Unbounded error logging in a hot loop** — no dedup/rate-limit, so each of the
   thousands of identical failures paid full logging cost.

The fix wires all three: `createGatedLoader` around the load (breaker + no poison
pill + coalescing) and a governed log so a persistent failure reports once per
window. See `references/gated-loader.md`. The general breaker/backoff mechanics it
composes are the canon in **[[circuit-breakers-and-retries]]**.

**Why it recurred.** Port Daddy hit the *same class* at least twice
(`bosun_heartbeat_write_failed` earlier, `semantic_resolution_failed` here). Each
time it was patched narrowly at the call site and the CLASS was never closed. The
lesson the skill encodes: **make "load-once with a breaker" and "log-but-never-spam"
first-class reusable primitives**, so the next failure-prone dependency inherits
the protection instead of re-discovering the crater.

---

## The other half: the primitive existed but was DEAD CODE

Port Daddy already had a correct `lib/agent-resilience.ts` — `fullJitterDelay`, a
`BackendCircuitBreaker`, `classifyAgentError`, `runResilientSpawn`. It was
**exercised only by unit tests**. The live spawn/poll paths hand-rolled their own
backoff (or omitted it) and never touched the breaker.

**Shibboleth:** having the primitive in the tree is worth nothing. The value is
in the **wiring**. An audit that greps for `class CircuitBreaker` and finds one
proves nothing; you must grep for its *call sites in live code* and confirm the
hot paths route through it. A resilience utility with no non-test importer is a
liability — it looks like coverage and delivers none.

---

## Detection: grep patterns for a codebase audit

Run these against a suspect repo. Each hit is a candidate storm.

```bash
# 1. Memoized load with no failure reset (poison-pill risk).
#    A module-level promise/singleton assigned once, awaited in a loop.
grep -rnE '(let|var)\s+\w*(Promise|Instance|Client|Embedder|Pool)\b' --include='*.ts' src \
  | grep -iv 'reset\|null'

# 2. Retry loops that branch on a raw message string (NLP at the decision point).
grep -rnE '\.(message|toString\(\)).*(includes|indexOf|match|test)\(' --include='*.ts' src \
  | grep -i 'retry\|backoff\|again'

# 3. Plain exponential backoff with NO jitter (thundering-herd risk).
grep -rnE '(Math\.pow\(2|<<\s*attempt|2\s*\*\*\s*attempt)' --include='*.ts' src \
  | grep -iv 'random\|jitter'

# 4. error()/console.error inside a while/for/setInterval with no governor.
grep -rnB3 -E '(log(ger)?\.error|console\.error)\(' --include='*.ts' src \
  | grep -iE 'while|for\s*\(|setInterval|every|tick|poll'

# 5. A resilience utility that is imported ONLY by tests (dead primitive).
#    If the only importers live under test/ or __tests__/, it is not wired.
grep -rln "agent-resilience\|circuit" --include='*.ts' src | grep -v test
```

## Detection: symptoms in ops

| Symptom | Almost always means |
|---------|---------------------|
| A log file / DB grows GB/hour while the service "looks idle" | Unthrottled error logging in a failing poll loop |
| Thousands of *byte-identical* error lines | No dedup; missing log governor |
| A recovering dependency keeps re-tipping-over under retries | Plain exponential (no jitter) thundering herd |
| A single malformed request makes a whole backend "go down" | Permanent failure wrongly tripping the breaker |
| The same failing dependency is re-loaded every tick | Poison-pill memoization / no gated loader |

---

## The audit verdict template

When you finish auditing, state each of these explicitly — a "yes" to any of the
first three is a live incident waiting to happen:

```
[ ] Is any load-once dependency memoized WITHOUT resetting on failure?
[ ] Does any retry loop use plain exponential backoff (no jitter)?
[ ] Does any retry decision read a raw error STRING at the call site?
[ ] Is there a resilience primitive that only tests import? (wire it or delete it)
[ ] Is error logging inside every hot/poll loop rate-limited/deduped?
[ ] Are OPTIONAL deps (tryGet→null) distinguished from REQUIRED deps (get→throw)?
```
