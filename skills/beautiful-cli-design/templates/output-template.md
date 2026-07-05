# CLI/TUI Design Output Template

Fill in every section before shipping. Validate the underlying claims with `node scripts/cli_design_audit.mjs --input <this-design-as-json>.json` before marking it ready.

```markdown
## Visual System

- <Semantic colors used: success / warning / error / accent — and the non-color fallback for each.>
- <Symbols and box styles used, and where they stay consistent across the app.>

## Runtime Compatibility

- NO_COLOR / TERM=dumb: <how styling is stripped>
- Non-TTY / pipe detection: <how interactive/decorative output is disabled>
- Exit codes: <table of code -> meaning>
- Errors: <confirm stderr, not stdout>

## Layout

- Column alignment: <Unicode-width library or approach used>
- Width responsiveness: <behavior at 40 / 80 / 120 columns>

## Feedback

- Long operations: <spinner vs. bar+ETA, and why>
- Default verbosity: <quiet-by-default behavior and the --verbose/--json opt-in>
```

## Checklist before marking ready

- [ ] Every semantic color has a non-color fallback (symbol or label) — see `color-only-signal`.
- [ ] `NO_COLOR=1` and `TERM=dumb` produce clean, unstyled output — see `ignores-no-color-env`.
- [ ] Piped/non-TTY output (`cmd | cat`) never leaks raw ANSI or cursor-control codes — see `ignores-pipe-not-tty`.
- [ ] Exit codes distinguish failure classes, not just 0-vs-1 — see `exit-codes-not-meaningful`.
- [ ] Errors and warnings go to stderr, never stdout — see `errors-on-stdout`.
- [ ] Long-running operations show a spinner or bar+ETA — see `no-progress-for-long-ops`.
- [ ] Table/box alignment uses Unicode display width, not string length — see `misaligned-columns`.
- [ ] Output reflows sanely at narrow widths — see `ignores-terminal-width`.
- [ ] Streamed log lines carry a stable, greppable prefix — see `unprefixed-log-lines`.
- [ ] Default output is quiet, with an explicit verbose/debug opt-in — see `noisy-by-default`.
