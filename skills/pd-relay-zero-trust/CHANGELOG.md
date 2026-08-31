# Changelog — pd-relay-zero-trust

All notable changes to this skill are documented here.

## [0.1.0] — 2026-04-26

Initial skill scaffold.

### Added
- `SKILL.md` — L1/L2 surface with task branches, sequencing, anti-patterns, quality gates
- `references/` — 13 reference files covering zero-trust foundations, three PKI options (ACME, OIDC, Web-of-Trust), decision matrix, Merkle event chains, relay architecture, Phase 3 attenuation, E2E payload encryption, ProVerif extension, deferred Float Plans, V4 remote-harbor redefinition, threat model
- `schemas/` — 6 JSON Schemas: script-io envelope, harbor card, attenuated card chain, event envelope, signed chain head, relay handshake
- `scripts/` — 8 Python scripts with `--selftest` mode: PKI decision scoring, handshake verification, Merkle chain verification, chain-head signing, Phase 3 attenuation construction/verification, AES-256-GCM round-trip, threat-model checklist, skill validator
- `templates/` — 6 templates: ADR-PKI-Decision, ADR-Relay-Architecture, ADR-V4-Remote-Harbor-Redefinition, reference relay-handshake message pair, reference attenuated-card chain, ProVerif relay-handshake skeleton
- `examples/` — 4 walkthroughs: full handshake trace, chain verification + tamper detection, Phase 3 attenuation for a GitHub Action, ProVerif extension for the relay
- `agents/` — 4 subagent prompts: ACME specialist (domain expert) plus proponent / pragmatic / antagonist deliberation set
- `openapi.yaml` — relay surface (handshake, publish, subscribe SSE, chain heads, identity enroll, revoke, exchange, key lookup, health)

### Conventions
- All scripts read/write JSON envelopes per `schemas/script-io.schema.json`
- ADR templates target ADR numbers 0025 (PKI), 0026 (relay), 0027 (remote harbor redefinition); the original 0021/0022/0023 numbers were already allocated to bosun-consolidation, durable-actor-souls, and cartographer-roadmap; 0024 was claimed by daemon-profiles while this skill was being authored
- Reference depth follows skill-architect L2/L3 progressive disclosure

### Open work tracked outside this changelog
- Land actual relay code under `lib/`, `routes/`, `mcp/` (out of scope for this skill, but informed by it)
- Extend ProVerif models in `apps/relay/formal/proverif/` per `references/proverif-relay-extension.md`
- Update `V4-DAG.md`, `v4.dag.yaml`, `V4-MASTER-PLAN.md` per ADR-0027
