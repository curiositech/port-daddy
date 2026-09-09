# Sandboxed Adversarial Test Harness / Drydock Safety Engineering

This skill designs and audits laboratories for untrusted code, tests, daemons, and
agent runtimes. It separates five proof domains that are often blurred:

1. VM and host isolation.
2. Typed I/O and capability brokering.
3. Broker-authorized spend versus provider-enforced financial custody.
4. Deterministic fault and schedule exploration.
5. Sealed provenance and externally witnessed receipts.

The legacy JSON schema and `containment_audit.mjs` remain available for narrow T0
policy-shape lint. Their `pass` result is not runtime containment evidence and does
not authorize execution.

## Quick start

1. Read `SKILL.md` and honor its halt gate.
2. Select the references named by the expertise map.
3. Fill `templates/output-template.md` without launching the subject.
4. Check the activation cases in `tests/activation.md`.
5. Validate the skill bundle with the external skill-architect validators.

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
