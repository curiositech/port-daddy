# rust-debugging-mastery

Expert-level Rust debugging beyond `println!` and `dbg!`. A diagnosis skill: it matches the tool
to the bug's *shape* — `rust-lldb` for state-at-a-line, `tracing` for causal order, `tokio-console`
for async stalls, Miri for UB, flamegraph/samply for hot paths, and `otool`/`install_name_tool` for
macOS dyld/FFI load failures.

- **Index**: `SKILL.md` (decision points, capabilities, novice-vs-expert failure modes, quality gates)
- **Depth**: `references/01..05` (progressive disclosure — load only the one matching the bug)
- **Transcripts**: `examples/` (a native-addon dyld segfault and an async executor-starvation stall)

Highest-value section: `references/02-native-ffi-and-dyld.md` — debugging a `.node`/cdylib that
crashes its host process because a dependent `.dylib` isn't on the dyld search path.

Part of the port-daddy skill family. Pairs with `daemon-development` and `gpui-rust-console`.
