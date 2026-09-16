# macOS isolated builds: package discovery is part of the proof

Status: research findings, not a working build profile or runtime promotion. This explanation records the September 2, 2026 Pacific-time investigation; attempt timestamps below are September 3 UTC. No fourth build or virtual-machine startup is approved by this document.

Three bounded attempts to compile an unchanged Port Daddy source export failed. The third failure was **not a missing dependency**: the package existed, but the restricted filesystem view prevented package discovery. A passing two-file relative-import example had missed that distinction. Preserve the failed profile as a regression case, not a recommended workaround.

## What was being proved

The **daemon build** ([`scripts/build-daemon-binary.mjs`](../../scripts/build-daemon-binary.mjs)) packages Port Daddy's background control-plane executable. The investigation used source commit [`27fce0b6`](https://github.com/curiositech/port-daddy/commit/27fce0b61a044ec78a2ef3acd77d60403a86a22e), Node 22.23.2, and **Bun 1.2.21** ([bundler documentation](https://bun.com/docs/bundler)), the JavaScript runtime/compiler used by that build. The private export had its own dependency tree. It did not borrow the live daemon's state or credentials.

Each attempt invoked the same build script with `--no-smoke`: compilation and native-resource preparation were permitted, but running the resulting daemon was not. The surrounding macOS policy restricted filesystem reads/writes, selected executables, and networking. A successful build would still have required separate compiled-runtime, restart, and deployment evidence.

The **native dependency preparation** ([`scripts/lib/onnx-runtime-native.mjs`](../../scripts/lib/onnx-runtime-native.mjs)) locates and prepares platform-specific ONNX resources by their known filesystem paths. That direct-path operation is not proof that Bun can discover the package through an import.

## Three attempts, three actual failures

Each attempt had a distinct identity, a 180-second deadline, and one shared 4 MiB raw-byte output limit. Each finished with exit 1; none hit that deadline or output limit. No executable or final build manifest was produced.

| Attempt finished (UTC) | Policy change being tested | Observed failure | What it established |
| --- | --- | --- | --- |
| 02:29:59 | Private content access without the needed host-ancestor metadata access | Node failed while resolving the entrypoint path, before loading the build script | File permission alone did not make the complete entrypoint path traversable |
| 02:51:24 | Added exact ancestor metadata access, retaining directory-list denial | Bun compilation reported access denied while inspecting ancestor directories | Native preparation could run, but compilation needed a different filesystem view |
| 03:26:45 | Kept those listings denied but reported them as `ENOENT`, meaning a missing path | Bun could not resolve the existing `onnxruntime-node` package | The changed error allowed a relative-file smoke to pass but broke package discovery |

The second attempt's partial native/WASM resources were retained through a non-overwriting move. The third left another partial resource tree; its recorded hashes and modes matched the earlier resources. Neither collection is a successful executable. The result records show completed output collection without a timeout, truncation, spawn error, or stream error; these are recorded observations, not a new execution performed to publish this report.

## Controls that exposed the insufficient smoke test

