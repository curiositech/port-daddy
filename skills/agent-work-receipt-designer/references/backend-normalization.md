# Backend Normalization And Provenance

Use this when you need to derive a normalized receipt from a specific agent
backend's raw logs, or when deciding how to sign/attribute a receipt so it
survives the originating session closing.

## Why normalization is the actual product

Every tool emits a different shape: Claude Code writes JSONL transcripts with
tool_use/tool_result blocks; Codex CLI writes its own session log plus a
patch/diff artifact; Cursor keeps composer history client-side with no stable
export; Aider writes a `.aider.chat.history.md` plus git commits it makes
directly; CI just gives you stdout and an exit code. None of these agree on
what a "test result" or a "file change" looks like. The receipt schema is the
lingua franca — normalization is the actual integration work, not an
afterthought.

## Per-backend extraction map

| Backend | Identity source | Actions source | Validation source | Gotchas |
| --- | --- | --- | --- | --- |
| Claude Code | `session_id` in transcript JSONL; `cwd` field | `tool_use` blocks of type `Bash`/`Edit`/`Write`; each `tool_result` carries stdout+exit status | Look for `tool_use` Bash calls matching test-runner patterns (`pytest`, `cargo test`, `npm test`, `vitest`); pull the paired `tool_result`'s exit code, never the assistant's next text turn | The assistant's own prose ("tests pass now") is NOT validation evidence — only the `tool_result` payload is. If the transcript lacks a `tool_result` for a claimed test run, treat it as self-reported and fail the check. |
| Codex CLI | session id in `~/.codex/sessions/*.jsonl` | `exec_command` events carry `command`, `exit_code`, `duration` directly — closest to receipt-native | `exec_command` output blobs; grep for the test runner's own pass/fail summary line, cross-checked against `exit_code` | Codex sometimes truncates long stdout; if truncated, treat as partial evidence and note `manualVerification`. |
| Cursor | No stable session export as of 2026; use the workspace `.cursor/` composer log if present, else fall back to `operator` self-attestation with `backend: "cursor"` and a lowered confidence note | Terminal panel history if user grants access; otherwise only the final diff is available | Diff-only receipts from Cursor should mark `validation.artifactBacked: false` unless the user pastes in real test output | Do not fabricate exit codes for Cursor sessions — this is the backend most likely to tempt a "just say it passed" shortcut. Resist it. |
| Aider | `.aider.chat.history.md` timestamps; git commit author trailer if Aider commits | Aider echoes shell commands it runs (`/run`) with output inline in the chat history | Same as commands: look for the actual runner output block, not Aider's own summary sentence | Aider auto-commits per edit; use the commit range as `rollback.checkpoint` (first commit sha before the task started) rather than a single sha. |
| Homegrown / custom harness | Whatever your orchestrator assigns as a run id | Structured log lines if you emit them; otherwise wrap every shell-out so you capture `{cmd, exitCode, durationMs}` by construction | Native — build it artifact-backed from day one rather than reconstructing after the fact | This is the easiest backend to get right and the easiest to get lazy on. Enforce `receipt_lint.mjs` in CI so a schema-shaped receipt is a merge gate, not an afterthought. |
| CI (GitHub Actions, etc.) | workflow run id + job name | Every step is already `{name, exitCode}` — map directly | Step logs and uploaded artifacts (coverage.xml, junit.xml) map directly to `artifactPath` | CI is the gold-standard backend for `artifactBacked: true` — use a passing CI run's receipt as the reference shape when auditing weaker backends. |

## The one universal rule

**A test entry is `passed: true` only if it carries a real `exitCode` or a
real `artifactPath` pointing at captured output.** If your extraction script
cannot find either for a claimed pass, the correct normalized value is
`passed: false` with a note in `validation.manualVerification`, not an
optimistic guess. `scripts/receipt_lint.mjs` enforces this mechanically
(`self-reported-validation` finding), but the discipline has to start at
extraction time — garbage in, garbage that a linter merely confirms.

## Signing and attributability

Chat sessions close. Worktrees get deleted. Six weeks later someone asks "who
approved merging this and what proved it worked" and the chat transcript is
gone. Provenance is what survives:

- **Minimum bar**: `provenance.contentHash` — a hash of the receipt body
  (canonicalize field order before hashing, e.g. sort keys, so re-serializing
  doesn't change the hash). This alone gives tamper evidence: if the receipt
  in your durable store doesn't match its own hash, something rewrote it
  after the fact.
- **Attributable bar**: `provenance.signedBy` + `signature` — sign the
  contentHash with a key tied to the agent identity or the operator's key.
  For local Port Daddy work this can be as light as an ed25519 keypair per
  agent identity; for anything crossing an org boundary (OSS PR review,
  contractor work) use a real signing chain (Sigstore/cosign-style keyless
  signing, or a GPG-signed git commit trailer referencing the receipt hash).
- **Replayable bar**: `provenance.replayCommand` — a single command that,
  given the `rollback.checkpoint`, reconstructs the validation
  (`git checkout <sha> -- <paths> && <test command>`). A receipt that cannot
  be replayed is a claim; a receipt that can is closer to a proof.
- **Durable storage**: never let the receipt live only in the chat transcript
  or the agent's scratch directory. Commit it alongside the PR (e.g.
  `.port-daddy/receipts/<sessionId>.json`), attach it as a CI artifact, or
  write it into a durable note/table (Port Daddy notes, a Postgres table, an
  S3 bucket) — anywhere that outlives the process that produced it.

## Failure semantics for the normalizer itself

| Situation | Normalizer behavior |
| --- | --- |
| Backend log is truncated mid-command | Emit the command with `exitCode: null`-equivalent (omit the field) and add a `risks[]` entry, severity `medium`, "validation may be incomplete due to truncated log." |
| Two backends disagree on the same session (e.g. Codex wrapping Claude Code) | Prefer the innermost/most granular source of exit codes; note the wrapping in `identity.backend` as the outer tool, `identity.agent` as the inner role. |
| Agent claims a rollback point that no longer exists (rebased away, branch deleted) | Fail `rollback` validation outright — do not silently accept a dangling pointer as "verified." |
