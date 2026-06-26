# Worked example: a daemon that "hangs" with one core pinned

**Symptom.** A Tokio-based daemon stops responding to its HTTP health check after a few minutes
under load. `top` shows one CPU core at 100% while the others sit idle; the process is alive but
new requests never get served. Attaching a debugger is tempting — and useless here.

## Step 0 — why `rust-lldb` is the wrong first move

```console
$ rust-lldb -p 41003
(lldb) bt all
* thread #1 ... tokio::runtime::scheduler::multi_thread::worker::run
  thread #2 ... tokio::runtime::park::...  parking_lot::...
...
```

The backtrace shows worker threads inside the runtime, not "task X is stuck on Y" — a suspended
`.await` is heap state, not a stack frame (see `references/05-lldb-and-build-link.md`). One core
pinned + a hang is the classic signature of a task that **never yields**, starving the executor.
The right tool is `tokio-console`.

## Step 1 — instrument for tokio-console

```toml
# Cargo.toml
console-subscriber = "0.5"
tokio = { version = "1", features = ["full", "tracing"] }   # "tracing" feature is required
```

```rust
#[tokio::main]
async fn main() {
    console_subscriber::init();   // before anything spawns
    run_daemon().await;
}
```

```toml
# .cargo/config.toml — without tokio_unstable, the console shows NO task data
[build]
rustflags = ["--cfg", "tokio_unstable"]
```

```console
$ cargo run        # rebuilds with the cfg
$ tokio-console    # in another terminal → connects to http://127.0.0.1:6669
```

## Step 2 — read the warning

The console task list flags one task in red:

```
 Warnings
 ⚠ 1 task has never yielded (task is blocking the runtime)

 ID  STATE  NAME            BUSY        IDLE   POLLS  LOCATION
  7  BUSY   metrics_roll   3m41s         0s       1   src/metrics.rs:88
  3  IDLE   http_accept       0s      3m41s     412   src/server.rs:51
  ...
```

`never-yielded`, **BUSY 3m41s, 1 poll, 0 idle** — task 7 entered `poll` once and never returned.
It is monopolizing a runtime worker thread; on a small worker pool that throttles everything,
including the health check. (`lost-waker`, by contrast, would mean a task dropped without being
woken — a *deadlock/leak*, no CPU. `self-wakes` would mean wakeup churn. Here it's clearly
executor starvation.)

## Step 3 — find the offending code

`src/metrics.rs:88`:

```rust
async fn metrics_roll(db: Db) {
    loop {
        let snapshot = expensive_aggregate(&db);   // CPU-bound, ~seconds, NO .await inside
        publish(snapshot);
        // no sleep, no yield — loops straight back, never returns to the scheduler
    }
}
```

Two problems: a tight loop with no `.await`, and CPU-bound work run directly on a runtime worker.
Both keep the worker from polling other tasks.

## Step 4 — fix

```rust
async fn metrics_roll(db: Db) {
    let mut tick = tokio::time::interval(std::time::Duration::from_secs(10));
    loop {
        tick.tick().await;                          // yields to the scheduler every 10s
        // move CPU-bound work off the async workers entirely:
        let db = db.clone();
        let snapshot = tokio::task::spawn_blocking(move || expensive_aggregate(&db)).await.unwrap();
        publish(snapshot);
    }
}
```

`tick().await` returns control to the scheduler; `spawn_blocking` runs the heavy aggregate on the
blocking pool so it never holds an async worker. Back in tokio-console, task 7 now shows healthy
**idle** time between ticks and the `never-yielded` warning is gone; the health check responds
again.

---

## What this example exercised

- Symptom → tool routing: a hang (esp. one core pinned) is a **scheduler** problem; go to
  `tokio-console`, not `lldb`.
- The `console-subscriber` + `tokio "tracing"` feature + `RUSTFLAGS="--cfg tokio_unstable"` setup.
- Reading the `never-yielded` warning and BUSY/IDLE/POLLS columns, and distinguishing it from
  `lost-waker` (deadlock/leak) and `self-wakes` (wakeup churn).
- The two real fixes: yield with `interval().tick().await`, and offload CPU work with
  `spawn_blocking`.

Full reference: `references/01-tracing-and-async.md`.
