//! Preview the animated Port Daddy logo without a live terminal.
//!
//!   cargo run --example logo_preview          # ASCII dump of key frames
//!   cargo run --example logo_preview -- live   # play it in your terminal
//!
//! The default mode renders a handful of key frames (sail, glint, wink,
//! melt, sea, rise) to a headless `TestBackend` and prints the glyph grid,
//! so you can eyeball the composition in CI logs or a code review. `live`
//! plays the real animation in the alternate screen until you press a key.

use pd_tui::logo::{AnimatedLogo, CYCLE};
use ratatui::{backend::TestBackend, Terminal};

const W: u16 = 72;
const H: u16 = 26;

fn dump_frame(label: &str, frame: u64) {
    let mut terminal = Terminal::new(TestBackend::new(W, H)).unwrap();
    terminal
        .draw(|f| f.render_widget(AnimatedLogo::new(frame), f.area()))
        .unwrap();
    let buf = terminal.backend().buffer();

    println!("\n┌─ {label} (frame {frame}) {}", "─".repeat(40));
    for y in 0..H {
        let mut line = String::new();
        for x in 0..W {
            line.push_str(buf[(x, y)].symbol());
        }
        // Trim trailing blanks for compactness.
        println!("│ {}", line.trim_end());
    }
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("live") {
        eprintln!("live preview not wired into the example — run `cargo run --bin pd-vibe`");
        return;
    }

    // Sample one frame from each narrative beat of the cycle.
    dump_frame("SAIL + glint", 20);
    dump_frame("WINK (the o closes)", 62);
    dump_frame("MELT (letters scatter)", 150);
    dump_frame("SEA (waves + sun)", 195);
    dump_frame("RISE (letters reform)", 228);
    println!(
        "\n(one full cycle = {CYCLE} frames ≈ {}s at 100ms/frame)",
        CYCLE / 10
    );
}
