# Managed spawn worktree binding

A managed spawn must place its process and its coordination session in the same
physical workspace. Correct process `cwd` alone is insufficient: a session in
another Git world can make claims, notes, and recovery misleading.

This contract applies to the source implementation. A merged PR, passing tests,
or a compiled smoke test does not prove that an installed daemon was promoted.

## Caller contract

| Target | Required input | Session binding |
| --- | --- | --- |
| Local CLI or file-capable agent | Existing, owned, absolute `workdir` | Derived from that physical directory |
| Explicit directory inside a Git checkout | Absolute `workdir`, including a subdirectory | Canonical Git root and verified Git metadata |
| Explicit non-Git directory | Absolute `workdir` | Physical directory witness; Git world is `null` |
| API-only projectless agent | May omit `workdir` | No filesystem witness or Git world |

The CLI already supplies its caller's current directory. MCP and SDK callers
must supply a target for local agents; they do not inherit the daemon's cwd.
An explicit shared-checkout observer policy remains separate from target
verification. It does not make a missing, changed, or incorrect binding valid.

## Admission and execution

```text
explicit target → physical witness → Git context → exact managed session
                                                ↓ stored binding read-back
                      sandbox preparation → recheck → child launch
```

The spawner snapshots the request before its first asynchronous operation.
Directory identity records canonical path, device, and inode. Git probes strip
inherited `GIT_*` selectors so the daemon's environment cannot redirect context.
The daemon derives root, Git directory, common directory, branch, and worktree
identity; caller-supplied world labels are not used as authority. Unborn and
detached Git checkouts remain valid. Malformed or unreadable Git metadata is an
error, not permission to downgrade into a non-Git target.

The private lifecycle stores a short-lived admission witness and consumes it
when binding. Binding revalidates the physical target, reads the exact session
after asynchronous checks, and rechecks the same actor's authority before the
write. Returned admission and binding receipts must agree. Failure abandons
only the exact newly admitted session through the existing authorized lifecycle;
it does not repair, borrow, or retire another session.

Before a local child is started, the subprocess runners reuse that private
witness to revalidate the Git root/common directory and active exact session
after Coast Guard preparation, then check directory identity and cancellation
immediately before the OS spawn. A repointed `.git` or a non-Git directory
becoming a repository therefore refuses the launch too. Both
ordinary launches and native resumes use this check; native resume still
requires its original witness. Prepared sandbox resources and CLI scratch
files are disposed on refusal. No model call or child process is needed to
verify these refusal paths in tests.

## Recovery and operator evidence

If a target is missing, replaced, or bound to another world, stop that launch
and present the requested target, verified target, and exact session failure.
A newly selected workspace requires a new admission; changing an alias or
clearing an established conflicting context is not a repair. Preserve the
failed run's receipt and use the ordinary operator launch flow for the next
attempt. The operator should not have to edit credential files or repair session
rows by hand.

Inspect process placement, session world, and terminal lifecycle separately.
An accepted request is not a launched process; a stopped process is not proof
that its session was settled. This slice does not add a dedicated operator
comparison panel or a remotely durable roadmap receipt.

## Verification and boundaries

Focused tests use real Git repositories with concurrent linked worktrees A/B
and a daemon directory outside both. They verify immutable caller targets,
fresh session read-back, explicit null versus omitted world handling, actual
child cwd under injected provider runners, cancellation during Git verification,
and directory replacement before and after sandbox preparation. CLI provider
tests use fake children and no paid model calls. The non-Git fixture uses a
test-only Git ceiling because the development machine's parent directory is
itself a repository; production does not accept that test seam.

These checks prevent accidental identity drift, not malicious same-UID races
between the final filesystem check and the OS spawn. Full repo authorization,
cross-repo search filtering, remote memory isolation, same-owner anchor repair,
and canonical daemon deployment remain separate work. A null Git world grants
no cross-repo permission; it must not be treated as proof that those independent
authorization surfaces are isolated.

Related: [daemon and supervision](daemon-and-supervision.md),
[claim projection diagnostics](advisor-claim-projection.md), and
[cross-runtime execution envelope](../adr/0136-cross-runtime-execution-envelope.md).
