# Testing async & concurrent Rust

Consult when testing `async fn`, futures, channels, shared-state concurrency, or
chasing a flaky test.

## The non-negotiable: `#[tokio::test]`, never `#[test]` on an async fn

```rust
// WRONG: #[test] cannot drive a future — it won't compile, or (with a returned
// future type) it compiles and never runs the body.
#[test]
async fn fetches() { /* ... */ }

// RIGHT
#[tokio::test]
async fn fetches() {
    let client = Client::new("http://127.0.0.1:0".into()); // unroutable
    assert!(client.get("/health").await.is_err());          // fails gracefully
}

// Multi-threaded runtime when the test needs real parallelism:
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_writers() { /* ... */ }

// Deterministic time: pause the clock and advance it by hand.
#[tokio::test(start_paused = true)]
async fn times_out() {
    let fut = with_timeout(Duration::from_secs(30), forever());
    tokio::time::advance(Duration::from_secs(31)).await;
    assert!(fut.await.is_err());
}
```

`async-std` users: `#[async_std::test]`. Smol: `#[test]` + `smol::block_on`.

## Always bound async tests with a timeout

A hung future makes a test *hang the whole suite*, not fail. Wrap anything that
could block on I/O or a lock:

```rust
#[tokio::test]
async fn responds() {
    let r = tokio::time::timeout(Duration::from_secs(5), server.handle(req)).await;
    assert!(r.is_ok(), "handler hung past 5s");
}
```

CI should also set a per-test wall clock (`cargo nextest` has `slow-timeout` +
`leak-timeout`; plain `cargo test` does not — nextest is worth it for async-heavy
suites precisely for this).

## Object-safe async trait methods without `async-trait`

When you can't or won't pull `async-trait`, return a boxed future so the trait
stays object-safe (storable as `dyn Trait`):

```rust
trait Refresh: Send {
    fn refresh<'a>(&'a mut self, c: &'a Client)
        -> std::pin::Pin<Box<dyn std::future::Future<Output = anyhow::Result<()>> + Send + 'a>>;
}
// impl: fn refresh<'a>(...) -> ... { Box::pin(async move { ... }) }
```

Test it with `#[tokio::test]` like any other async method. (Native RPITIT —
`async fn` in traits — is stabilizing but not yet object-safe; the boxed-future
form is what works for `dyn` today.)

## Concurrency-bug testing

### `loom` — exhaustive interleaving search for lock-free code

```rust
#[test]
fn no_lost_update() {
    loom::model(|| {
        let n = loom::sync::Arc::new(loom::sync::atomic::AtomicUsize::new(0));
        let h = { let n = n.clone(); loom::thread::spawn(move || { n.fetch_add(1, SeqCst); }) };
        n.fetch_add(1, SeqCst);
        h.join().unwrap();
        assert_eq!(n.load(SeqCst), 2);
    });
}
```

`loom` explores *every* legal thread interleaving and memory ordering — it finds
the 1-in-a-billion race a stress loop never hits. Gate it behind `cfg(loom)` and
use `loom::sync`/`loom::thread` (not `std`) inside the model. Slow; run it as its
own job, not in the main matrix.

### ThreadSanitizer — for data races in real (not modeled) code

```bash
RUSTFLAGS="-Zsanitizer=thread" cargo +nightly test --target aarch64-apple-darwin
```

Catches actual data races at runtime. Nightly + a target triple required.

## Flaky-test discipline

A flaky test is a bug report, not noise. Root causes, in order of frequency:

1. **Shared mutable global / fixed resource** (a port, a file, an env var, a
   singleton). Fix: isolate per-test (random port, `tempfile`), or serialize with
   `#[serial]` (serial_test). Two `#[tokio::test]`s both binding `127.0.0.1:9999`
   is the classic.
2. **Real wall-clock sleeps / `Instant::now()`**. Fix: inject the clock (pure
   core) or use `tokio::time::pause`.
3. **Ordering assumptions on concurrent output** (HashMap iteration, join order).
   Fix: assert on a sorted/normalized view, not arrival order.
4. **Unawaited background task** racing the assertion. Fix: `await` a readiness
   signal (a channel recv), never a `sleep` to "let it finish".

Never "fix" flakiness with a retry wrapper or a longer sleep — that hides the
race and slows the suite. Quarantine (`#[ignore]` with a tracking issue) only as
a last resort, and treat the issue as open work.
