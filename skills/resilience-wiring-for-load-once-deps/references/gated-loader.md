# The Gated Loader (copy-pasteable)

> For the general breaker + full-jitter backoff mechanics (state machine, jitter
> formula, retry budgets, Resilience4j defaults), see **[[circuit-breakers-and-retries]]**.
> This file is ONLY the load-once wrapper that composes those primitives around a
> memoized dependency so a failure is never cached as a poison pill.

Assumes you already have a `CircuitBreaker` with `before(key)` (throws
`CircuitOpenError` while OPEN + cooling), `onSuccess(key)`, `onRetryableFailure(key)`
— exactly the shape the canon skill defines. Dependency-free; inject clock/sleep
for tests.

```ts
export interface GatedLoader<T> {
  get(): Promise<T>;           // REQUIRED deps: throws CircuitOpenError when down
  tryGet(): Promise<T | null>; // OPTIONAL enrichment: returns null when down → caller skips
  state(): 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export function createGatedLoader<T>(
  load: () => Promise<T>,
  cfg: { name: string; failureThreshold?: number; openTimeoutMs?: number;
         breaker: CircuitBreaker;                       // from circuit-breakers-and-retries
         governedLog?: (key: string, msg: string) => void },
): GatedLoader<T> {
  const { name, breaker } = cfg;
  let value: T | undefined, loaded = false;
  let inFlight: Promise<T> | null = null;   // (3) coalesce concurrent callers onto ONE load

  async function attempt(): Promise<T> {
    breaker.before(name);                    // throws if OPEN + cooling → no re-load, no re-log
    try {
      value = await load(); loaded = true;   // (1) only SUCCESS is memoized
      breaker.onSuccess(name);
      return value;
    } catch (err) {
      breaker.onRetryableFailure(name);
      cfg.governedLog?.(`dependency_load_failed:${name}`, String(err)); // (2) ONE line/window
      throw err;                             // we THROW; we never cache the rejection
    }
  }

  async function get(): Promise<T> {
    if (loaded) return value as T;
    if (inFlight) return inFlight;           // a burst shares the one in-flight load
    inFlight = attempt().finally(() => { inFlight = null; });
    return inFlight;
  }

  async function tryGet(): Promise<T | null> {
    try { return await get(); }
    catch { return null; }                   // optional work simply skipped when down
  }

  return { get, tryGet, state: () => breaker.state(name) };
}
```

## The three properties that kill the storm

1. **Only success is memoized.** `loaded` flips to `true` only on the happy path.
   A failure leaves `loaded = false`, so the breaker — not a cached rejection —
   decides whether the next call re-attempts. There is no poison pill to re-await.
2. **The load failure is governed.** `governedLog` reports once per window, not
   once per tick. (Any rate-limiting log sink works; the point is it's bounded.)
3. **Concurrent callers coalesce.** `inFlight` means a burst of N callers during a
   cold load triggers ONE `load()`, not N. Without this, the first-call stampede
   can itself knock over the dependency you're trying to protect.

## Contrast: the exact bug this replaces

```ts
// ANTI-PATTERN — a rejected promise, cached forever, re-awaited every tick.
let embedderPromise: Promise<Embedder> | undefined;
function getEmbedder() {
  if (!embedderPromise) embedderPromise = loadOnnxEmbedder(); // never reset on failure
  return embedderPromise;                                     // returns the SAME rejection forever
}
```

`loadOnnxEmbedder()` rejects once (missing dylib). `embedderPromise` is now a
permanently-rejected promise. Every `await getEmbedder()` re-throws + re-logs it.
7,182 ticks → 313 GB. The gated loader's `loaded`-only-on-success + breaker gate
is the structural fix.

## Wiring checklist (the part people skip)

Writing `createGatedLoader` is not the deliverable — **routing the live call site
through it** is. After you add it:

```bash
# The old memoized singleton must have NO remaining callers.
grep -rn 'embedderPromise\|getEmbedder' src   # → only the gated loader's internals
# The gated loader must be imported by LIVE code, not just tests.
grep -rln 'createGatedLoader' src | grep -v test   # → must be non-empty
```
