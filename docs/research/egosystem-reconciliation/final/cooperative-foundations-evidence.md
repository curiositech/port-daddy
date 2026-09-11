# Cooperative Harbor foundation evidence, 2026-09-09

Scope: CH1 source-contract reconciliation and a bounded CH2 editor identity/input
slice in the [approved implementation ledger](../../../strategy/cooperative-harbor-implementation.md).
This is not completion of the cooperative IDE, Remote Harbor or prediction engine.

## Source-built and tested

- DocumentRef binds scope, Harbor, repository, worktree/ref and document IDs.
  Routing digests include the complete ordered tuple; local paths are not channel
  identity. Decoder rejects missing/blank/unknown fields. This is routing, not a
  membership credential or cryptographic admission receipt.
- New buffers use fresh Loro replica incarnations, including when their labels
  are identical. Snapshot import preserves prior authorship without adopting the
  predecessor's operation counter. Verified principal/device/grant enrollment
  is **not yet implemented** by this slice.
- Foreground/background messages carry DocumentRef and the exact opening snapshot.
  The mirror does not independently seed disk contents, cannot author local
  text edits, and keeps the foreground author's presentation baseline. It has
  its own replica ID. Display abbreviations are not unique actor identities.
- Local opening performs no identity CLI subprocess and no automatic shared
  subscription. Local edit/presence broadcasts are gated on subscription; the
  verified shared-session adapter remains unavailable. This replaces the unsafe
  path-derived auto-join rather than retaining it as a fallback.
- Foreground selections use Loro stable positions over remote changes, preserve
  selection direction across Unicode inserts and reconcile to valid boundaries.
  Network presence frames still carry line/column values; stable remote cursor/
  annotation transport remains pending with verified shared admission.

## Checks run without starting services

From `core/`, with cached dependencies and no paid work:

```sh
cargo test --offline -q -p pd-console --bin pd-console-repl editor_
cargo test --offline -q -p pd-console --test loro_replay_convergence
cargo check --offline -q -p pd-console --features gpui,gpui/runtime_shaders --bin pd-console
```

Results: **95** selected editor/input/claims tests and **37** buffer/codec/replay
tests passed (the second target rehosts some modules, so these are not 132 unique
tests). The GPUI native code type-check passed using its existing runtime-shader
feature. No application was launched. Existing unused-code warnings remain.

The normal native check without `gpui/runtime_shaders` failed in the dependency
build because Xcode's Metal toolchain is absent. The runtime-shader check does
not prove the normal release package, rendered pixels, accessibility or behavior
in a running native application. No toolchain download was performed.

Cargo resolves pre-existing workspace lockfile drift (pd-anchor benchmark and
pd-vault dependencies) during these checks. Only pd-console's package/version
and direct dependency changes are retained in this slice; no locked-build claim.

ADR collision/registry check passed; whitespace check passed. The existing
bounded #10108 binder audit still reports `pass: false`, score 40, two unresolved
landed-status contradictions and three incomplete coverage axes. It was not
relabelled complete because of these source changes.

## Adversarial checks and remaining gates

Tests cover same-person concurrent replicas, successor authorship, duplicate
delivery, exact-history mirrors, mirror write refusal, path-independent routing,
all five scope dimensions, delimiter ambiguity, malformed identity fields,
missing cursor history, Unicode position shifts and reversed selections.
Review was solo under the halt, not independent subagent review.

Still owed: verified identities and admission; durable local document mappings;
stable remote presence/claims; typed Rust operation/recovery authorities; native
incremental syntax and remaining IDE foundations; project state/invitations;
managed journaling/reconstruction; prediction workflow/utility evaluation; web,
iOS and companions; actual native visual and human evidence. CH2–CH7 remain open.

## Publication safety

Read-only GitHub checks found the Claude review workflow disabled and no
repository-level hooks. This does not prove the installed Fleet GitHub App is
paused. Existing PR #10118's Fleet check says it skipped because the PR was
App-authored, **not** because of a global pause. Do not use that as pause evidence
or change authorship merely to bypass the safety gate. A global Fleet pause has
not been independently verified; publication is held. No PR, review request,
workflow dispatch, service activation, paid agent or deployment was performed.

### Publication continuation, 2026-09-10

The paragraph above records the 2026-09-09 hold. On 2026-09-10 the operator
explicitly authorized scoped GitHub App publication. The continuation uses that
App identity, not the operator's personal account, and does not claim global
Fleet pause or independent review. The foundation is stacked above #10108's
current research head; original research and newer clearance work are preserved.
PR/check readback and remaining native/merge gates are recorded in the PR body.
