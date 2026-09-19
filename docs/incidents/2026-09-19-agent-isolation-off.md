# Agent-isolation hook: explicit Off repair

On 2026-09-19 the standalone Agent/Task isolation hook was repaired for the
operator's halted local runtime. Before it reads stdin or invokes `jq`, it now
only treats an existing canonical `~/.port-daddy/hooks.disabled`, `HALT`, or
an existing absolute `PD_HALT_FILE` marker (including a symlink) as explicit
Off. `PD_HOME` remains a selected fixture/runtime root, but a relative or
missing `PD_HALT_FILE` is not a stop marker.

With no explicit marker, missing, stale, mismatched, or unknown readiness does
not bypass the enabled guard: unisolated writers are denied, worktrees are
allowed, and only the documented read-only agent names are exempt. Unsupported
native role fields do not create a new exemption. The repair is source-only;
installed `.codex` and `.claude` copies are outside this slice and remain
unchanged.

Validation is limited to reviewed shell fixture copies with synthetic paths:
`node --test tests/unit/agent-isolation-off.test.mjs` (no Jest setup, Port
Daddy runtime, daemon, hook installer, app, provider, or real runtime files).
This proves the hook decision boundary and early-exit behavior, not hostile
same-user containment, installed-copy parity, or runtime/release activation.
