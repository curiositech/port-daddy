# pd-console — the GPU-native operator console.
#
#   make            → build + run the window (the one you want)
#   make run        → same as `make`
#   make install    → build + open the latest lane app
#   make devapp     → build + open an isolated dev app (DEVBUILD=<name>)
#   make dev        → fast (debug) build + run the window
#   make repl       → the headless TUI console (no GPU; builds anywhere)
#   make shots      → capture window screenshots (needs Screen Recording perm)
#   make proof      → off-screen visual proof: per-pane stills + a video clip
#   make proof-check→ deterministic receipt/dry-run smoke for proof harness
#   make proof-setup→ one-time virtual-display + permission setup (interactive)
#   make headless-capture → Block-model PNG, NO window/display/TCC (agent-safe)
#   make displays   → list the displays pd-console can target (for --display)
#   make test       → cargo test (the panes/decoders)
#   make check      → cargo check, no gpui (the Linux/CI path)
#   make help       → this list
#
# The window bin is gated behind the `gpui` feature; the repl + lib are not.

.DEFAULT_GOAL := run
DEVBUILD ?= harness-roster

.PHONY: run dev install devapp repl shots proof proof-check proof-setup headless-capture displays test check help

run: ## Build (release) and launch the native window
	cargo run --release --features gpui --bin pd-console

dev: ## Fast debug build + launch (quicker iteration)
	cargo run --features gpui --bin pd-console

install: ## Build + open the latest lane app
	bash scripts/package-console.sh --latest

devapp: ## Build + open an isolated dev app (set DEVBUILD=<name>)
	bash scripts/package-console.sh --devbuild $(DEVBUILD)

repl: ## Headless TUI console (no GPU; builds everywhere)
	cargo run --bin pd-console-repl

shots: ## Capture window screenshots into docs/artifacts/gpui (needs Screen Recording perm)
	./scripts/capture-gpui.sh

proof: ## Off-screen visual proof — per-pane stills + a video clip on a virtual display
	./scripts/proof/capture-proof.sh

proof-check: ## Deterministic dry-run receipt smoke for the proof harness
	./scripts/proof/check-capture-proof.sh

proof-setup: ## One-time setup: create a virtual display + grant Screen Recording (interactive)
	./scripts/proof/setup-virtual-display.sh

headless-capture: ## Offscreen Block-model PNG — no window/display/TCC (agent-safe). Optional OUT=<path>
	./scripts/proof/headless-capture.sh $(OUT)

displays: ## List the displays pd-console can target (use the index/uuid with --display)
	cargo run --release --features gpui --bin pd-console -- --list-displays

test: ## Run the pane/decoder unit tests
	cargo test

check: ## Type-check the Linux/CI path (no gpui)
	cargo check

help: ## Show this help
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*## /\t/' | sort
