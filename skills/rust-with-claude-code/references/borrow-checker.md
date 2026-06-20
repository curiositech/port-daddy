# Borrow Checker Patterns for AI-Paired Rust

> The borrow checker is where Rust+AI sessions stall. The fix is almost never "more
> lifetimes" — it's reshaping the access pattern. These are the four shapes that cover
> >90% of console/daemon errors, each with the constraint Claude pattern-matches on.

## Read what Claude needs to fix a borrow error

Paste three things, every time (use `scripts/cargo_diagnostics.py` to capture them):

1. The **full** rendered diagnostic, including the `note:` and `help:` lines and the error
   code (`E0502`, `E0499`, `E0382`, …). The error code *is* the category.
2. 10–15 lines around the primary span.
3. One sentence of intent: "I want to read `agents[i].channel`, then set
   `agents[i].cursor = 0`." Claude solves the *constraint shape*; intent disambiguates
   which reshape you want.

## Shape 1 — read a field, then mutate the struct (E0502)

```rust
// WRONG: the immutable borrow of self.agents[i] is still live at the mutation
let channel = &self.agents[i].channel;
self.agents[i].cursor = 0;          // E0502: cannot borrow as mutable

// RIGHT: end the borrow by cloning the (cheap) value first
let channel = self.agents[i].channel.clone();
self.agents[i].cursor = 0;
```

If the field is `Copy`, drop the `.clone()` (clippy `clone_on_copy`). If it's expensive,
scope the read in a block so the borrow ends before the mutation:

```rust
let channel = { let a = &self.agents[i]; a.channel.clone() };  // borrow ends at `}`
self.agents[i].cursor = 0;
```

## Shape 2 — self reference inside an async move closure

`pd-console`'s `mutate` paths hit this: you can't hold `&self` across an `.await` that also
needs `&mut self`. Extract owned bindings *before* the await (this is the real pattern from
the cockpit's send path):

```rust
let (channel, backend) = {
    let a = self.agents.get(&local)?;     // borrow lives only in this block
    (a.channel.clone(), a.backend)
};
// borrow released; now the await is free of any self borrow conflict
self.client.tube_send(&channel, text, "operator").await
```

## Shape 3 — mutate a collection while iterating (E0499)

You cannot remove from a `Vec` while iterating it. Collect indices, then apply in reverse
(reverse so earlier removals don't shift later indices):

```rust
let to_remove: Vec<_> = self.items.iter().enumerate()
    .filter(|(_, it)| it.should_remove())
    .map(|(i, _)| i)
    .collect();
for i in to_remove.into_iter().rev() {
    self.items.remove(i);
}
```

Or, when you don't need the indices, `self.items.retain(|it| !it.should_remove());`.

## Shape 4 — two mutable borrows of disjoint fields (E0499)

The checker is field-insensitive across a method call but field-sensitive within a
function. If you need `&mut self.a` and `&mut self.b` at once, take them in one statement
so the compiler sees they're disjoint, or use `split_at_mut` for two slice halves:

```rust
let Self { agents, scroll, .. } = self;   // destructure: disjoint &mut to each field
update_rows(agents);
scroll.reset();
```

## The push-back list (when Claude suggests the wrong reshape)

- ✗ `.unwrap()` to dodge a borrow → "Use `?` or `.ok_or_else()`; never `.unwrap()` outside
  tests." (clippy `unwrap_used`.)
- ✗ `Arc<Mutex<T>>` to "share" between the producer/consumer threads → "We use `mpsc`
  channels; `Arc<Mutex>` blocks the GPUI renderer" (see `gpui-rust-console`).
- ✗ `clone()` on a `Copy` type → it's a copy already (clippy `clone_on_copy`).
- ✗ `&Box<T>` parameter → take `&T` (clippy `borrowed_box`).
- ✗ Lengthening a lifetime to silence the checker → almost always the wrong fix; reshape
  the access (Shapes 1–4) instead.

## clippy: signal vs noise in this codebase

| Lint | Verdict |
|------|---------|
| `borrowed_box`, `clone_on_copy`, `unwrap_used` | **Fix** — real bugs/sloppiness |
| `needless_lifetimes`, `redundant_clone` | **Fix** — usually right |
| `type_complexity` | **Ignore in GPUI code** — element builders are complex by design |
| `upper_case_acronyms` | **Ignore** — `PD`/`API` naming is intentional |

Run `cargo clippy` every session; it catches real bugs, not just style. Treat a *new*
clippy warning as a regression.
