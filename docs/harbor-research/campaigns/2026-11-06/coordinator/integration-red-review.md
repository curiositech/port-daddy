# Integration RED review — 6 November 2026

Three actionable issues were found. The coordinator authorized RED to repair the two exporter issues in `scripts/harbor-research/export_campaign_transcripts.py` and its focused test file. The coordinator repaired the CI trigger omission. The fixes below await the coordinator's independent review; RED does not label its own repair independently accepted.

Exact linked worktree `/Users/erichowens/coding/tmp/research-program-next-result-20261106`, branch `codex/research-program-next-result-20261106`, and linked gitdir were reverified before writes. No primary-checkout edits, runtime starts, Port Daddy calls, spawned agents, native transcript refreshes, or real private transcript-body reads occurred. Only the two explicitly authorized source/test files and this report were edited; unit tests created and cleaned their synthetic fixtures.

## Findings and disposition

### IR-1 — P2: structured tool output bypassed protected-content exclusion

At the original `project()` scanner, recursive traversal joined only string values and lost object keys. In-memory calls reproduced retention, with an empty omission reason, of each of these synthetic tool outputs:

```python
{"role": "system", "content": "SYNTHETIC_PRIVATE_PROMPT"}
{"type": "reasoning", "text": "SYNTHETIC_PRIVATE_REASONING"}
{"access_token": "SYNTHETIC_CREDENTIAL_12345"}
{"internal_chat_message_metadata_passthrough": {"account": "synthetic"}}
```

The same tool exchange could consequently appear in a purported sanitized projection despite its exclusion contract. This is a sanitizer defect, not evidence that any actual protected record was published.

Repair: `omission_reason()` at line 130 now checks structured role/type/channel/phase and known internal keys, retains key/value context for credential detection, and inspects JSON strings after decoding, including repeated encoding. Deep/unsupported nested content fails closed. Existing whole-exchange pairing excludes both sides when one is rejected. Regression tests cover direct objects, nested objects/lists, encoded JSON, doubly encoded JSON, known internal prompt/reasoning/account fields, preserved safe structured output, and paired omissions.

### IR-2 — P2: new private archives inherited permissive permissions

Original `archive()` used `Path.write_bytes`, so a newly discovered descendant's archive inherited the caller's umask rather than the README's promised mode 0600. The 24 already retained archives were inspected by mode only and were all 0600; they also matched Git's ignore rules. No current public archive-body exposure was found. Existing private modes did not protect future newly created archive names.

Repair: `private_directory()` and `private_write()` at lines 258 and 280 use descriptor-relative POSIX directory traversal with `O_NOFOLLOW`; new output directories are 0700. Every archive and manifest is first written to an exclusive random temporary file created and explicitly set to 0600 **before any data write**, flushed and fsynced, then atomically replaced. Symlink directory components, symlink destinations and multi-link destinations are rejected. A failed replacement retains the prior archive and removes the owned temporary file.

Synthetic tests set umask 000, inspect the descriptor mode at the first write, add a newly discovered descendant on a second export, and verify every resulting file remains 0600. Separate tests verify directory/file symlink and hardlink rejection and failed-replacement recovery. This is not a claim of same-UID adversary confinement or perfect detection of all secret encodings.

### IR-3 — P2: fixture-only changes skipped admission CI

The new admission suite reads `tests/fixtures/harbor-research/future-admission/*.json`, but neither workflow path filter initially included that directory. A fixture-only PR could therefore avoid the very checks that consume it. The coordinator added `tests/fixtures/harbor-research/**` to both push and pull-request filters; current source contains the entries at lines 38 and 58. RED did not edit the workflow or the ledger/corpus.

## Focused validation

