# Example: fix an E0502 with the capture-and-verify loop

A real borrow-checker stall in `core/pd-console`, fixed the way this skill prescribes:
capture the full diagnostic, identify the shape, reshape, verify.

## The failing code

```rust
// in some lane_pane.rs method:
let channel = &self.agents[i].channel;   // immutable borrow of self.agents[i]
self.agents[i].cursor = 0;               // <-- mutable borrow while the above is live
self.client.tube_send(channel).await;
```

## 1. Capture the full diagnostic (don't hand-trim)

```bash
python3 skills/rust-with-claude-code/scripts/cargo_diagnostics.py run --crate core/pd-console
```

The digest's `paste_to_claude` field has the whole rendered block plus the code:

```
error[E0502]: cannot borrow `self.agents` as mutable because it is also borrowed as immutable
  --> src/lane_pane.rs:NN:9
```

Paste THAT (not just line 1) to Claude, with the 10 surrounding lines and one sentence of
intent: *"I want to read the channel, then reset the cursor, then send."*

## 2. Identify the shape

Error code `E0502` + "mutate while borrowed" = **Shape 1** in
`references/borrow-checker.md`: read a field, then mutate the struct. The borrow of
`channel` is still live at the `cursor = 0` line and across the `.await`.

## 3. Reshape (don't lengthen a lifetime)

Clone the cheap value to end the borrow before the mutation and the await:

```rust
let channel = self.agents[i].channel.clone();   // borrow ends here
self.agents[i].cursor = 0;                       // free to mutate now
self.client.tube_send(&channel).await;           // owned String, no self borrow held
```

If `channel` were expensive, scope the read in a block instead (still Shape 1). The wrong
fix — adding `'a` lifetimes to silence the checker — would just move the conflict.

## 4. Verify with the same loop the agent uses

```bash
python3 skills/rust-with-claude-code/scripts/cargo_diagnostics.py run --crate core/pd-console
# expect: {"ok":true,"errors":0,...}
cargo test   # and the gate stays green
```

For an autonomous fix, hand the agent the verify command up front (see
`references/claude-collaboration.md` "the autonomous-edit invocation") so it iterates to
`ok:true` instead of declaring victory on the first compile.

## Why the digest matters

Pasting only `error[E0502]: cannot borrow ...` strips the `note:`/`help:` lines that name
*which* borrow is live and *where* it ends — the exact information that tells Claude which
of the four reshapes applies. The `cargo_diagnostics.py` digest keeps the whole block, so
the constraint shape survives the copy-paste.
