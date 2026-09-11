type: fixed

- **The git shim no longer hangs every git call once the machine is under process load.** `~/.port-daddy/bin/git` v5 splits `PATH` with parameter expansion instead of a bash here-string; on macOS with bash 5.3, a here-string longer than 512 bytes deadlocks in `write(2)` whenever the kernel's pipe budget is spent, which left Claude Desktop, Codex and ChatGPT git operations frozen for up to 4.5 days. Run `pd guard install` to refresh the installed shim; `tests/unit/git-shim-verbs.test.js` forbids any here-string or heredoc in the shim and spawns it across a >512-byte PATH.
