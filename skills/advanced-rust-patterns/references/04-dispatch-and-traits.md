# Dispatch & Traits: dyn vs generic, object safety, impl Trait / GAT, Deref

> Snippets verbatim from the Rust Book, the Reference, std docs, the rust-unofficial
> anti-patterns book, and the Rust release blog, cited at point of use.

---

## 1. Static (generic) vs dynamic (`dyn`) dispatch

**What**: two ways to call a trait method on differently-typed values.
- **Generic / monomorphized**: `fn f<T: Trait>(x: T)` — the compiler stamps out a separate
  copy per concrete `T`. Calls are direct, inlinable; **zero-cost**, but code bloats.
- **Trait object**: `Box<dyn Trait>` / `&dyn Trait` — one copy of the code, method resolved
  at runtime through a vtable pointer.

**When generic**: hot paths, one concrete type per call site, where inlining matters.
**When `dyn`**: heterogeneous collections (`Vec<Box<dyn Draw>>`), plugin registries, reducing
compile time / binary size, breaking a generic-instantiation explosion.

```rust
pub trait Draw {
    fn draw(&self);
}
pub struct Screen {
    pub components: Vec<Box<dyn Draw>>,
}
impl Screen {
    pub fn run(&self) {
        for component in self.components.iter() {
            component.draw();
        }
    }
}
```

Source: <https://doc.rust-lang.org/book/ch18-02-trait-objects.html>. Verbatim on the
trade-off: static dispatch — "The compiler generates nongeneric implementations… doing static
dispatch… knows what method you're calling at compile time" (zero-cost, code bloat); dynamic
dispatch — "at runtime, Rust uses the pointers inside the trait object… This lookup incurs a
runtime cost."

**Native-app tie-in**: a `Box<dyn Pane>` registry (as in `gpui-rust-console`) is the textbook
`dyn` case — you store mixed pane types in one `Vec` and call `view()` on each. The cost is one
vtable indirection per call, which is irrelevant at UI refresh rates. A per-frame math kernel,
by contrast, should be generic so it inlines.

**GOTCHA**: don't cargo-cult `Box<dyn>` into a tight numeric loop (vtable call defeats
inlining/vectorization), and don't cargo-cult generics into a plugin boundary (code bloat,
slower builds, and you often *can't* name the types anyway). Pick on the access pattern.

---

## 2. Object safety (a.k.a. "dyn compatibility")

A trait must be **dyn-compatible** to form `dyn Trait`. The rules (verbatim, the Reference):
- All supertraits must also be dyn compatible.
- `Sized` must not be a supertrait (the trait must not require `Self: Sized`).
- It must not have associated constants.
- It must not have associated types with generic parameters.
- All associated functions must be either dispatchable or explicitly non-dispatchable.
  **Dispatchable** functions must: have no type parameters (lifetimes are fine); be a method
  that does not use `Self` except in the type of the receiver; have a receiver of type
  `&Self`, `&mut Self`, `Box<Self>`, `Rc<Self>`, `Arc<Self>`, or `Pin<P>`; not have an opaque
  return type (no `async fn`, no `-> impl Trait`); and not have a `where Self: Sized` bound.
  **Explicitly non-dispatchable** functions require a `where Self: Sized` bound.

Source: <https://doc.rust-lang.org/reference/items/traits.html#dyn-compatibility>
(the Reference renamed "object safety" → "dyn compatibility" as of Rust 1.79+).

**The escape hatch**: a generic method, or one returning `Self` by value, makes the trait
non-dyn-compatible. Add `where Self: Sized` to *that method* to exclude it from the vtable; the
rest of the trait stays object-safe. This is exactly how `Iterator` keeps `dyn Iterator`
usable while `.map()`/`.collect()` (generic) live behind `Self: Sized`.

```rust
trait Registry {
    fn id(&self) -> u32;                        // dispatchable -> in the vtable
    fn make_default() -> Self where Self: Sized; // excluded -> dyn Registry still works
}
```

**GOTCHA**: the most common accidental break is adding an `async fn` or `-> impl Trait` method
to a trait you also use as `dyn` — both produce opaque return types and silently make the trait
non-dyn-compatible (see §4). Either avoid them, gate with `Self: Sized`, or use `async-trait` /
`trait_variant`.

---

## 3. Monomorphization tradeoffs (zero-cost, but not free to compile)

Generics are **zero runtime cost** but each instantiation generates code: more compile time,
larger binaries, instruction-cache pressure. Mitigations:
- **The "outer generic, inner dyn/concrete" sandwich**: keep the ergonomic generic signature,
  immediately erase to a non-generic inner fn so only *one* copy of the body is generated.

```rust
pub fn load(path: impl AsRef<Path>) -> io::Result<String> {
    fn inner(path: &Path) -> io::Result<String> { std::fs::read_to_string(path) }
    inner(path.as_ref())   // body monomorphized ONCE, not per caller type
}
```

