# Type-State, Newtypes, Sealed/Extension Traits, Builders, PhantomData

> All code in this file is verbatim from, or a minimal faithful reduction of, the
> cited source. URLs appear at the point of use.

---

## 1. Type-state programming

**What**: encode a value's *state* in its *type*, so a method that's invalid in the
current state simply does not exist, and transitions consume `self` so the old state
becomes uncallable.

**When to use**: a protocol/lifecycle with states known at compile time, driven by the
caller in a fixed order (open→use→close; unconfigured→configured→built; draft→sent).

**Anti-pattern it replaces**: a runtime flag (`bool is_open`, `state: u8`) plus
`assert!`/`panic!`/`if !valid { return Err(...) }` guards at the top of every method —
deferring a *programmer error* to runtime.

### The canonical shape (verbatim, Cliffle)

```rust
struct HttpResponse<S: ResponseState> {
    state: Box<ActualResponseState>,
    marker: std::marker::PhantomData<S>,
}

enum Start {}
enum Headers {}

trait ResponseState {}
impl ResponseState for Start {}
impl ResponseState for Headers {}

impl HttpResponse<Start> {
    fn status_line(self, code: u8, message: &str) -> HttpResponse<Headers> {
        // ...
    }
}
```

Source: <https://cliffle.com/blog/rust-typestate/> (corroborated by
<https://hoverbear.org/blog/rust-state-machine-pattern/>).

Key moves:
- **Markers are uninhabited enums** (`enum Start {}`). No value can be constructed, so
  the state is *only* a type-level tag; it can never be confused with real data.
- **`PhantomData<S>`** carries the type parameter `S` even though no `S` value is stored.
  It is **zero-sized** — the typed wrapper is the same size as the untyped one.
- **Transitions take `self` by value** and return the next type. As Cliffle puts it,
  "when we change states, the object in the previous state… can no longer be used."

**GOTCHA**: the transition *must* consume `self` by value — not `&self`/`&mut self`. If you
take `&mut self` you leave the old-state handle alive and callable, defeating the whole
guarantee. Moving `self` makes touching the previous state a *use-after-move* compile error.

### Why it's free

`PhantomData<S>` and uninhabited enums are zero-sized types:
`size_of::<HttpResponse<Start>>() == size_of::<HttpResponse<Headers>>()`. There is no
runtime branch, no tag byte — the state lives entirely in the type checker.

---

## 2. The newtype pattern

**What**: a single-field tuple struct wrapping another type to give it a distinct
identity, hide its representation, add invariants, or implement a foreign trait.

**When to use**: any time a primitive carries domain meaning (`UserId`, `NodeId`,
`Meters`), or you need to implement a trait you don't own on a type you don't own (the
orphan-rule escape hatch), or to swap representation without breaking callers
(C-NEWTYPE-HIDE).

**Anti-pattern it replaces**: "stringly-typed" / primitive-obsessed APIs where every id is
a bare `String`/`u64` and the compiler can't tell two of them apart.

```rust
use std::fmt::Display;

// Create Newtype Password to override the Display trait for String
struct Password(String);

impl Display for Password {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "****************")
    }
}
```

Source: <https://rust-unofficial.github.io/patterns/patterns/behavioural/newtype.html>

**Native-app tie-in**: branded ids. `struct NodeId(String); struct DagId(String);` make
`run(dag_id, node_id)` and `run(node_id, dag_id)` two *different* types — the swap stops
compiling. In a gpui pane registry, `struct PaneId(u16)` distinct from a raw nav index
means the "NAV slot index must equal producer slot index" invariant can be a *type*
boundary, not a comment.

**GOTCHAs**:
- A newtype does **not** inherit the inner type's methods/traits — that's the point, but
  it means you re-expose what you want (often via `Deref` *only if* the wrapper is genuinely
  pointer-like, or explicit forwarding methods, or `derive_more`).
- Don't put trait bounds on the struct itself (C-STRUCT-BOUNDS): never
  `struct Wrapper<T: Clone>(T)`. Put bounds on the impls. The exception is when the bound is
  required by a `Drop` impl or references an associated type.
  Source: <https://rust-lang.github.io/api-guidelines/future-proofing.html>

