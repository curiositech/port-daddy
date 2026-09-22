# Worked Example: ADR to Inspectable Argument

## Before (Internal Workshop Draft)

> As outlined in ADR-0050 and verified in PR #412, the system ensures child processes cannot overspend. The honesty rider in Section 4 is the hinge: we use Seatbelt on macOS to scrub secrets from the environment, and there is a spend cap that triggers HTTP 402. Precisely the synthesis here is that the compulsion stops unnoted commits.
>
> *Margin note:* Pitfall! Agents can crash if spend cap is hit.

### Why This Fails the Book Standard
1. Cites `ADR-0050` and `PR #412` — uninspectable by external readers.
2. Uses workshop jargon: *"the honesty rider"*, *"the hinge"*, *"precisely the synthesis"*.
3. Bare margin label: *"Pitfall!"* followed by generic warning.
4. Conflates macOS Seatbelt (process confinement/secret scrubbing) with HTTP spend accounting without showing the relational mechanism.

---

## After (Reader-Inspectable Revision)

> When an agent spawns an untrusted subprocess, containment requires two independent physical boundaries: execution confinement and financial bounding.
>
> Execution confinement strips credentials from the child process's environment prior to `fork` and isolates filesystem access via operating system sandboxing (using Seatbelt on macOS and Landlock with namespaces on Linux). Even if the child process is fully compromised, it cannot read ambient configuration or write outside its allocated worktree.
>
> Financial bounding operates out of band at the local loopback transport. Egress requests through the local proxy increment an in-memory budget ledger. Once the dollar threshold is exceeded, subsequent outbound requests fail immediately with status `402 Spend Cap Exceeded`.
>
> *Margin cue:* A sandboxed process can still exhaust financial budget through legitimate outbound calls unless proxy accounting clamps egress independently of operating system permissions.

### Why This Passes
- Fully self-contained mechanism: explains environment stripping, Seatbelt/Landlock confinement, and proxy budget clamping.
- Zero private references to ADRs or pull requests.
- Clear distinction between execution permissions (OS sandbox) and economic limits (proxy budget).
- Active margin assertion stating the exact edge case.