This is the idiom `std::fs::read_to_string` itself uses. **GOTCHA**: it only pays off for
non-trivial bodies; for a one-liner the duplication is noise. Profile binary size / build time
before reaching for it.

---

## 4. The `impl Trait` / GAT / RPITIT toolbox

### `impl Trait` in argument vs return position

```rust
fn with_generic_type<T: Trait>(arg: T) {}
fn with_impl_trait(arg: impl Trait) {}        // APIT: anonymous generic param

fn returns_closure() -> impl Fn(i32) -> i32 { // RPIT: one hidden concrete type
    |x| x + 1
}
```

Source: <https://doc.rust-lang.org/reference/types/impl-trait.html>. APIT (argument position)
is "syntactic sugar for a generic type parameter… except that the type is anonymous." RPIT
(return position) names *one* hidden concrete type — every `return` "must resolve to the same
concrete type" (so you can't return two different closures from two branches; box them if you
must).

**When**: RPIT to return an iterator/closure/future without boxing or naming an unnameable
type. APIT for a throwaway generic param you never name elsewhere.

**GOTCHA**: `fn f(x: impl Trait)` *removes the turbofish* for that param — switching between
`impl Trait` and `<T: Trait>` is a **breaking change** (it changes the generic-argument arity,
so `f::<usize>(..)` stops compiling). Choose deliberately for public APIs.

### RPITIT — `impl Trait` in trait methods (Rust 1.75)

```rust
trait Container {
    fn items(&self) -> impl Iterator<Item = Widget>;
}
```

Source: <https://blog.rust-lang.org/2023/12/21/async-fn-rpit-in-traits/>. This (and `async fn`
in traits, which desugars to RPITIT) lets a trait method return an opaque type per impl.

**GOTCHA (verbatim)**: "Traits that use `-> impl Trait` and `async fn` are not object-safe." In
a *public* trait, RPITIT also auto-captures in-scope lifetimes and leaks the hidden type's
auto-traits (`Send`/`Sync`) into your API contract. If you need `dyn`, use `async-trait` or
`trait_variant::make`.

### GATs — generic associated types (Rust 1.65)

```rust
trait LendingIterator {
    type Item<'a> where Self: 'a;
    fn next<'a>(&'a mut self) -> Self::Item<'a>;
}
```

Source: <https://blog.rust-lang.org/2022/10/28/gats-stabilization/>. GATs let an associated
type be generic over a lifetime/type — the enabling feature for a `LendingIterator` that yields
items borrowing from `self` (impossible with plain `Iterator`).

**GOTCHA (verbatim)**: bounds like `where Self: 'a` "you must write… on the trait… you cannot
add clauses to associated types in impls that aren't there in the trait." The `where Self: 'a`
bound is effectively mandatory and lives on the trait definition. GATs are powerful but raise
the API's complexity — reach for them only when a lifetime-parametric associated type is the
actual requirement, not for style.

---

## 5. Deref for smart pointers — and the deref-polymorphism anti-pattern

### Legitimate use (verbatim, std)

```rust
use std::ops::Deref;
struct DerefExample<T> { value: T }
impl<T> Deref for DerefExample<T> {
    type Target = T;
    fn deref(&self) -> &Self::Target { &self.value }
}
let x = DerefExample { value: 'a' };
assert_eq!('a', *x);
```

Source: <https://doc.rust-lang.org/std/ops/trait.Deref.html>. Verbatim warning: "Deref coercion
is a powerful language feature… The compiler will silently insert calls to `Deref::deref`. For
this reason, one should be careful about implementing `Deref` and only do so when deref coercion
is desirable." Implement `Deref` when your type genuinely *is a pointer to* its `Target` — a
guard (`MutexGuard` → the data), a `Box`, an `Rc`, a smart wrapper.

### The anti-pattern: `Deref` as inheritance (verbatim, rust-unofficial)

```rust
struct Foo {}
impl Foo { fn m(&self) {} }
struct Bar { f: Foo }
impl Deref for Bar {
    type Target = Foo;
    fn deref(&self) -> &Foo { &self.f }
}
// b.m() calls Foo::m via deref coercion — fake "inheritance"
```

Source: <https://rust-unofficial.github.io/patterns/anti_patterns/deref.html>. Verbatim:
"Dereferencing usually gives a `T` from a reference to `T`, here we have two unrelated types."

**GOTCHA**: this fakes OOP inheritance and breaks in ways that surface far from the `impl`:
- **No true subtyping** — trait bounds satisfied by `Foo` are **not** satisfied by `Bar`, so it
  fails in any generic/`where`-bound context.
- **`self` differs** — inside `Foo::m`, `self` is `Foo`, not `Bar`; there is no overriding.
- It's *implicit* — readers don't expect `bar.m()` to jump types.

`Target` should answer "what's inside this pointer," never "what's my base class." For shared
behavior use a real trait; for forwarding a few methods, write them out or use `derive_more`'s
`Deref` *only* on genuine wrappers (single meaningful field).
