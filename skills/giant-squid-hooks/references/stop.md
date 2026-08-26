# pd-hook-stop — end-of-turn closeout gate (PD CLOSE)

Source: `bin/pd-hook-stop`. Implements the closeout-gate half of ADR-0092 L4:
when the agent's turn ends, verify that the final assistant message carries
the SITREP table `bin/pd-hook-prompt` compelled at turn start, and — under the
`enforce` dial — block ONCE with the directive as the reason so the model
emits the table before yielding.

## Decision ladder (in execution order)

1. `stop_hook_active:true` → exit 0. Before any dial or parsing work.
2. camelCase agy payload (`terminationReason`/`workspacePaths`/`fullyIdle`)
   → exit 0. Observe-only vendor (below).
3. Resolve the `sitrep.endOfTurn` dial (`PD_SITREP` env → parent walk, same
   code shape as `bin/pd-hook-prompt`; default enforce). `off` → exit 0.
4. Extract final text: `last_assistant_message` (Claude/Codex) else
   `prompt_response` (Gemini), via `jq` else `python3`. No parser at all →
   UNVERIFIABLE → exit 0. Empty/null final text (Codex may send null) →
   UNVERIFIABLE → exit 0.
5. Generous SITREP detection: case-insensitive `sitrep` AND at least one
   markdown table row (`|…|`) in the final text. Present → exit 0, byte-silent.
   A false PASS skips one reminder; a false BLOCK burns a turn — loose on
   purpose, in the fail-open direction.
6. Absent + `suggest` → exit 0; only when `PD_HOOK_PROVIDER=claude` AND jq is
   present, emit `{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":…}}`.
   Every other provider stays byte-silent (Codex invalidates raw stdout).
7. Absent + `enforce` → one-shot marker, then exit 2 with the SITREP
   directive on stderr.

## Loop guards (why this cannot wedge a CLI)

- **Vendor guard**: `stop_hook_active` is honored first. Claude additionally
  hard-caps 8 consecutive Stop blocks. Gemini and Codex document NO cap.
- **Harness guard**: a mkdir-atomic marker directory under
  `$PD_HOME/squid/stop-blocks/<session>.blocked` with TTL
  `PD_SQUID_STOP_BLOCK_TTL_SECONDS` (default 300 s). At most one block per
  session per window; a stale marker (older than the TTL) is recycled into a
  fresh one-shot. mkdir is the lock — two concurrent stops cannot both block.
  Session key: `session_id`/`sessionId`/`thread_id`/`conversationId`,
  falling back to `$PPID` when jq is absent.

## The reason is a prompt

The exit-2 stderr text is fed to the model as its next instruction. It is the
SITREP directive itself — table header, tracking rules, the roadmap-link
rule, and "emit the table now, then end the turn" — mirroring
`bin/pd-hook-prompt`'s enforce text so compulsion and verification state one
contract. Never pipe transcript excerpts into it. Codex rejects exit 2 with
an empty stderr, so the directive is always written before exiting 2.

## Why the transcript is never parsed

Claude's docs say the transcript at Stop time "may lag" — the stdin
final-message field is the only reliable source, and full-parsing a
transcript would blow the 250 ms breaker (`lib/squid/debug.ts:33`). This is
also why agy (no final-message field, only a `transcriptPath`) is
unverifiable rather than tail-parsed.

## Antigravity: observe-only, by decision

- agy's Stop payload has NO final-message field.
- agy has NO `stop_hook_active` guard (only `executionNum`), so a block loop
  would have no vendor-side brake.
- agy's block verb is a different dialect
  (`{"decision":"continue","reason":…}` — decision REQUIRED, anything else
  allows the stop), incompatible with the universal exit-2 path.
- Reliability reports (IDE 1.107.0) say agy Stop hooks may not fire at all.

The hook is still registered for agy (parity + observability), but the
tentacle exits 0 on the camelCase shape unconditionally.

## Accepted misses (documented, not bugs)

- Claude `Stop` does not fire on user interrupts — an interrupted turn is
  never SITREP-checked.
- `SubagentStop` (Claude, Codex) is out of scope for this tentacle; ADR-0092
  L4's adversarial-review pipeline is the follow-up.
- With neither `jq` nor `python3` on PATH the final text is unverifiable and
  the gate silently passes — missing tooling never blocks.

## Coexistence note

An earlier repo-local Claude-only hook (`.claude/hooks/stop-sitrep.sh`,
PR #9768, auto-posting and never-blocking) covers the same Stop event for
this repo only. If both land, this repo double-fires on Stop; the local
entry should be retired once the harness tentacle is armed here (follow-up,
not part of the tentacle's PR). <!-- cite-exempt: the local hook lives on an unmerged PR branch -->

## Test seams

- `tests/unit/squid-harness.test.ts` — the `pd-hook-stop closeout gate`
  describe block: enforce block + directive, one-shot marker, short-circuit,
  compliant pass, Gemini `prompt_response`, agy observe-only, null final
  text, dial off, suggest per-provider output, garbage stdin.
- `scripts/squid-selftest.sh` — the same contracts dependency-free.
- `scripts/smoke-squid-release.mjs` — proves the staged release registers the
  stop entry once per provider (including Codex `[[hooks.Stop]]`).
