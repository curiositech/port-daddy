# Agent Resurrection and Body Continuity

Use this skill to design or audit continuity when a living durable worker loses
its temporary VM, process, provider session, backend, or context window.

It deliberately does not revive retired identities, transfer credentials, or
claim that provider-native sessions are portable. The output is a receipted
rebodiment plan and one fail-closed verdict.

Start with `SKILL.md`. Load `references/resurrection-protocol.md` for lifecycle,
effect, and capsule design; load `references/capability-translation.md` only for
cross-harness fit. Validate any machine plan with both the JSON Schema and
`scripts/validate-resurrection-plan.mjs`. The examples are synthetic and perform
no launch.
