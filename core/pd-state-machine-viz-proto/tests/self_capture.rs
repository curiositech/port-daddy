//! P2 self-capture proof: render the baked fixture graph headlessly and
//! assert the PNG is real — not just "the process exited 0", but that a
//! decodable image of the expected dimensions with more than one distinct
//! pixel color landed on disk. This is what makes the surface
//! agent-self-verifiable: no human screenshot is required to know the
//! renderer actually drew something.
//!
//! Drives the compiled `pd-state-machine-viz-proto` binary as a subprocess
//! rather than calling `render::render_png` in-process. This is NOT
//! incidental: calling it in-process from `cargo test`'s debug profile, or
//! running this test itself un-released, reliably panics —
//!
//!   invalid message send to -[Swift.__SwiftDeferredNSArray
//!   countByEnumeratingWithState:objects:count:]: expected return to have
//!   type code 'q', but found 'Q'
//!
//! — inside `fontique::Collection::new()`'s CoreText font enumeration
//! (`parley::FontContext::new()`, called from `TextEngine::new()`). This is a
//! debug-vs-release build-profile quirk in `objc2-foundation` 0.2.2's
//! Swift-bridged `NSFastEnumeration` shim (an ABI width mismatch the debug
//! profile's extra checks catch and release's codegen doesn't) — NOT a
//! threading issue; the same panic reproduces even when the binary itself is
//! the genuine process main thread, as long as it's a debug build. Driving a
//! **release**-built subprocess sidesteps it. Run this test with
//! `cargo test --release`; plain `cargo test` builds the harness (and this
//! crate's bin target) in debug and will hit the same panic pd-timeline-proto
//! would if driven the same way.
//!
//! Ignored by default (`#[ignore]`) because it requires a real GPU device
//! (Metal on macOS; no software fallback, matching pd-timeline-proto) which
//! most CI runners don't have. Run explicitly:
//!
//!   cargo test --release -- --ignored self_capture
//!
//! This crate is excluded from the core/ workspace and its own Linux CI gate
//! entirely (see core/Cargo.toml's `exclude` list), so this test never blocks
//! that gate either way — the `--ignored` gate exists for local/macOS runs.

use std::collections::HashSet;
use std::process::Command;

#[test]
#[ignore = "requires a real GPU device (Metal on macOS); run with `cargo test -- --ignored`"]
fn render_png_produces_a_real_nontrivial_image() {
    let dir = tempfile::tempdir().expect("tempdir");
    let out_path = dir.path().join("self-capture-proof.png");

    let bin = env!("CARGO_BIN_EXE_pd-state-machine-viz-proto");
    let status = Command::new(bin)
        .arg("--png")
        .arg(&out_path)
        .env("PD_SMV_RENDER_W", "1200")
        .env("PD_SMV_RENDER_H", "500")
        .env("PD_SMV_RENDER_SCALE", "2.0")
        .env("PD_SMV_PLAYHEAD", "1.0")
        .status()
        .expect("spawn pd-state-machine-viz-proto binary");
    assert!(status.success(), "render binary exited with {status}");

    assert!(
        out_path.exists(),
        "binary did not create {}",
        out_path.display()
    );

    let file = std::fs::File::open(&out_path).expect("open rendered PNG");
    let decoder = png::Decoder::new(file);
    let mut reader = decoder.read_info().expect("PNG header should decode");
    let info = reader.info();
    assert_eq!(info.width, 1200, "unexpected PNG width");
    assert_eq!(info.height, 500, "unexpected PNG height");
    assert_eq!(
        info.color_type,
        png::ColorType::Rgba,
        "expected RGBA8 output"
    );

    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).expect("decode PNG frame");
    let pixels = &buf[..frame.buffer_size()];

    // Proves it actually drew something: a blank/failed render would be one
    // solid background color. This scene has a background, node rects in at
    // least 3 distinct tones, white-ish text, and a colored playhead — dozens
    // of colors is the realistic floor, but we assert a very conservative
    // threshold so the test is about "did it draw" not "did the palette
    // match exactly."
    let mut distinct: HashSet<[u8; 4]> = HashSet::new();
    for chunk in pixels.chunks_exact(4) {
        distinct.insert([chunk[0], chunk[1], chunk[2], chunk[3]]);
        if distinct.len() > 1 {
            break;
        }
    }
    assert!(
        distinct.len() > 1,
        "rendered PNG is a single solid color — the scene did not actually draw"
    );
}
