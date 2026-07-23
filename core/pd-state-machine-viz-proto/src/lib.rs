//! pd-state-machine-viz-proto library surface.
//!
//! Split into a `[lib]` + `[[bin]]` (rather than everything in `main.rs`, like
//! pd-timeline-proto) purely so `tests/self_capture.rs` — an *integration*
//! test, which can only link a crate's library target, not a binary's private
//! modules — can call `render::render_png` directly on the baked fixture and
//! assert on the real PNG it produces. `model` (P0) and `layout` (P0) have no
//! GPU dependency and are exercised by fast unit tests inside their own files
//! (`cargo test`, no `--ignored` needed); `scene` (P1) and `render` (P2) need
//! a wgpu device.
pub mod layout;
pub mod model;
pub mod render;
pub mod scene;
