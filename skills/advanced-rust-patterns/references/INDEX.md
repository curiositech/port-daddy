# References

Load only the file that matches the question in front of you. Each is a deep dive
behind a row of the SKILL.md decision table; SKILL.md is the index, these are the leaves.

- `01-type-state-and-newtypes.md`: type-state state machines (PhantomData + uninhabited
  markers, transitions that consume `self`), the newtype pattern, sealed traits (C-SEALED),
  extension traits, the standard *and* typestate builder (bon vs typed-builder), and
  PhantomData/variance. Read when designing an API that should make illegal states or call
  orders unrepresentable.
- `02-interior-mutability-and-raii.md`: the interior-mutability decision tree
  (Cell/RefCell/Mutex/RwLock/Atomic/OnceLock), RAII guards, Drop ordering (the
  fields-vs-locals asymmetry) and `mem::drop`, and enum-driven runtime state machines.
  Read when you need to mutate through `&self`, manage a resource's lifecycle, or model
  data-driven states.
- `03-error-architecture.md`: thiserror (library, matchable enum, `#[from]`) vs anyhow
  (app, `.context()`), the `?`/`From` desugaring that ties them together, and the
  library-vs-app boundary. Read when choosing or reviewing an error strategy.
- `04-dispatch-and-traits.md`: static (generic/monomorphized) vs dynamic (`dyn`) dispatch,
  object-safety / dyn-compatibility rules, the impl Trait / GAT / RPITIT toolbox, and
  Deref for smart pointers plus the deref-polymorphism anti-pattern. Read when deciding how
  a trait method is dispatched or whether a `dyn` will compile.
