# Sandboxed Adversarial Test Harness

Procedural guidance for designing an adversarial test harness that proves a sandbox
contains untrusted or AI-authored code and agent actions, rather than just checking
that the code's own tests pass.

Use this skill when a sandbox, worktree, output sink, or trust gate is about to hold
real agent actions and you need to prove — not assume — that a malicious payload
cannot escape it, exfiltrate secrets, or exhaust host resources.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/threat-classes-and-adversarial-recipes.md` for the five threat
   classes and concrete attack payloads (SSRF to metadata endpoints, path traversal
   via `../` and symlinks, secret exfil via DNS).
3. Load `references/isolation-mechanisms-macos-linux.md` for the mechanisms that
   actually enforce each isolation dimension on macOS and Linux, plus fail-closed
   gating.
4. Write a harness spec covering isolation dimensions, egress/path/secret policy,
   and one adversarial case per threat class in scope.
5. Run `node scripts/containment_audit.mjs --input harness-spec.json`.
6. Gate deployment on `pass: true` and zero unaddressed findings.

The harness audits the *design* of a spec — coverage, allowlist-vs-denylist shape,
default-allow egress, fail-open modes — so a passing result is safe to wire into a
real execution harness and CI gate.
