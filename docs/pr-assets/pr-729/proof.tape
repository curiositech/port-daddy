# vhs tape — PR #729 Harbor Editor wedge (repl "second face").
# Run from the REPO ROOT:  vhs docs/pr-assets/pr-729/proof.tape
# Renders the committed harness `core/pd-console/examples/wedge_render_proof.rs`
# and captures the painted wedge surface. Output/Screenshot paths are resolved by
# vhs relative to the repo root (where vhs is launched), not the Type'd shell cwd.
Output "docs/pr-assets/pr-729/wedge-editor-face.webm"

Set Shell "bash"
Set FontSize 16
Set Width 1520
Set Height 1560
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

Sleep 600ms
Type "cd core/pd-console && cargo run -q --example wedge_render_proof 2>/dev/null"
Sleep 700ms
Enter
Sleep 6s
Screenshot "docs/pr-assets/pr-729/wedge-editor-face.png"
Sleep 1800ms
