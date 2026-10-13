# Rust and GPUI skill partition

This is the routing map for the Rust and GPUI cluster. Select the entry for the **task to be done**, then open adjacent references only when the work crosses a boundary. A skill title or shared keyword alone is not activation evidence.

| User task | Owning skill | Boundary |
|---|---|---|
| Edit a Rust crate, interpret a compiler error, run the relevant Cargo gate | `rust-development-workflow` | General workflow, despite the historical assistant-specific name |
| Design a public Rust API or encode an invariant in types | `advanced-rust-patterns` | Traits, typestate, error types, dispatch, interior mutability |
| Choose a relationship/container representation | `rust-data-structures-advanced` | Arena, graph, map, persistent or concurrent container |
| Diagnose a panic, hang, UB, linker/loader fault, or heisenbug | `rust-debugging-mastery` | Diagnosis and tool choice; profiling here identifies a hotspot |
| Improve measured runtime, allocation, contention, size, or build time | `rust-performance-and-idioms` | Baseline, one change, remeasurement |
| Implement Rust `cdylib` ↔ TypeScript/Bun `koffi` boundary | `rust-kernel-ffi` | ABI, memory ownership, serialization, loader, safety audit |
| Add a `core/pd-console` pane, layout, focus, theme, or refresh path | `gpui-rust-console` | App-specific Block/Pane contract and GPUI/Tokio boundary |
| Animate a GPUI element or transition a pane | `rust-gpui-motion` | Animation ownership, reduced motion, frame budget |
| Add a per-pixel GPUI GPU effect | `gpui-shaders` | WGSL/wgpu, texture integration, GPU budget |
| Plan a cooperative editor slice spanning CRDT, claims, recovery, and transport | `build-coop-ide-gpui` | Cross-layer Harbor architecture and authority |

## Source mapping

- The former checked-in `rust-with-claude-code` and the external read-only `rust-with-Codex` are assistant-name variants of the same source. The complete former checked-in text is retained at `skills/rust-development-workflow/references/legacy-rust-with-claude-code.md`; its general compiler/Cargo/ownership guidance was distilled into the entrypoint, and its console-specific examples are routed to `gpui-rust-console`. No second activation entry was created.
- `advanced-rust-patterns`, `rust-data-structures-advanced`, `rust-debugging-mastery`, `rust-performance-and-idioms`, and `rust-kernel-ffi` retain their own scripts, schemas, examples, and references. Their entrypoints now identify the primary decision and neighboring handoff.
- `gpui-rust-console`, `rust-gpui-motion`, `gpui-shaders`, and `build-coop-ide-gpui` retain their bundles. Console owns static pane/render/data contracts, motion owns element-tree transitions, shaders own fragment passes, and the cooperative editor owns decisions crossing collaboration layers.

## Activation probes

| Prompt | Activate | Avoid |
|---|---|---|
| “The borrow checker rejects this field read followed by mutation.” | `rust-development-workflow` | GPUI skills unless this is a console contract |
| “Should this graph use `Rc<RefCell>` or slotmap?” | `rust-data-structures-advanced` | Generic compiler workflow as the primary skill |
| “The Tokio task never wakes.” | `rust-debugging-mastery` | Optimization advice before the cause is known |
| “Cut allocations in this hot parser and show the benchmark.” | `rust-performance-and-idioms` | Debugging as the primary skill |
| “The `pd-console` pane loses focus when refreshed.” | `gpui-rust-console` | Motion or shaders |
| “The pane needs a retargetable expand animation.” | `rust-gpui-motion` | Console layout as the primary skill |
| “Put a WGSL water pass behind this pane.” | `gpui-shaders` | GPUI motion as the primary skill |
| “Agents and humans need governed concurrent editing and recovery.” | `build-coop-ide-gpui` | A single-pane implementation guide |

The Port Daddy local runtime halt remains in force. These skills do not authorize launching `pd`, its daemon, hooks, MCP tools, or the app for validation.
