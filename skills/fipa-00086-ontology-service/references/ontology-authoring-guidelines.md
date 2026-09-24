# Optional ontology authoring: Annex B

This is informative XC00086C Annex B guidance for authors creating a new ontology. It is not the §5.3 shared-ontology interaction protocol and does not establish service conformance.

## Authoring process

Start with purpose, intended users, use cases, formality, and scope. Build a glossary and classification, then state competency questions before formalization. Evaluate whether the formal vocabulary and axioms answer those questions before publication. Consider reuse/integration before implementation; maintain documentation and configuration records as the ontology changes.

Annex B's criteria are clarity/objectivity, completeness, coherence, maximal monotonic extendibility, minimal ontological commitment, and the ontological distinction principle. Treat them as design objectives that can conflict; do not claim a universal scoring threshold.

## Competency-question check

For a proposed `Fruit` ontology, ask: “Which citrus instances are fruit?” and “Does adding `Citrus` between `Fruit` and `Lemon`/`Orange` preserve the previous fruit inference?” Write the expected answers and counterexample before adding the class. Positive: the formalized ontology answers both. Negative: an undefined `Citrus` term or a changed inference blocks publication pending revision.
