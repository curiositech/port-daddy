type: fixed

- **Disabled Port Daddy hooks now perform zero work.** The operator-level `~/.port-daddy/hooks.disabled` marker makes generated shims, direct `pd-hook-*` tentacles, and Port Daddy Git hooks exit before reading input, writing diagnostics, handling the halt listener, inspecting projects, probing the daemon, or publishing commit events; commit hooks also no-op without a repository Coordination Guard configuration or verifiably ready local daemon.
