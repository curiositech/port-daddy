# Dream Rig Adversarial Containment

**Status:** contract and fail-closed receipt gate built; full hostile-runtime containment remains blocked on forced egress and hard process/resource limits  
**Roadmap:** `harness-lifecycle-dream-rig-containment-gate`  
**Authority:** this packet specializes the C5 sandbox requirement in `docs/architecture/agent-harbor-technical-binder/work-packets/official-agent-control-plane-synthesis.md` and `docs/architecture/agent-harbor-technical-binder/work-packets/durable-state-sandbox-supervision-review.md` for the Dream Rig.

## The rule

The Dream Rig exists to stage deterministic agent-and-hook situations, run a real harnessed agent through the next transition, and capture what actually happened. Its visual result is useful only if the underlying execution is trustworthy.

The authority order is therefore:

1. **Containment report** — did the hostile probes stay inside the declared boundary, with machine evidence?
2. **WorkReceipt** — what state was seeded, what the agent did, which artifacts validate it, what it cost, and how to roll it back.
3. **Porthole** — the human-readable rendering of that evidence.

Porthole may explain trust. It cannot create trust. `lib/harness/dream-rig-containment.ts` refuses to attach a red, incomplete, or unevidenced report to a Dream Rig receipt.

## Boundary and five hostile classes

The language-neutral policy is `config/harness/dream-rig-containment.json`. Its two frozen contracts are:

- `schemas/agent-harbor/v0/dream-rig-containment-spec.schema.json`
- `schemas/agent-harbor/v0/dream-rig-containment-report.schema.json`

| Threat | Hostile situation | Current mechanism exercised | Strong receipt today? | Unclosed edge |
| --- | --- | --- | --- | --- |
| SSRF | Metadata, loopback, private, obfuscated-IP, and redirected destinations | `lib/fleet/url-guard.ts` before application-owned fetches | Partial | Arbitrary code can open a raw socket; DNS must be resolve-and-pinned or forced through a kernel-level/default-deny egress path. |
| Path traversal | `../`, absolute paths, and a pre-planted symlink leave the scenario root | `lib/fleet/path-guard.ts` lexical plus longest-existing-prefix realpath checks | Partial | Check-to-open TOCTOU remains until the write is rooted and opened without following links. |
| Secret exfiltration | A syntactically realistic canary is read or appears in egress | `lib/coast-guard.ts` environment scrubbing plus fake credentials | Partial | Same-UID hostile code and unforced raw egress remain outside today's structural guarantee. |
| Resource exhaustion | A child forks, allocates memory, fills disk, or ignores termination | Declared scenario-local process-group/resource limit | **No** | macOS has no Dream Rig-enforced equivalent of cgroup process and memory caps yet. The receipt gate intentionally stays red. |
| Side-effect write | A scenario installs git hooks, launch agents, cron entries, or writes outside its sink | sensitive-path refusal in `lib/fleet/path-guard.ts`; future capability ToolGate | Partial | An arbitrary same-UID process needs OS-enforced filesystem confinement and a separately-authoritative tool boundary. |

“Partial” means the existing application guard is real and is attacked by the focused suite. It does **not** mean arbitrary model-authored code is fully contained. The current Coast Guard honesty disclosure in `lib/coast-guard.ts` remains controlling.

## What CI proves

The always-running `dream-rig-containment` CI job has two separate duties:

1. `npm run check:dream-rig-containment` audits the policy shape: every isolation dimension and threat class is present; path and network policies are allowlisted; network defaults to deny; real credentials are absent; every ambiguity fails closed.
2. `tests/unit/dream-rig-containment.test.ts` attacks the existing guards and, separately, proves the WorkReceipt boundary rejects missing, red, or prose-only probe results.

This is intentionally not a claim that the current host runtime passes all five classes. CI proves the **gate** is honest. A future runner earns a green runtime report only by returning evidence for every declared case.

## Receipt semantics

`schemas/agent-harbor/v0/work-receipt.schema.json` accepts an optional `containment` report because ordinary low-risk WorkReceipts do not all execute hostile code. Dream Rig's sealing path is stricter than the generic schema:

- every declared case has exactly one result;
- the result's threat class matches the policy;
- `contained` is true;
- an exit code or durable artifact path exists;
- every threat class reaches a containment rate of 1;
- no finding remains.

If any condition fails, `attachDreamRigContainment()` throws `DREAM_RIG_CONTAINMENT_BLOCKED`. The run may still be displayed as a blocked experiment, but it cannot be labeled a strong receipt or promoted as proof.

## Rollout

### Now: contract and truth gate

- freeze the spec and report schemas;
- execute the existing URL, path, secret, and sensitive-write attacks;
- keep resource containment red in the canonical fixture;
- block receipt authority on red or missing evidence.

### Next: provider-neutral hostile runner

- assemble each of the fifteen Dream Rig scenarios under a fresh root in `~/coding/tmp/`;
- use fake credentials only;
- run the same attack pack through every supported harness adapter;
- persist stdout, stderr, exit status, filesystem diff, process-tree outcome, and network decisions as artifacts;
- destroy the scenario root after its rollback artifact is verified.

### Strong-runtime admission

Do not admit model-authored adversarial scenarios as strong until:

- network access is default-deny below the child process and DNS is resolve-and-pinned;
- the entire process tree has enforceable time, process, memory, and disk ceilings;
- writes are OS-confined to the scenario root and sensitive operations pass a capability ToolGate;
- canary exfiltration is observed at every allowed egress sink;
- the five-threat suite passes on the actual target platform rather than skipping.

## Residual-risk rule

Residual risks are carried in the containment report even when every probe passes. A green report means “the declared cases were contained under these mechanisms and artifacts,” never “the agent is harmless” or “the host is generally secure.” Re-run the audit whenever `lib/fleet/url-guard.ts`, `lib/fleet/path-guard.ts`, `lib/coast-guard.ts`, the spawn boundary, or the Dream Rig runner changes.
