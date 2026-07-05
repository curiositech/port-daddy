# Complete Plan Anatomy

Use this when a project plan needs to become executable by humans and agents.

## Required Sections

1. Product promise: the exact job, user, payoff, and non-goals.
2. Audience and jobs: primary, secondary, and excluded users.
3. Cold start: first visit, account creation, token/provider setup, demo mode, and empty state.
4. Core journeys: happy path, failure path, recovery path, repeat-use loop.
5. Surface map: GUI, CLI, SDK, MCP, API, docs, webhooks, and background agents.
6. Architecture: data objects, state ownership, integrations, hosting, auth, permissions, and trust boundaries.
7. Agent workflow: trigger, input, scope, permissions, progress, receipt, interruption, and rollback for each agent.
8. Build slices: PR-sized milestones with acceptance criteria and proof artifacts.
9. Test and eval plan: unit, integration, visual, transcript, load/cost, and adversarial product review.
10. Launch plan: onboarding, support, pricing/cost, telemetry, privacy, docs, and post-launch review.

## July 2026 Defaults

- Users may not have paid AI accounts. Provide demo, bring-your-own-key, routed-provider, and local/mock paths.
- Agents need receipts. Every background action should leave a transcript, artifact, status, or diff.
- Product plans should include a "what happens when this fails" path for auth, model access, data import, and agent runs.
- Multi-agent work needs ownership and communication rules before the first agent is spawned.

## Useful Plan Questions

- Who sees value before they configure anything?
- How does a user create an account, invite a teammate, and recover a lost session?
- What does the app do with no API key, no Claude Max, no OpenAI Pro, and no MCP installed?
- Which actions need GUI affordances because the user should not memorize a command?
- Which actions belong in CLI, SDK, MCP, or background agents because they are repeatable or automatable?
- What proof lets the user believe the app did the work?
- What rollback path turns a scary failure into a recoverable moment?
