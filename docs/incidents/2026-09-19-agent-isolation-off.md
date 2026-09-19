# Agent-isolation hook: explicit Off repair

On 2026-09-19 the standalone Agent/Task isolation hook was repaired for the
operator's halted local runtime. Before it reads stdin or invokes `jq`, it now
only treats an existing canonical `~/.port-daddy/hooks.disabled`, `HALT`, or
an existing absolute `PD_HALT_FILE` marker (including a symlink) as explicit
Off. The same explicit markers in a selected `PD_HOME` also stop the hook, but a relative or
missing `PD_HALT_FILE` is not a stop marker.

With no explicit marker, missing, stale, mismatched, or unknown readiness does
not bypass the enabled guard: unisolated writers are denied, worktrees are
allowed, and only the documented read-only agent names are exempt. Unsupported
native role fields do not create a new exemption. This commit versions the
standalone hook; it does not run an installer or modify hook registrations.
The lead separately applied the same narrow patch to the existing installed
`.codex` and `.claude` copies under the operator's explicit OFF request. All
three copies had SHA-256 `5aa82321cba4817bb72c783427e6c9790505e5ffd5e0732f54f6f845de5c7d9c`
at read-back. The existing OFF marker was not changed.

Validation is limited to reviewed shell fixture copies with synthetic paths:
`node --test tests/unit/agent-isolation-off.test.mjs` (no Jest setup, Port
Daddy runtime, daemon, hook installer, app, provider, or real runtime files).
This proves the fixture decision boundary and early-exit behavior, not hostile
same-user containment or runtime/release activation. Installed-copy parity is a
separate byte comparison, not a claim that an installed hook was run for testing.
Both required unit-test jobs run the standalone suite; Jest does not discover
`.test.mjs` files. A future installer must preserve this early explicit-OFF check.
