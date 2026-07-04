# Example Output: Beautiful CLI Design

Scenario: a legacy deploy CLI paints every status line in red/green/yellow with no fallback symbol, ignores `NO_COLOR`, and writes its error messages to stdout so `deploy 2>/dev/null` still shows the failure text mixed into piped output. This is the "bad CLI" `cli_design_audit.mjs` is designed to catch — see the Rainbow Vomit, Invisible in Light Mode, and Broken Pipe Panic anti-patterns in `SKILL.md`.

## Bad CLI — input

```json
{
  "tool": "legacy-deploy",
  "respectsNoColorEnv": false,
  "colorHasNonColorFallback": false,
  "alignsColumns": true,
  "respectsTerminalWidth": true,
  "prefixesLinesForGrep": true,
  "quietByDefault": true,
  "hasProgressForLongOps": true,
  "errorsToStderr": false,
  "exitCodesMeaningful": true,
  "honorsPipeNotATty": true
}
```

## Bad CLI — audit result

```json
{
  "pass": false,
  "score": 64,
  "findings": [
    { "severity": "critical", "id": "color-only-signal", "message": "Meaning is conveyed by color alone somewhere in the output — an accessibility failure for colorblind users and anyone in a monochrome/reduced-color terminal." },
    { "severity": "critical", "id": "ignores-no-color-env", "message": "Output does not honor NO_COLOR / TERM=dumb — ANSI styling leaks into environments that explicitly opted out." },
    { "severity": "critical", "id": "errors-on-stdout", "message": "Errors/warnings are written to stdout instead of stderr — they corrupt piped stdout and vanish when stdout is redirected to a file." }
  ],
  "recommendations": [
    "Pair every semantic color with a symbol or label (e.g. \"✗ error\", not just red text) so meaning survives without color.",
    "Check NO_COLOR and TERM=dumb (or an equivalent capability probe) and strip styling when either is set.",
    "Route every error and warning through stderr; keep stdout reserved for the command's actual output/result."
  ]
}
```

Three criticals alone hold `pass` at `false` regardless of score — `errors-on-stdout` in particular means the tool cannot be safely composed with other commands.

## What fixing it actually looked like

1. **Added a non-color signal to every status line.** `✗ failed`, `✓ deployed`, `⚠ warning` — the symbol carries the meaning; the color is decoration on top.
2. **Checked `NO_COLOR` and `TERM=dumb`** at startup and disabled all ANSI styling when either was set, alongside the existing TTY check.
3. **Moved every error/warning `console.log` to `console.error`** so stderr carries failures and stdout carries only the command's actual result.

## Fixed CLI — input

This is `examples/sample-input.json`, unmodified:

```json
{
  "tool": "wg build",
  "respectsNoColorEnv": true,
  "colorHasNonColorFallback": true,
  "alignsColumns": true,
  "respectsTerminalWidth": true,
  "prefixesLinesForGrep": true,
  "quietByDefault": true,
  "hasProgressForLongOps": true,
  "errorsToStderr": true,
  "exitCodesMeaningful": true,
  "honorsPipeNotATty": true
}
```

## Fixed CLI — audit result

```json
{
  "pass": true,
  "score": 100,
  "findings": [],
  "recommendations": [
    "CLI design meets the readiness bar: accessible color, TTY/pipe/NO_COLOR-safe, Unicode-safe layout, meaningful exit codes, scriptable and quiet by default."
  ]
}
```
