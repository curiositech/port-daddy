# Tracing, structured logging, and async debugging

> Crate versions current as of June 2026: `tracing` 0.1.44, `tracing-subscriber` 0.3.22,
> `console-subscriber` 0.5.0. Pin in `Cargo.toml` with `"0.1"` / `"0.3"` / `"0.5"`.

Two questions live here. *"What happened, in what causal order?"* → `tracing`. *"Which task
is stuck or starving the executor?"* → `tokio-console`. Neither is a stepping debugger; both
beat `lldb` for async.

---

## 1. `tracing` + `tracing-subscriber`

### Setup

```toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }   # "env-filter" gates EnvFilter
# add "json" for production structured logs:
# tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
```

`tracing_subscriber::fmt()` returns a builder; terminate with `.init()` (installs the global
default + a `log` compatibility shim) or `.finish()` (returns it for manual install).

```rust
use tracing_subscriber::EnvFilter;

// Simplest — reads RUST_LOG, INFO if unset:
tracing_subscriber::fmt::init();

// Canonical production setup — explicit EnvFilter with a hardcoded fallback:
tracing_subscriber::fmt()
    .with_env_filter(
        EnvFilter::try_from_default_env()              // reads RUST_LOG
            .unwrap_or_else(|_| EnvFilter::new("info")),
    )
    .init();

// JSON, newline-delimited, for log aggregators (needs the "json" feature):
tracing_subscriber::fmt()
    .json()
    .with_env_filter(EnvFilter::from_default_env())
    .init();
```

Useful builder knobs: `.compact()`, `.with_file(true)`, `.with_line_number(true)`,
`.with_thread_ids(true)`, `.with_target(false)`.

### `#[tracing::instrument]`

> *"Automatically creates and enters a tracing span whenever an instrumented function is
> called."* Default: an INFO-level span named after the function, recording **all arguments**
> as fields.

| Option | Effect |
|---|---|
| `skip(a, b)` | exclude args (skipped args need not implement `Debug`) |
| `skip_all` | omit all arguments |
| `fields(k = expr)` | add custom fields; a bare `field_name` declares an empty field for later `.record()` |
| `level = "trace"` | override span level |
| `name = "..."` / `target = "..."` / `parent = ...` | rename / retarget / reparent |
| `ret` / `ret(Debug)` / `ret(Display)` | emit an event with the return value (only `Ok` for `Result`) |
| `err` / `err(Debug)` / `err(Display)` | emit an ERROR event when a `Result` returns `Err` |

```rust
#[tracing::instrument(
    name = "Handler::run",
    skip(self),
    fields(peer_addr = %self.connection.peer_addr().unwrap()),
    err,
)]
async fn run(&mut self) -> mini_redis::Result<()> { /* ... */ }
```

`#[instrument]` **fully supports `async fn`** and generates correct code (it instruments the
generated future — it does **not** naively hold a guard across `.await`). It works with
`async-trait`. Limitation: `const fn` cannot be instrumented (compile error).

### Spans vs events, and the `%` / `?` sigils

A **span** is a period of work with a beginning and end; an **event** (`info!`, `warn!`, …) is
a point in time, usually within a span.

```rust
info!(user_id = %id, count = items.len(), "request handled");
//              ^Display       ^plain Value sigil-less  ^ trailing str = the `message` field
debug!(req = ?request, "decoded");   // ?  => fmt::Debug
warn!(%cause, "failed to parse command from frame");  // % => fmt::Display, field name = `cause`
```

- `%expr` records via `Display`. `?expr` records via `Debug`. No sigil ⇒ the value must
  implement `tracing::Value` (primitives, `&str`).
- A bare local name records `name = name`.
- Dotted field names are allowed: `question.answer = answer, question.tricky = true`.

### `EnvFilter` / `RUST_LOG` directive grammar

Full directive shape: `target[span{field=value}]=level`. Comma-separated; **most specific match
wins**. Levels: `trace|debug|info|warn|error|off`.

```bash
# per-target levels (the everyday form):
RUST_LOG=info,my_crate=debug,my_crate::module=trace cargo run

# span-scoped:
RUST_LOG='my_crate[span_a]=trace'           # spans named span_a within my_crate
RUST_LOG='[span_b{name="bob"}]'             # any span span_b whose field name == bob
RUST_LOG='[{field}]=trace'                  # any span that has a field named `field`
RUST_LOG='warn,tokio::net=info'             # global warn+, but tokio::net at info+
```

