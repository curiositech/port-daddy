# Agency and planning skill partition

## Activation boundary

| Canonical skill | Use for | Source bundles |
|---|---|---|
| `bdi-agent-architecture` | individual decision state and reconsideration | 5 |
| `bdi-agent-interpreters` | event, plan, and intention runtime semantics | 6 |
| `bdi-organizational-modeling` | socio-technical interpretation and accommodation | 3 |
| `bdi-normative-reasoning` | obligations, prohibitions, and norm conflicts | 3 |
| `hypertree-planning` | research method for hierarchical outlines | 2 |
| `pilot-hypertree-execution` | Port Daddy work clusters and agent waves | 1 |

## Exact old to new mapping

- `skills/belief-desire-intention-model-of-agency/` → `skills/bdi-agent-architecture/sources/belief-desire-intention-model-of-agency/`
- `skills/the-belief-desire-intention-model-of-age/` → `skills/bdi-agent-architecture/sources/the-belief-desire-intention-model-of-age/`
- `skills/bdi-agency-model/` → `skills/bdi-agent-architecture/sources/bdi-agency-model/`
- `skills/rao-georgeff-1991-modeling-rational-agents-bdi/` → `skills/bdi-agent-architecture/sources/rao-georgeff-1991-modeling-rational-agents-bdi/`
- `skills/rao-georgeff-1995-bdi-agents-from-theory-to-practice/` → `skills/bdi-agent-architecture/sources/rao-georgeff-1995-bdi-agents-from-theory-to-practice/`
- `skills/bdi-agent-design-mora/` → `skills/bdi-agent-interpreters/sources/bdi-agent-design-mora/`
- `skills/bdi-models-and-systems-reducing-the-gap/` → `skills/bdi-agent-interpreters/sources/bdi-models-and-systems-reducing-the-gap/`
- `skills/bdi-models-and-systems-reducing-the-gap-paper/` → `skills/bdi-agent-interpreters/sources/bdi-models-and-systems-reducing-the-gap-paper/`
- `skills/agentspeak-bdi/` → `skills/bdi-agent-interpreters/sources/agentspeak-bdi/`
- `skills/agentspeak-l-bdi-agents-speak-out-in-a-logical-computable/` → `skills/bdi-agent-interpreters/sources/agentspeak-l-bdi-agents-speak-out-in-a-logical-computable/`
- `skills/agentspeak-l-bdi-architecture/` → `skills/bdi-agent-interpreters/sources/agentspeak-l-bdi-architecture/`
- `skills/bdi-agents-a-soft-model-for-organisation/` → `skills/bdi-organizational-modeling/sources/bdi-agents-a-soft-model-for-organisation/`
- `skills/bdi-soft-model-for-organisations/` → `skills/bdi-organizational-modeling/sources/bdi-soft-model-for-organisations/`
- `skills/bdi-soft-systems/` → `skills/bdi-organizational-modeling/sources/bdi-soft-systems/`
- `skills/normative-bdi-agent-architecture/` → `skills/bdi-normative-reasoning/sources/normative-bdi-agent-architecture/`
- `skills/normative-bdi-agents/` → `skills/bdi-normative-reasoning/sources/normative-bdi-agents/`
- `skills/a-normative-extension-for-the-bdi-agent/` → `skills/bdi-normative-reasoning/sources/a-normative-extension-for-the-bdi-agent/`
- `skills/chen-et-al-2025-hypertree-planning/` → `skills/hypertree-planning/sources/chen-et-al-2025-hypertree-planning/`
- Former `skills/hypertree-planning/SKILL.md` → `skills/hypertree-planning/sources/prior-entry/SKILL.md`; original root references remain.
- Former `skills/pilot-hypertree-execution/SKILL.md` → `skills/pilot-hypertree-execution/sources/prior-entry/SKILL.md`.

## Integrity and source treatment

All listed source bundles were moved whole, including references, examples, diagrams, scripts, provenance, and changelogs. Canonical `SKILL.md` files synthesize their distinct task decisions; the originals remain available for attribution and deeper reading. Imported claims are not treated as proven merely because multiple bundles repeat them.

- `bdi-agent-architecture`: 72/72 tracked source files are byte-identical after relocation; mismatches: 0.
- `bdi-agent-interpreters`: 120/120 tracked source files are byte-identical after relocation; mismatches: 0.
- `bdi-organizational-modeling`: 31/31 tracked source files are byte-identical after relocation; mismatches: 0.
- `bdi-normative-reasoning`: 33/33 tracked source files are byte-identical after relocation; mismatches: 0.

## Research correction

The HyperTree Planning paper is Runquan Gui et al., *HyperTree Planning: Enhancing LLM Reasoning via Hierarchical Thinking* (2025), [arXiv:2505.02322](https://arxiv.org/abs/2505.02322). The historical bundle names and text misattribute it as “Chen et al. 2025” or “Gui et al. 2024.” The canonical skill uses the paper attribution and does not repeat imported numerical generalizations as universal claims.

## Integration boundary

Historical documents and attribution catalogs elsewhere in the repository may still name removed top-level skill paths. This slice leaves them unchanged because they are outside its owned edit surface. Update current catalogs and operational path registries during integration; preserve historical records as history.
## Validation note

The root entrypoints pass `skill-architect/scripts/validate_skill.py` and `skill-hygiene/scripts/audit_skill_bundle.py`. The self-containment checker resolves nested archived source references against the new canonical root rather than each preserved source bundle; for example, `sources/bdi-agency-model/SKILL.md` refers to its own `references/` directory, which exists. Its root-level phantom report on those nested imports is therefore a checker limitation, while the byte-for-byte relocation audit above verifies completeness.
