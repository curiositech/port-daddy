# Isolation Mechanisms — macOS And Linux

Use this when choosing what actually enforces an isolation dimension, not just what
policy describes it. A harness spec that names `filesystem` as covered but has no
kernel-level mechanism behind it is describing intent, not containment.

## Filesystem isolation

| Mechanism | Platform | What it enforces | Notes |
| --- | --- | --- | --- |
| `sandbox-exec` / Seatbelt profiles | macOS | Per-process file read/write allowlist, declared in a `.sb` profile | Apple-deprecated the public CLI but the kernel facility (`Sandbox.kext`/`sandboxd`) is still what App Store sandboxing and Coast Guard-style tooling rely on; profiles are the sound layer, not `chmod` conventions |
| Endpoint Security Framework (ESF) + `eslogger` | macOS | Observability of `AUTH_EXEC`, file opens/renames/unlinks; can *deny* exec via `ES_AUTH_RESULT_DENY` | Requires a system extension entitlement; read-only `eslogger` is much easier to ship than an authorizing ES client |
| Ephemeral git worktree | macOS/Linux | Filesystem containment *by convention*: sandboxed code only ever sees a throwaway worktree path | Not a security boundary by itself — a process running as the same UID can still traverse `..` to the real repo unless combined with a path guard or a real filesystem jail |
| `chroot` / `pivot_root` | Linux | Hard root-directory boundary for the process tree | Requires root to set up; escapable by a process with `CAP_SYS_CHROOT` unless combined with namespaces |
| Mount namespaces + bind mounts | Linux | Process sees only the bind-mounted subset of the real filesystem | This is what container runtimes (`runc`, `containerd`) actually use under the "container" label |
| Landlock | Linux (5.13+) | Unprivileged per-process filesystem access rules (like a userspace-configurable Seatbelt) | No root required; ideal for sandboxing a specific subprocess without a full container runtime |
| Application-level `containPath()` (realpath + prefix check) | Both | Defense-in-depth check inside the agent/runtime code itself, independent of the OS sandbox | Necessary but not sufficient alone — pair with an OS-level mechanism when the code executes truly untrusted payloads (not just untrusted *paths*) |

Practical default for a Port-Daddy-style fleet: ephemeral worktree + application-level
`containPath()` (realpath both the target and the jail root, check prefix, deny
sensitive subpaths) is the pragmatic baseline; escalate to Landlock/namespaces or
Seatbelt when the sandboxed code itself (not just its declared inputs) is untrusted.

## Network isolation

| Mechanism | Platform | What it enforces | Notes |
| --- | --- | --- | --- |
| Network Extension: `NEFilterDataProvider` | macOS | Per-connection allow/deny at the socket layer, app-aware | Requires a system extension entitlement; this is the sound mechanism behind "the AI little sniffer" style host tools |
| `pf` (packet filter) forced egress | macOS | Kernel-level rule forcing all traffic from a UID/process through a proxy or blocking it outright | Good for "this sandboxed process may only reach 127.0.0.1:<proxy-port>" |
| Network namespaces (`ip netns`) | Linux | A process tree gets its own network stack; give it only a veth pair to a controlled bridge/proxy | Standard container-network isolation primitive |
| seccomp-bpf | Linux | Syscall allowlist/denylist (can block `socket()`, `connect()` entirely) | Coarser than a namespace — good for "no network at all" sandboxes |
| Application-level `assertSafeOutboundUrl()` | Both | Classifies the destination URL/IP before every `fetch`/`connect` call from inside the runtime | Necessary when the sandbox must reach *some* hosts (allowlist) — OS-level network isolation alone can't express "allow api.github.com, deny everything else" without an egress proxy in front of it |

Practical default: default-deny at the OS layer (namespace with no route, or `pf`
forcing everything through a proxy) plus an application-level allowlist check in the
proxy/runtime for the hosts that must be reachable. Never rely on the application
check alone if the sandboxed code can execute arbitrary binaries — it can bypass any
check that isn't enforced below it.

## Process / resource isolation

| Mechanism | Platform | What it enforces |
| --- | --- | --- |
| `cgroups` v2 (`pids.max`, `memory.max`, `cpu.max`) | Linux | Hard caps on process count, memory, CPU time for everything in the cgroup — this is what stops a fork bomb |
| `RLIMIT_NPROC` / `ulimit -u` | Both (POSIX) | Per-user process count cap; weaker than cgroups (shared across all the user's processes, not just the sandbox) |
| macOS sandbox profile process limits | macOS | Less granular than cgroups; typically combined with a wrapper that `wait4`s with a timeout and kills the process group on breach |
| Process-group timeout + kill | Both | Application-level: launch in a new process group (`setsid`), track wall-clock time, `kill(-pgid, SIGKILL)` on timeout | Catches infinite loops even when resource caps don't apply cleanly |

## Secrets isolation

| Mechanism | What it does |
| --- | --- |
| Fake/canary credentials | Generate values that are syntactically valid (right prefix/length for the credential type) but grant zero real capability, and log/alert if they ever appear in egress traffic |
| Environment scrubbing | Launch the sandboxed process with an explicit allowlisted env, not an inherited-then-filtered one — inherit-then-filter misses variables added later in the parent's lifecycle |
| Secret-scanning on egress | Shannon-entropy + structured-format scanning (not a keyword list — matches the repo's no-keyword-NLP rule) on any outbound payload, alongside the canary-value check |
| Ephemeral, single-use tokens | If a real credential must be reachable (e.g. to call a scoped API), mint a short-TTL, narrowly-scoped token per sandbox run rather than exposing a long-lived one |

## Fail-closed gating — wiring the harness into deployment

The point of this harness is to be a **gate**, not a report nobody reads:

1. `containment_audit.mjs` runs in CI against the current harness spec for every
   surface it covers (fleet output sinks, Coast Guard exec, MCP tool dispatch, …).
2. A non-`pass` result blocks merge/deploy of the corresponding surface — same
   mechanism as a failing unit test, not a warning annotation.
3. Coverage regressions are diffed: if a PR removes an adversarial case or widens
   `egressPolicy`/`pathPolicy` toward denylist/default-allow, that's a blocking
   finding even if every remaining case still passes — the *design* regressed, not
   just an assertion.
4. Residual risks that the harness cannot yet close (see ADR-0093 §10 for the
   canonical format: 2nd-order injection, DNS rebinding past a literal-IP guard,
   TOCTOU between realpath-check and write, malicious same-UID agent) are named in
   the report, not silently absent — a green harness must never imply "nothing left
   to worry about" when residuals are known and unaddressed.
5. Treat "the code passed its own unit tests" and "the sandbox contained it under
   attack" as two separate gates. The first tells you the happy path works; only the
   second tells you what happens when the input is hostile.
