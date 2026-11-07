# Fresh blue Kani evidence: 2026-11-06

The current-source five-harness lane passed in **82.021 seconds**. The checked output records **5 verified harnesses, 0 failures**, and **17/17 acceptance/rejection cover obligations satisfied**. Both deliberately broken policy controls produced their intended assertion counterexamples in **22.284 seconds** combined. These are fresh local executions, not the Nov 5 receipt.

| Harness | Current run | Cover obligations |
|---|---|---|
| `proof_capability_attenuation` | PASS | 2/2 |
| `proof_decoded_delegation_two_hops` | PASS | 5/5 |
| `proof_decoded_channel_authority` | PASS | 3/3 |
| `proof_decoded_claims_policy` | PASS | 7/7 |
| `proof_constant_time_behavior` | PASS | 0/0 |

## Bounds and proof scope

- Decoded claims: arbitrary signed 64-bit version/timestamps and optional not-before; widened 128-bit oracle arithmetic; seven accepted/rejected/boundary covers. This is conditional on authenticated decoded input.
- Channel authority: one decoded grant; four operation strings, eight channel patterns, six concrete requested channel strings; request operation pub/sub; arbitrary optional unsigned 64-bit ceilings; unwind 16; three covers.
- Two-hop delegation: one structured grant at root, child, and leaf, two hops, the same finite grammar, arbitrary optional unsigned 64-bit ceilings; unwind 16; five covers. This checks the structured subset predicate, not a deployed signed-chain verifier.
- Flat attenuation: lists of length zero through two, four one-byte rights, duplicates and empty lists included; unwind 8; two covers.
- Comparator: two symbolic 16-byte arrays. The harness calls the comparator and contains no timing-relation assertion. Its pass is not a constant-time side-channel proof.

## Negative controls

- `expiry-removed`: fresh mutant failed `decoded policy matches temporal contract` as intended; Kani exit 1.
- `ceiling-removed`: fresh mutant failed `rate ceiling preserved` as intended; Kani exit 1.

The existing control driver required both the named failed assertion and `VERIFICATION:- FAILED`; compilation errors and timeouts would not count. Its combined stdout/stderr child logs and source-bound receipt are preserved in `negative-controls/`. The outer driver's separate streams and argv are in `evidence/`.

## Logic-only attempt: incomplete

The actual current-source command `cargo kani -Z stubbing --harness proof_verify_logic_only` was run. It reached the **90-second limit** (observed 90.004 seconds; process exit -9) and was terminated by the runner's process-group timeout. It did not produce a successful verification verdict. The harness has 32-byte symbolic token input, public-key/base64/signature stubs, and unwind 128. No parser or cryptographic verification claim follows from this attempt.

## Execution and provenance

The installed tool reported `cargo-kani 0.67.0`. The requested suffixed executable path did not exist; the installed wrapper was used without installation or setup. Current crate bytes were copied into the blue-owned cache; all **8 recorded source/script files** still match their original worktree hashes after execution. Full hashes are in `source-manifest.json`; exact wrapper environment is in `tool_environment.py`.

The lane ran under the reviewed `war_room.py` host-process interface. Cargo resolution was offline. Build, registry clone, and temporary paths stayed under the blue-owned `.cache/`. The wrapper retained the existing home identity for installed toolchain lookup and supplied an explicit environment without inherited credential variables. This is **host-reviewed-process** evidence with **privacy_enforced=false** and **signature=null**. Path ownership, environment stripping, and hashes do not establish team isolation, network containment, or authenticity.

`run-results.json` records exact exit codes, durations, output names, and hashes. `evidence/blue.jsonl` records exact command vectors and cwd. `visible-transcript.md` records the visible assignment and progress summaries. `seal-anchor.json` is the execution archive's external anchor; the final handoff anchor binds this report, the copied inner control logs, summaries, and the execution seal. Sealing preserves failed and incomplete evidence; it is not a scientific PASS.

Post-timeout process inspection found 1 matching Kani/blue-cache process rows. This is a scoped observation, not a containment theorem. The machine-readable observation is `process-observation.json`.
