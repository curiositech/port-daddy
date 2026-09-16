# Offline implementation follow-through

Owner: Codex, current solo author of PR #10108. Baseline: `edd1a7403`.
Scope: packet schema parity, synthetic temporal/consequence harness, and the
existing Harbor integration contract. This checklist is a local work record,
not a second roadmap, runtime permission, or assertion of research benefit.
Port Daddy remains halted. No services, providers, agents, or workflows run.

- [x] Declare and test packet/schema parity.
- [x] Make the existing R17 checker importable without running experiments.
- [x] Implement bounded temporal replay and consequence fixtures using R17.
- [x] Test temporal exceptions, provenance invalidation, actor continuity,
      tenant separation, revoked access, and incomplete input.
- [x] Map existing Harbor/editor surfaces, participants, recovery and cold start.
- [x] Record research reuse, milestone owners, gates, and binder disposition.
- [x] Run offline verification; update skill, README and evidence handoff.
- [x] Commit the exact work and update #10108 through an authorized publisher,
      or preserve the commit and state the publication blocker.

Local implementation commits: `dd6985a25` (packet/CSP corrections) and
`014791342` (synthetic temporal/consequence harness and R17 reuse). This
checklist, integration contract and reply draft accompany the separate local
documentation handoff commit. No follow-through commit or reply is published.

Excluded: production event admission, crypto/auth verification, live editor
recovery, paid H1–H4 studies, provider configuration, automation, deployment,
and lifting the halt. Synthetic assertions are not real credentials or consent.

Publication hold: the inspected `apps/relay/src/github-webhook.ts` still lists
`synchronize` and `edited` as Fleet triggers. PR #10109 was read back open and
unmerged. Neither source nor its future merge proves a deployed pause, and no
current no-spawn receipt is available here. Do not push or edit #10108 metadata
until the external Fleet path is confirmed disabled or the operator explicitly
authorizes those exact downstream effects. No merge/queue action is requested.