- `python3 -B skills/harbor-results/scripts/test_future_fact_reachability.py`: 27 tests passed; 49,152 exhaustive decisions, including 30,528 replayed unsafe witnesses, zero disagreements.
- `python3 -B skills/harbor-results/scripts/test_bonded_trigger_audit.py`: 14 tests passed, including independent geometric payoff/value comparisons and off-path mutation controls.
- `python3 -B scripts/harbor-research/test_war_room.py`: 11 tests passed, including tamper/truncation rejection, timeouts, environment scrubbing, and explicit shared-host-read limitation.
- `python3 -B scripts/harbor-research/test_export_campaign_transcripts.py`: original nine tests passed while IR-1/IR-2 were present, showing their coverage gaps. After repair, all 16 tests pass, including the new structural/privacy regressions.
- Scoped whitespace checks passed. The exporter source and tests are new/untracked in the integrated branch, so source inspection and executed tests are stronger evidence than a Git diff command alone.

## Other reviewed surfaces

No additional actionable correctness bug was found in the declared scope of `future_fact_reachability.py`, its independent oracle, or `bonded_trigger_audit.py`. The future checker validates all graph endpoints, explores control-state identities before reducing fact sets, handles incomplete exploration conservatively, and binds witnesses to model/policy digests. The test oracle uses independent graph closure and truth assignments rather than the implementation's traversal/Horn propagation. The bonded auditor evaluates both principals in every public state with exact rational continuation values; its stated exclusions cover participation and finite funding.

`check_admission_revision.py` was inspected for acceptance of malformed or wrong-kind TLC results. It requires the configured invariants, expected tool exit codes, completed 12-state safety exploration, and exact concrete negative-control states; parse/runtime failures do not become successful controls. The integration review did not launch a new TLC run; earlier Gate C evidence remains separate.

The recorder continues to label itself a host-reviewed process runner, with hash integrity tied to an external seal and explicit lack of OS privacy or hard resource quotas. The proof-guest profile still has no NIC/share/vsock, fixed disks, no serial input, bounded serial reads before queued emission, explicit network-tool availability, and scoped image decoding. Its crash cleanup and hostile overflow/timeout fault tests remain limitations already documented; this review did not execute another VM.

Public viewer review found DOM insertion through `textContent`, an explicit source allowlist for exported data, no native transcript archives in the public directory, and clear separation of symbolic proof, fixed guest probes, host-side research agents and production claims. The existing private archive bodies were neither opened nor copied. This was a source/data-boundary review, not a fresh rendered browser QA pass or hosted deployment verification.

## Handoff

Coordinator should independently review and rerun the two exporter changes, then refresh private projections through the repaired path if desired. Any refresh must preserve the existing Git ignore and local-only publication boundary. No remaining integration blocker is asserted beyond independent acceptance of these repairs.

Reviewed hashes at handoff:

- `scripts/harbor-research/export_campaign_transcripts.py`: `7c1624c04bfa93d056f88fedceae1f33aa1e4ca099d5a0f44221fb7992908002`
- `scripts/harbor-research/test_export_campaign_transcripts.py`: `5872333555f118de44118c6fe52d03485075ae680e652a0dea35aa55e1771540`
- `skills/harbor-results/scripts/future_fact_reachability.py`: `2fdf4522e6703de39f6ceb0b0498a7cf0bd2cb35ec7e9c4c80fb8e3beaa99cde`
- `skills/harbor-results/scripts/test_future_fact_reachability.py`: `e85e13dde8dd7f9a6b28f9fe1774bd382a97e5fe6cde191d2c31e381df56d354`
- `skills/harbor-results/scripts/bonded_trigger_audit.py`: `09ef06c5bfba7f30973aceb2390a5f2a57508e8a074f36c1ddab6e52f258a7d1`
- `scripts/harbor-research/war_room.py`: `ed04e8312daa54231473ad6e3a4d736fadb31c6a7a3fed17db8c3854be490dea`
- `scripts/harbor-research/check_admission_revision.py`: `77750319892d3770f93b97bac08525aa7e2a5b0053414ec20a8c90db7417c39c`
- `.github/workflows/proofs.yml`: `b81496b0845cc6f0c5de1cb2efc6f9ee9d86f0bb6c54062ca7397af75f08dba4`
