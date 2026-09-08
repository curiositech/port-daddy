# Ambition Archaeology Consistency Proposals

Status: pending Harbor Architect of Record baseline run.

This file is reserved for the first baseline pass described in
`work-packets/harbor-architect-baseline-ambition-archaeology.md`.

Expected contents:

- executive verdict;
- ambition classification table;
- contradiction register;
- missing chapter or section proposals;
- customer blindspots;
- technical blindspots;
- operator decision requests;
- implementation gate changes;
- ordered binder patch plan;
- mandatory `binder-aor-log:` ledger entry.

## Interim contradiction register: state-plane wave 1 (2026-07-10)

The baseline pass has not run, but the `binder-aor-log:` ledger note of
2026-07-10 recorded four findings during the state-plane wave-1 dispatch.
They are tracked here so the baseline run inherits them instead of
rediscovering them.

CR-1 (shipped-vs-target, unresolved):
  The `pd-console` Steer/Pause/Interrupt/Checkpoint buttons POST an F0
  ControlCommand, but no `control_commands` table or daemon ingress exists to
  receive it; the control-contract audit scores 0. The buttons are wired to a
  contract with no counterparty. Resolution owner: control-contract-wirer,
  wave 2.

CR-2 (shipped-vs-target, unresolved):
  The live interrupt route is lease-less fire-and-forget, contradicting the
  `lib/agent-harbor/control-gate.ts` doctrine that control commands are
  leased, acknowledged, and recorded. Chapter 02's remote interrupt race test
  cannot pass on this path. Resolution owner: control-contract-wirer, wave 2.

CR-3 (authority, unresolved):
  The roadmap has no single system of record: the committed snapshot carries
  151 items while the :9876 daemon exports roughly 127-128. Chapter 02's
  state-plane delta documents the divergence hazard and the surgical-union
  mitigation; the authority question itself remains open. Resolution owner:
  roadmap-reconciler, wave 2.

CR-4 (process, resolved by this entry):
  Wave 1 was dispatched without in-slice binder updates, violating the rule
  that architecture changes update the binder in-wave. Closed by the PR that
  adds this register and the chapter 02/04/05 deltas for PRs #1724, #1729,
  and #1723.