A **bare package specifier** ([module-resolution documentation](https://bun.com/docs/runtime/module-resolution)) names a package, such as `onnxruntime-node`, rather than a specific relative or absolute file. That distinction mattered under the exact failed profile and the actual build working directory.

| Control | Recorded result |
| --- | --- |
| Inspect the private package and declared entry | Version 1.24.3, package metadata, JavaScript entry, and Darwin ARM64 native resources were present |
| Resolve the package with Node from the source, entrypoint, and dependency directories | Succeeded |
| Resolve the same bare package with Bun | Failed; the same pattern affected `fastify` and `onnxruntime-common` |
| Resolve an absolute entry file with Bun | Succeeded; package-directory resolution still failed |
| Create a tiny synthetic package with package metadata and one exported string | Node resolved its bare name; Bun did not, while Bun resolved its absolute entry |
| Bundle that synthetic package | Bare import failed; absolute-file import succeeded; the output was never executed |
| Supply synthetic environment selectors | Node reported them; Bun's environment projection reported the supplied marker, `PD_HOME`, and explicit `NODE_PATH` absent in these controls |

Setting `NODE_PATH` in a resolution-only control did not repair the failure. Assigning it inside the Bun process also did not repair package discovery. Bun documents general `NODE_PATH` support; that is not evidence that this particular denied-directory setup preserved startup semantics. The environment observation is a separate readiness failure, **not proof of its underlying cause**. No real package was imported or native binding executed by these controls.

The exact [Bun 1.2.21 resolver source](https://github.com/oven-sh/bun/blob/bun-v1.2.21/src/resolver/resolver.zig#L2403-L2585) supplies the package-discovery explanation: `dirInfoCachedMaybeLog` builds ancestor directory information top-down, opens directories for iteration, and returns no directory information on the relevant `ENOENT`/`NotDir` path. This supports the observed failure before the desired package directory's metadata is available. It does not establish the separate environment-loss cause, nor characterize every Bun version or sandbox configuration.

## Input accounting: census versus comparison

The original full filesystem census enumerated 10,260 source entries and 59,137 dependency entries, including empty directories and symbolic links. It checked source entries against immutable Git contents/modes and checked private dependency topology, not just an expected list of hashes. Independent preparation review also enumerated that topology. This is stronger than opening only listed files: the latter cannot detect unexpected additions.

Later recorded inventory comparisons found the existing source entries and dependency bytes, links, and modes unchanged. They also exposed one new empty `.bun-cache` directory whose creation time was after the third build. It arose during initial resolution diagnostics, so calling those diagnostics write-free would be false. Subsequent resolution children explicitly denied writes. These later comparison results are preserved evidence; this publication did not rerun the full filesystem census or turn a manifest comparison into a fresh independent census.

The public report intentionally omits private inventory paths, device/inode identifiers, raw machine logs, and key material. Source links and observations are enough to explain the failure without exporting the private fixture.

## Reusable acceptance tests to implement

These are proposed repository tests, **not tests added or CI enabled by this research PR**:

1. **Resolver and environment readiness.** Under the exact compiler, working directory, and policy, test a relative pair, a synthetic bare package, an absolute-file control, missing-package and syntax failures, and preservation of declared synthetic environment selectors. An absolute-file success must not excuse a bare-package failure. Keep controls synthetic and detect unexpected cache writes.
2. **Complete input enumeration.** Reject unexpected/missing entries, type changes, redirected directories, escaping links, and changed root identity. Compare immutable source contents and modes. Re-enumerate after native preparation; do not silently bless a changed dependency tree.
3. **Bounded process evidence.** Exercise real child processes with multibyte output, a shared stdout/stderr byte budget, bounded retention before append, delayed pipe closure, stream/spawn errors, nonzero exits, and an owned-process deadline. Character count is not byte count; child exit is not necessarily drained output.
4. **Isolation and failed-attempt preservation.** Test wrong network destinations and direction, outside-content reads, executable selection, and writes. Preserve earlier receipts and partial outputs; a corrected setup gets a new attempt identity. Build, boot, and deployment remain separate decisions. Test other operating-system backends separately.

These lessons belong in maintained build tests and contributor guidance through normal source slices. They do not justify changing imports, externalizing the failing package, installing dependencies, suppressing compiler errors, or weakening a policy automatically.

## Remaining choice and runtime obligations

The operator still needs to choose between a supported private filesystem root, such as a suitable macOS guest, and explicit acceptance of the exact ancestor directory-name disclosure needed by the host compiler. The latter changes a privacy boundary even if file contents remain denied. No such grant is encoded here. An installed VM application alone does not prove a configured guest, its toolchain, or its sharing restrictions.

The failed `ENOENT` policy is rejected for reuse. A future candidate must first pass the stronger synthetic controls and independent review. It must then actually compile before owner-versus-wrong-actor requests, durable/ephemeral cleanup, saved queue holds, isolated restart, or backup restoration can be claimed. Those runtime cases remain unrun.

Related source work is already distinct: [#10022](https://github.com/curiositech/port-daddy/pull/10022) preserves durable work during automatic cleanup, and [#10027](https://github.com/curiositech/port-daddy/pull/10027) scopes session-note key storage for an explicit private `PD_HOME`. Neither proves this compiled runtime, general secret isolation, clearing held queue entries, or recovery of previously abandoned claims. An old binary that ignores new holds is not a proved rollback; an older database must not overwrite later writes.

This report supports the existing `runtime-session-accounting-release` work and delivery program. It is an evidence reference, not a new roadmap authority, a completed release, or permission to resume the held build.
