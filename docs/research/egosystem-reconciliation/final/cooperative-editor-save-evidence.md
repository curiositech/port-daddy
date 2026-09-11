# CH2: revision-bound local text Save

Source continuation of #10134, under `harbor-editor-local-text-input` and the
existing Cooperative Harbor program. Regular PR readiness is not release proof.

## Behavior

Cmd-S on macOS / Ctrl-S on Linux captures one immutable local-save packet:
DocumentRef, one-use job identity, exact frontier, text, and the file's opened
identity/metadata/content digest. File I/O runs on GPUI's background executor,
independent of the daemon and its refresh producer. Completion returns to the
foreground owner; another document or job cannot consume it. Only the captured
frontier becomes saved. Edits made while saving stay dirty.

The filesystem writer serializes saves within this process, including region
panes and alternate spellings of one path. It checks the baseline, stages a
unique sibling file, preserves supported metadata, syncs the staged file,
rechecks the baseline, renames, syncs the directory, and reads back the result.
Failure never marks the captured revision clean. An error after replacement is
an uncertain outcome, not proof that disk stayed unchanged.

On macOS, descriptor-based `fcopyfile(COPYFILE_METADATA)` preserves ACLs, extended
attributes and stat metadata; ownership/group/mode are checked before replacement.
This uses the OS primitive, not a new shared-authority subsystem. See
[Apple's copyfile contract](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man3/copyfile.3.html).
Linux currently refuses extended attributes/ACLs and ownership/group/mode changes
it cannot preserve. Other platforms refuse unsupported metadata-safe saving.
The existing workspace `libc` dependency is reused; no new package version is added.

Symbolic-link paths and multiply-linked files remain readable but do not receive
overwrite authority. Mirrors and snapshot-only buffers likewise cannot write a
display path. Local save status is composed from the foreground owner even when
remote claims/presence arrive as producer-mirror blocks.

## Evidence: 2026-09-11

- Full headless Cargo target graph compiles and **884 selected test executions
  pass across 16 targets**, including the editor-rehosting example build.
- **13 existing socket tests excluded** after the sandbox refused socket binds.
  They are not passing evidence: three claims join cases, one script Unix-socket
  case, three console-action HTTP cases, three interruption HTTP cases, and three
  live SSE cases. No escalation or substitute service was used to bypass refusal.
- The first intermediate revision passed 892 unfiltered executions before the
  metadata/review fixes. That older result does not replace the final exclusions.
- New tests cover captured-revision races, a second view of one file, wrong-document
  completion, errors, reload/history retention, mirror/snapshot refusal, foreground
  status transitions, readable links, metadata preservation/refusal, Unicode/empty
  saves, deleted/replaced/readonly files, and changes during staging. The writer
  fixture explicitly verifies its admission is still held during publication.
- macOS xattr and ACL tests use synthetic text files only. The ACL fixture invokes
  system chmod/ls against its unique fixture, not a runtime, app or user file.
- `cargo check --offline -q -p pd-console --features gpui,gpui/runtime_shaders
  --bin pd-console` passes. Existing unused-code warnings remain.
- Four concrete adversarial findings were fixed: same-file writer races, metadata
  loss, misleading mirror status, and linked-source viewing regression. Independent
  source re-review found no remaining bounded P1/P2. Native execution was not reviewed.
- Changelog assembly, scoped diff checks and equality of all four internal-skill
  copies pass. The PR requirements check correctly fails its native visual-artifact
  gate; no exemption is claimed while the operator halt prevents that proof.
- The workspace still has unrelated lockfile resolution drift. Only the direct
  pd-console-to-existing-libc dependency edge is committed; this is not a claim
  that the entire workspace passes `--locked`.

Reproduce from `core/`, using the following exclusions after `cargo test --offline
-q -p pd-console --`:

```text
--skip claims_pane::tests::refresh_recovers_metadata_omitted_by_a_successful_empty_bulk_join
--skip claims_pane::tests::refresh_exposes_an_exact_join_failure_instead_of_anonymous_silence
--skip claims_pane::tests::exact_session_recovery_has_its_own_bounded_deadline
--skip script::tests::server_round_trips_over_a_real_socket
--skip dispatch_reject_carries_reason_body
--skip dispatch_accept_posts_to_accept_endpoint
--skip cost_metrics_fetch_parses_totals_and_projects
--skip subscribe_agent_streams_typed_envelopes_over_a_socket
--skip dropping_quiet_agent_receiver_closes_the_sse_socket
--skip dropping_quiet_channel_receiver_closes_the_sse_socket
--skip poll_against_a_mock_relay_parses_and_authenticates
--skip a_401_from_the_relay_parks_the_pane
--skip an_unreachable_relay_is_transient_and_unknown
```

## Gates still open

This is optimistic conflict detection, **not an atomic filesystem compare-and-swap
against arbitrary external processes**. A process can race the final check and
rename. It is not the canonical filesystem witness/lease required by CH3.
An external writer can also change disk after a successful readback; there is no
continuous filesystem watcher in this slice. Linux metadata behavior needs hosted
platform proof. Unsupported metadata fails closed rather than being stripped.

A text save does not persist Loro operation history, claims, pending dependencies,
or private draft keys. The existing reload/history guard remains armed after text
saving. Window/process loss can still lose unpreserved history and newer edits.
Shared acceptance, principal/device admission and public recovery remain unavailable.

No actual native screenshots, recording, IME/keyboard/zoom/accessibility or human
task testing is claimed. The halt forbids app launch; there is no HTML substitute
or visual-gate exemption. Save As, richer platform metadata support, private draft
recovery and the remaining CH2 checklist are unfinished. No app, daemon, service,
paid run, deployment or operator stop-marker change was performed.
