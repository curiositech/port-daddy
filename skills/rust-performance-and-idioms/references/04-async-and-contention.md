# 04 — Async performance & lock contention

> Sources: Alice Ryhl, "Async: What is blocking?"
> (<https://ryhl.io/blog/async-what-is-blocking/>), Tokio `spawn_blocking` docs,
> and crossbeam.

Two failure families dominate real Rust perf incidents that aren't allocation:
**(a) blocking the async executor** and **(b) threads fighting over a lock**.
Both show up as latency, not CPU — the work isn't expensive, it's *waiting*.

## Part A — Don't block the executor

`async` does not mean "non-blocking". An async runtime multiplexes many tasks
onto a few worker threads. A task that runs CPU-bound work, or calls a *blocking*
syscall, between `.await` points holds its worker thread hostage — every other
task scheduled on that worker stalls. This is the classic cause of "p99 latency
spiked but CPU was idle".

**Rule of thumb (Alice Ryhl):** a task should not go more than **~10–100 µs**
without hitting an `.await`. Beyond that, you're blocking.

### What counts as blocking

- CPU-bound loops (parsing, hashing, compression, image work)
- `std::fs`, `std::net`, `std::io::stdin` (synchronous IO)
- `reqwest::blocking`, blocking DB drivers (`postgres`, not `tokio-postgres`)
- `std::thread::sleep` (use `tokio::time::sleep`)
- `Mutex::lock` on a `std::sync::Mutex` held across contention (see Part B)

### The fixes

```rust
// Blocking IO (file, blocking DB driver) → spawn_blocking:
let contents = tokio::task::spawn_blocking(move || std::fs::read(path)).await??;

// CPU-bound work → rayon (a real CPU pool), bridged back with a channel:
let (tx, rx) = tokio::sync::oneshot::channel();
rayon::spawn(move || { let out = heavy_compute(input); let _ = tx.send(out); });
let out = rx.await?;
```

`spawn_blocking`'s pool is sized for **blocking IO**, not compute — it can grow
to ~500 threads, so flooding it with CPU-bound tasks creates hundreds of threads
fighting for a handful of cores. For genuine parallel compute use `rayon` (pool
sized to cores) or a bounded `spawn_blocking` count guarded by a `Semaphore`.

### Other async perf wins

- **Buffer concurrency**: `stream::iter(work).buffer_unordered(N)` runs N
  futures at once instead of awaiting them one by one — huge for IO fan-out.
  Pick N to bound resource use; unbounded concurrency is its own outage.
- **Don't `block_on` inside a task.** Nesting runtimes deadlocks or stalls.
- **Two runtimes cost real money.** `reqwest` needs a Tokio reactor; some UI
  runtimes (smol/GPUI) are separate executors that *cannot share* a reactor.
  Don't try to make them share — bridge them with a channel and let each own its
  thread (this is exactly the pattern `gpui-rust-console` documents).
- **Right-size the buffer/channel.** An unbounded channel papers over
  backpressure until you OOM; a bounded channel propagates it.

**When inline work is fine**: a few microseconds of synchronous work between
awaits is normal and `spawn_blocking` overhead would cost more than it saves.

## Part B — Lock contention: `Arc<Mutex<T>>` is not the default

A `Mutex` serializes access. Under contention it does two bad things: threads
queue (losing the parallelism you spun them up for), and the lock's cache line
ping-pongs between cores. The fix is usually to **share less**, not to lock
faster.

### The ladder, cheapest sharing first

| Situation | Reach for | Why |
|-----------|-----------|-----|
| A counter / flag | `AtomicUsize`/`AtomicBool` | Lock-free; one instruction |
| One producer, one+ consumers | a **channel** (`mpsc`, `crossbeam`) | One owner; no shared mutable state at all |
| Many keys, sharded access | N mutexes over N buckets (or `dashmap`) | Threads rarely hit the same shard |
| Reads ≫ writes | `RwLock` | Concurrent readers; but writers still serialize |
| Rare, coarse shared state | `Arc<Mutex<T>>` | Fine when contention is low — measure it |

### Message passing beats shared state

The single most effective de-contention move is to give the data **one owner**
and send messages to it, rather than sharing it behind a lock. This is the
producer/consumer model: a producer thread owns the state and `mpsc`s snapshots
to consumers; control flows back on a second channel. No mutex, no contention,
and the ownership is legible. `gpui-rust-console` calls a `Mutex` reachable from
its render path the **#1 perf bug** for exactly this reason — the producer holds
it, the GPUI consumer needs it, the frame janks.

### Sharding

When you genuinely need shared mutable keyed state (a cache, a registry), don't
wrap one big `HashMap` in one `Mutex`. Split into N shards each with its own
lock (or use `dashmap`, which does this for you). Two threads touching different
keys now rarely collide.

### False sharing on the lock/atomics

Even lock-free atomics contend if two hot atomics share a cache line — pad them
with `CachePadded` (reference 02). A SPSC queue should put `head` and `tail` on
separate lines so the producer and consumer don't invalidate each other.

**When `Arc<Mutex>` is right**: low-frequency shared config, coarse state touched
rarely, or a prototype before you've *measured* contention. Don't pre-shard code
that isn't contended — you'd add complexity for no win. Confirm contention first:
`perf`/Instruments time in `__psynch_mutexwait`/futex waits, or sub-linear
scaling as you add cores.

## Detecting these in the wild

- **`tokio-console`**: shows tasks with long poll times (blocking) and busy vs
  idle worker threads.
- **Flamegraph**: wide `__psynch_mutexwait` / `futex` = lock contention; wide
  compute under an async worker = a blocked executor.
- **Scaling test**: if 2× cores ≠ ~2× throughput, you're contended or serialized.

## Sources

- Alice Ryhl, "Async: What is blocking?": <https://ryhl.io/blog/async-what-is-blocking/>
- Tokio `spawn_blocking`: <https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html>
- "How thread starvation killed our production server":
  <https://savannahar68.medium.com/how-thread-starvation-killed-our-production-server-fb5ba855aa57>
- crossbeam channels: <https://docs.rs/crossbeam-channel/>
- dashmap: <https://docs.rs/dashmap/>