---

## 3. Sealed traits (C-SEALED)

**What**: a public trait that downstream crates can *call* but cannot *implement*, via a
private supertrait they can't name.

**When to use**: you expose a trait as an API contract (e.g. "these are the types my
function accepts") but want to keep the right to add methods later, or to guarantee an
exhaustive closed set of implementors.

**Anti-pattern it replaces**: a normal public trait — once downstream implements it, adding
any method is a breaking change, and you can never again assume a closed set of impls.

```rust
/// This trait is sealed and cannot be implemented for types outside this crate.
pub trait TheTrait: private::Sealed {
    // Zero or more methods that the user is allowed to call.
    fn ...();

    // Zero or more private methods, not allowed for user to call.
    #[doc(hidden)]
    fn ...();
}

// Implement for some types.
impl TheTrait for usize {
    /* ... */
}

mod private {
    pub trait Sealed {}

    // Implement for those same types, but no others.
    impl Sealed for usize {}
}
```

Source: <https://rust-lang.github.io/api-guidelines/future-proofing.html> — "we are
guaranteed that implementations of `Sealed` (and therefore `TheTrait`) only exist in the
current crate."

**GOTCHA**: sealing restricts *implementing*, not *calling*. Downstream still calls every
public method. The `private::Sealed` supertrait is unnameable outside your crate, so no
external `impl TheTrait` can satisfy the bound — which is exactly why you can add methods
later without breaking anyone. This is how `std` keeps traits like `Iterator`'s sealed
helpers extensible.

---

## 4. Extension traits

**What**: add methods to a type you don't own by defining a trait and implementing it for
that type; callers `use YourExt;` to bring the methods into scope.

**When to use**: ergonomic methods on foreign types (`itertools`'s `Itertools`,
`anyhow`'s `Context`). Often combined with sealing so only you can implement it.

**Convention** (verbatim, RFC 0445): "The extension trait should be called `FooExt` where
`Foo` is that type or trait."
Source: <https://rust-lang.github.io/rfcs/0445-extension-trait-conventions.html>

```rust
pub trait ResultExt<T> {
    fn or_log(self, msg: &str) -> Option<T>;
}

impl<T, E: std::fmt::Display> ResultExt<T> for Result<T, E> {
    fn or_log(self, msg: &str) -> Option<T> {
        match self {
            Ok(v) => Some(v),
            Err(e) => { eprintln!("{msg}: {e}"); None }
        }
    }
}
// caller: use crate::ResultExt;  then  some_result.or_log("load failed")
```

**GOTCHA**: extension-trait methods are only visible where the trait is `use`d. That's a
feature (no namespace pollution) but a surprise for users who can't find the method — document
the `use` line.

---

## 5. The builder pattern, done right

**What**: a fluent API to construct a value with many optional fields. The *idiomatic*
version (C-BUILDER) and the *type-safe* version (typestate builder).

**When to use**: a constructor with more than ~3 params, several optional, where positional
args become unreadable and `Default` can't express "this field is mandatory."

**Anti-pattern it replaces**: a giant `new(a, b, c, d, e, f)` (unreadable call sites), or
`Default` + post-construction mutation that allows half-built values, or a builder whose
`.build()` returns `Result` because a required field "might be `None`."

### Standard builder (verbatim, C-BUILDER)

```rust
impl Command {
    pub fn new(program: String) -> Command { /* ... */ }
    pub fn arg(&mut self, arg: String) -> &mut Command {
        self.args.push(arg);
        self
    }
    pub fn current_dir(&mut self, dir: String) -> &mut Command {
        self.cwd = Some(dir);
        self
    }
    pub fn spawn(&self) -> io::Result<Child> { /* ... */ }
}
```

Source: <https://rust-lang.github.io/api-guidelines/type-safety.html>. Use a
**non-consuming** builder (`&mut self -> &mut Self`, shown) by default; use a **consuming**
builder (`mut self -> Self`) only when a field must be *moved out* during build (e.g. a
`Box<dyn Write + Send>`).

### Typestate builders — required fields at compile time

`bon` (verbatim): a bare param is **required**; `Option<T>` is **automatically optional**.

```rust
#[builder]
fn greet(name: &str, level: Option<u32>) -> String {
    let level = level.unwrap_or(0);
    format!("Hello {name}! Your level is {level}")
}
let greeting = greet().name("Bon").level(24).call();
```

Source: <https://docs.rs/bon/latest/bon/> — the generated builders "use the typestate
pattern to ensure all required parameters are filled, and the same setters aren't called
repeatedly."

`typed-builder` (verbatim from the crate README; the docs.rs landing mirrors it):

```rust
#[derive(TypedBuilder)]
struct Foo {
    x: i32,
    #[builder(default, setter(strip_option))]
    y: Option<i32>,
    #[builder(default=20)]
    z: i32,
}
Foo::builder().x(1).build();   // ok, optionals omitted
Foo::builder().build();        // does NOT compile — missing x
```

Source: <https://docs.rs/typed-builder/latest/typed_builder/> (mirrors
<https://github.com/idanarye/rust-typed-builder>).

**GOTCHA (the one that bites)**: the two crates disagree on `Option`.
- In **`typed-builder`**, fields are **required by default**; wrapping in `Option<T>` does
  **not** make a field optional — you must add `#[builder(default)]`.
- In **`bon`**, `Option<T>` is optional automatically.

And the contrast with `#[derive(Default)]`: `Default` silently supplies a *runtime* zero
value for a missing field; a typestate builder makes a missing required field a **compile
error** — `.build()`/`.call()` is literally not a method until every required typestate slot
is filled. Both crates also make calling the same setter twice a compile error. This is the
type-state pattern (§1) applied to "which fields are set yet."

---

## 6. PhantomData and variance

**What**: `PhantomData<T>` is a zero-sized marker that tells the compiler your type "acts as
though" it owns/borrows a `T`, so variance, drop-check, and auto-traits are computed
correctly — required whenever a generic or lifetime parameter is otherwise structurally
unused.

**When to use**: typestate markers (§1); a type holding a `*const T`/`*mut T` that logically
owns or borrows `T`; FFI handles tagged with a lifetime; units-of-measure tags.

```rust
use std::marker;
struct Iter<'a, T: 'a> {
    ptr: *const T,
    end: *const T,
    _marker: marker::PhantomData<&'a T>,
}
```

Source: <https://doc.rust-lang.org/nomicon/phantom-data.html>

Variance / Send-Sync / drop-glue cheat sheet (verbatim from the Nomicon table):

| Phantom type | variance over `T`/`'a` | Send/Sync | owns `T` for dropck? |
|---|---|---|---|
| `PhantomData<T>` | covariant | inherited from `T` | **yes (disallowed in drop glue)** |
| `PhantomData<&'a T>` | covariant | `Send+Sync` iff `T: Sync` | no |
| `PhantomData<&'a mut T>` | invariant over `T` | inherited | no |
| `PhantomData<*const T>` | covariant | `!Send + !Sync` | no |
| `PhantomData<*mut T>` | invariant | `!Send + !Sync` | no |
| `PhantomData<fn(T)>` | contravariant | `Send+Sync` | no |
| `PhantomData<fn() -> T>` | covariant | `Send+Sync` | no |

**GOTCHAs**:
- An unused generic/lifetime param is a **hard error** `E0392` ("parameter is never used"),
  not a lint — because without a use the compiler can't infer variance, run drop-check, or
  decide auto-traits. `PhantomData` is the fix.
- Pick the marker for the semantics you want. `PhantomData<T>` is the only "owns a `T`"
  marker (use it for a `Vec`-like container so drop-check is sound). Raw-pointer markers
  deliberately make the type `!Send + !Sync` — you then opt back in with an explicit
  `unsafe impl Send`. The wrong marker silently over- or under-constrains drop-check and
  thread-safety.
