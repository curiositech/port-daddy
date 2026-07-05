# Example Output: Agentic Coding Product Research

## Input Context

Research question: what should Port Daddy build around AI coding assistants after reviewing Cursor, Claude Code, Codex, Warp Code, Devin, Windsurf/Cascade, Copilot, Cline, Aider, OpenHands, and homegrown agent stacks?

Evidence lanes:
- Official docs for product mechanics and stated workflows.
- Tech press for positioning, trust incidents, pricing friction, and adoption signals.
- Academic papers for failure modes, PR acceptance, and agent benchmark limits.
- Social/homegrown workflows for hacks people repeat because product surfaces are missing.

## Audience Matrix

| Audience | Job | Pain | Comeback Trigger | Port Daddy Implication |
| --- | --- | --- | --- | --- |
| Staff engineer | Delegate scoped refactors across a large repo | Agent state is invisible until review time | A PR with transcript, tests, and rollback | Session identity, claims, proof, and reviewer replies |
| Solo founder | Ship UI/API changes without context rebuilding | Tool churn and surprise spend | One prompt resumes from the last verified state | Durable context, spend caps, and checkpoint restore |
| Maintainer | Review outside agent PRs quickly | Low-signal patches and missing tests | Machine-readable proof bundle attached to PR | Review receipts, eval traces, and policy gates |
| Enterprise admin | Permit agent work safely | Data exfiltration and uncontrolled tool execution | Policy and audit trails without slowing developers | Coast Guard, budget ledgers, role permissions |

## Ranked Opportunities

1. Agent Harbor as the control plane around every coding assistant.
   Proof required: live fleet roster, per-agent transcript, cost, sandbox, and PR state.
2. Review-proof bundles for AI-authored work.
   Proof required: linked diff, tests, failed attempts, reviewer comments, and response state.
3. Swarm invocation from operator intent.
   Proof required: typed delegation, role roster, progress view, kill switch, and durable receipt.

## Skeptical Caveats

- Benchmarks do not predict repeated use by themselves.
- Pricing/support incidents can be transient, so verify current state before quoting.
- Social praise often omits the hidden human cleanup burden.
- A Port Daddy answer should strengthen orchestration and trust, not become another code-completion UI.