---

## 2. `tokio-console` — the async debugger

A live `top(1)` for async tasks. Two pieces: the `console-subscriber` crate (instruments your
app, serves gRPC telemetry) and the `tokio-console` TUI client.

### Setup (three things, all required)

```toml
[dependencies]
console-subscriber = "0.5"
tokio = { version = "1", features = ["full", "tracing"] }   # the "tracing" feature is mandatory
```

```rust
#[tokio::main]
async fn main() {
    console_subscriber::init();   // serves telemetry + logs to stdout per RUST_LOG
    // ...
}
```

The runtime instrumentation is gated behind `tokio_unstable`. Without it you get **no task
data**:

```bash
RUSTFLAGS="--cfg tokio_unstable" cargo run
```

Persist it so every build picks it up:

```toml
# .cargo/config.toml
[build]
rustflags = ["--cfg", "tokio_unstable"]
```

> If you compose your *own* `EnvFilter` instead of `console_subscriber::init()`, you must
> enable the `tokio` and `runtime` targets at `TRACE`: `...,tokio=trace,runtime=trace`.

### Run

```bash
cargo install --locked tokio-console
tokio-console                              # connects to default http://127.0.0.1:6669
tokio-console http://my.host.local:5555    # custom target
```

### The built-in warnings (this is the payoff)

| Lint | Meaning | Diagnoses |
|---|---|---|
| `never-yielded` | a task has never yielded | a `.await`-free hot loop or a blocking syscall **starving the executor** (one core pinned, others idle) |
| `lost-waker` | a task was dropped without being woken | a **leaked/deadlocked task** that will never complete |
| `self-wakes` | a task wakes itself beyond a threshold % of wakeups | busy-loop wakeup churn |
| `auto-boxed-future` | the runtime auto-boxed the task's future | oversized state machine |
| `large-future` | the task's future occupies a lot of stack | the same, severe |

Per-task detail shows **busy vs idle time**, **poll counts**, and wakeups. A deadlock shows as
tasks with high idle time and a `lost-waker`; executor starvation shows as one `never-yielded`
task with huge busy time.

---

## 3. Debugging stuck / cancelled futures and the two-executor footgun

### Why a normal backtrace is useless here

A suspended `.await` is **heap state inside a state machine, not a stack frame**. The executor
only ever calls `Future::poll` on the *outermost* future, so `bt` shows poll/runtime frames, not
"task A is awaiting a lock held by task B." Symptoms map cleanly:

- **No CPU, hung** → deadlock. Two tasks each awaiting a resource the other holds, or a future
  whose waker was dropped (`lost-waker`).
- **One core at 100%, hung** → a `.await`-free loop or a blocking call (`std::fs`, `reqwest::blocking`,
  a `Mutex` held across `.await`, a CPU loop) on a runtime worker thread → `never-yielded`.

Tools, in order: `tokio-console` (`lost-waker`/`never-yielded`) → `#[async_backtrace::framed]`
to dump the *logical* task tree including suspended tasks → `tracing` spans for await-chain
causality.

### Cancellation bugs

A future is cancelled by being **dropped** — there is no `Drop`-runs-async hook. Two classic bugs:

- **Lost cleanup**: work after an `.await` never runs because the future was dropped at that
  `.await` (e.g. a `select!` branch lost the race). Put cleanup in a real `Drop` impl or a
  cancellation-safe guard, not in code after the await.
- **Holding a lock across `.await` then being cancelled**: the guard drops on cancel, but any
  invariant you were mid-mutating is now half-applied. Audit every `.await` that runs while a
  `MutexGuard` / transaction is live.

Make cancellation observable: add a span that logs on `Drop`, or instrument the future so
tokio-console shows it vanishing.

### The two-executor footgun

`reqwest` (and most HTTP clients) require a **Tokio** runtime; GPUI runs on **smol**; they
**cannot share an executor**. Calling a tokio-requiring future from a smol context (or vice
versa) panics with *"there is no reactor running, must be called from the context of a Tokio
1.x runtime"* or simply hangs. The fix is not "nest a runtime" (that deadlocks the worker) —
it is to run each executor on its own thread and pass data over a channel
(`std::sync::mpsc` / `tokio::sync::mpsc`), never an `Arc<Mutex<State>>` shared across the two.
This is exactly the pd-console producer/consumer split documented in `gpui-rust-console`; the
debugging tell is a hang or a "no reactor" panic at the boundary between the two worlds.
