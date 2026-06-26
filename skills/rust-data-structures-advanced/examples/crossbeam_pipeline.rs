//! A bounded multi-stage pipeline with `crossbeam-channel` (MPMC) + scoped threads.
//!
//! The point: cross-thread work moves by *passing ownership down a channel*, so no stage ever
//! shares mutable state — there is no `Arc<Mutex<…>>` anywhere. Bounded channels give
//! backpressure (a fast producer blocks instead of OOMing). Graceful shutdown falls out of the
//! channel protocol: when a stage drops its sender, the downstream receiver observes disconnect
//! and its `for msg in rx` loop ends.
//!
//! Topology:
//!     producer ──(bounded)──> [worker × N] ──(bounded)──> collector
//!                              (MPMC fan-out/fan-in; crossbeam Receivers clone)
//!
//! Run: `cargo run --bin crossbeam_pipeline`

use crossbeam_channel::bounded;
use std::thread;

const N_WORKERS: usize = 4;
const N_ITEMS: u64 = 1_000;

fn main() {
    // Bounded for backpressure. Capacity is a deliberate buffer, not "unbounded, hope for the best".
    let (raw_tx, raw_rx) = bounded::<u64>(64);
    let (done_tx, done_rx) = bounded::<u64>(64);

    // Scoped threads: borrow the receivers without `'static` / `Arc`. `scope` joins all threads
    // before returning, so no detached threads outlive `main`.
    let total = thread::scope(|s| {
        // Stage 1: producer. Sends N_ITEMS, then drops `raw_tx` (scope end) → workers see close.
        s.spawn(move || {
            for i in 0..N_ITEMS {
                // `send` blocks if the bounded channel is full → natural backpressure.
                if raw_tx.send(i).is_err() {
                    break; // all receivers gone; stop early
                }
            }
            // raw_tx dropped here when the closure ends.
        });

        // Stage 2: N workers. Each clones the receiver (MPMC) and the result sender.
        // The work item is *owned* by the worker while processing — no shared state, no locks.
        for _ in 0..N_WORKERS {
            let rx = raw_rx.clone();
            let tx = done_tx.clone();
            s.spawn(move || {
                // `for x in rx` ends when every sender is dropped (the producer's, above).
                for x in rx {
                    let squared = x * x;
                    if tx.send(squared).is_err() {
                        break;
                    }
                }
                // this worker's clone of `done_tx` dropped here.
            });
        }
        // Drop the original handles so the channels can actually close once the
        // producer/workers finish. Without this, the collector would block forever waiting on
        // these still-open senders/receivers held by the main thread.
        drop(raw_rx);
        drop(done_tx);

        // Stage 3: collector runs on this thread. Ends when the last worker's `done_tx` drops.
        let mut sum = 0u64;
        for sq in done_rx {
            sum += sq;
        }
        sum
    });

    // 0² + 1² + … + (N-1)² = (N-1)·N·(2N-1)/6
    let n = N_ITEMS - 1;
    let expected = n * (n + 1) * (2 * n + 1) / 6;
    println!("pipeline sum of squares = {total} (expected {expected})");
    assert_eq!(total, expected, "every item flowed through exactly once");
    println!("ok: {N_WORKERS}-worker bounded MPMC pipeline, zero shared mutable state, clean shutdown");
}
