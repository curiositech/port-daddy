type: fixed

- **The standalone agent-isolation hook respects explicit Off before reading input.** Canonical or selected `hooks.disabled` and `HALT` markers, plus an existing absolute `PD_HALT_FILE`, make the hook inert. Missing or unknown readiness does not exempt an unisolated writer. The source template and isolated fixtures are versioned; this change does not install hooks or start Port Daddy.
