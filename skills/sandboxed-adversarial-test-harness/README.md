# Sandboxed Adversarial Test Harness / Drydock Safety Engineering

This skill designs and audits laboratories for untrusted code, tests, daemons, and
agent runtimes. It separates seven proof domains that are often blurred:

1. Trusted-language, process, package, and release boundaries.
2. VM and host isolation.
3. Typed I/O and capability brokering.
4. Broker-authorized spend versus externally bounded billable loss, plus a
   separate subscription-native capacity envelope that is never called free.
5. Durable agent admission, process witnessing, crash recovery, and spawn-storm
   breakers.
6. Deterministic fault and schedule exploration.
7. Sealed provenance and externally witnessed receipts.

Production continuity and allowance policy stay in their owning skills:
`agent-resurrection-and-body-continuity` produces the normative rebodiment plan,
and `context-economics-for-agent-swarms` produces capacity evidence. Drydock
attempts to falsify their concrete implementation at an exact tier.

The legacy JSON schema and `containment_audit.mjs` remain available for narrow T0
policy-shape lint. Their `pass` result is not runtime containment evidence and does
not authorize execution.

## Quick start

1. Read `SKILL.md` and honor its halt gate.
2. Select the references named by the expertise map.
3. Fill `templates/output-template.md` without launching the subject.
4. Check the activation cases in `tests/activation.md`.
5. Validate the skill bundle with the external skill-architect validators.

The canonical default-branch checkout is never a Drydock worksite or source
authority. Fetch through a dedicated bare vault, materialize exact commits in
disposable worktrees, author in guest-local worktrees, and promote only into a
fresh host linked review worktree on a non-default branch.

## Safe validation

These checks inspect the skill bundle itself. They do not execute Port Daddy or a
hostile specimen:

```bash
python3 <skill-architect>/scripts/validate_skill.py skills/sandboxed-adversarial-test-harness
python3 <skill-architect>/scripts/check_self_contained.py skills/sandboxed-adversarial-test-harness
```

Do not run the legacy audit script or any repository test while an operator halt
forbids Port Daddy code execution. A validator result is a skill-quality result,
not a Drydock promotion receipt.
