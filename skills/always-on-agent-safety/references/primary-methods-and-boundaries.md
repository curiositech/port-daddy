# Primary methods and evidence boundaries

Access depths below match the dedicated source review dated 2026-09-24. These papers support methods and scoped empirical findings; they do not certify this skill's examples, a current vendor product, legal compliance, or a deployment.

## Budget rights and uncertain completion

- Balegas et al., “Extending Eventually Consistent Cloud Databases for Enforcing Numeric Invariants,” SRDS 2015, [arXiv v1](https://arxiv.org/abs/1503.09052v1) and [full proceedings PDF](https://asc.di.fct.unl.pt/~nmp/pubs/srds-2015.pdf). **Read:** §§I–V, including system model, bounded-counter invariant, local-rights operations, and evaluation. The method partitions rights so a replica can update a bounded counter only within its allocated rights under that paper's eventual-consistency model and assumptions. Its Riak prototype is not a provider billing implementation.
- O’Neil, “The Escrow Transactional Method,” ACM TODS 11(4), 405–430 (1986), [DOI record](https://doi.org/10.1145/7239.7265), [author PDF](https://cs.umb.edu/~poneil/EscrowTM.pdf). **Read:** abstract, transaction architecture, and distributed example. Escrow reserves rights before operations so concurrent work can preserve a declared numeric invariant. Applying this to agent spend is a design analogy, not a demonstrated LLM billing control.

The local example uses integer micro-units, explicit period and rate-policy revisions, one operation identity, reservation before submission, and a held reserve for ambiguous outcomes. It models atomicity synchronously in one JavaScript process; production multi-process safety requires an appropriate transactional/conditional-write store and a separate operational test. Local reservations cannot cap an external provider invoice or account usage outside the adapter.

## Untrusted data, tool authority, and persistent memory

- Debenedetti et al., “Defeating Prompt Injections by Design,” [arXiv v2 HTML](https://arxiv.org/html/2503.18813v2) (2025-06-24). **Read:** §§2–6, non-goals, capability/interpreter design, evaluation, overhead, and discussion. CaMeL separates privileged planning from untrusted-data parsing, propagates source/reader capabilities, and checks policy at tool calls. Its stated threat model assumes trusted user queries and uncompromised memory; it does not prove arbitrary misinformation/phishing resistance or solve a poisoned durable-write path. Its benchmark results are scoped to the evaluated AgentDojo tasks.
- Dong et al., “Memory Injection Attacks on LLM Agents via Query-Only Interaction,” NeurIPS 2025, [official proceedings PDF](https://papers.nips.cc/paper_files/paper/2025/file/42a97bbd9844d2bf68596730af80bcdf-Paper-Conference.pdf). **Read:** main threat model, attack, experiments/defenses/limitations, and impact statement plus appendices. MINJA demonstrates query-only poisoning under its specified shared-memory/retrieval setup and attacker constraints. Results are not a general probability for all agent memories; defenses proposed are not individually shown sufficient here.

Use these sources to motivate threat tests, not categorical claims that all injections persist or cascade. Test separately: untrusted input without durable write, durable write without later retrieval, retrieval without effect, cross-tenant access, and attempted unauthorized tool effects.

## Deletion, lineage, and learned influence

- Schlegel & Sattler, “Capturing End-to-End Provenance for Machine Learning Pipelines,” Information Systems 132 (2025), article 102495, [full author/institution-hosted paper](https://www.db-thueringen.de/servlets/MCRFileNodeServlet/dbt_derivate_00068998/0306-4379_132_2025_102495.pdf). **Read:** methods §§2–4, Git/MLflow creation/change/deletion submodels, provenance queries, example, and evaluation. MLflow2PROV captures lineage across specified ML pipeline entities and artifacts. Adapting provenance graphs to episodic-memory derivatives is a proposed method; logging a delete event is not proof all copies were erased.
- Guo et al., “Certified Data Removal from Machine Learning Models,” ICML 2020, [PMLR paper and PDF](https://proceedings.mlr.press/v119/guo20c.html). **Read:** full 11-page paper, definition, algorithm, assumptions, experiments, and discussion. The certified-removal result applies to its specified model/classifier setting; it is not general-purpose deletion or unlearning for arbitrary foundation models.

Deletion claims should name source records and derivatives, query declared stores, and test caches/restores. Keep unqueryable copies `unknown` or under a separately authorized restricted hold. Do not infer global deletion from a single row or a lineage receipt.

## Interaction-style evidence

- Xu, Dai & Yan, “Identity Disclosure and Anthropomorphism in Voice Chatbot Design: A Field Experiment,” Management Science 72(1), 223–241 (2026 issue), [publisher record](https://pubsonline.informs.org/doi/10.1287/mnsc.2022.03833). **Read:** publisher metadata, full abstract, and available design/context description; full methods and appendix were not available in the reviewed view. The abstract describes an 11,000-driver logistics-dispatch voice-chatbot field experiment. This context-specific result is not evidence about companionship, dependency, clinical outcomes, children, older adults, or other target populations.

Names, voice/persona, first/third-person language, disclosure and persistence are hypotheses for context-specific study, not proven protective or harmful treatments. Do not generalize across populations or infer diagnoses.

## Risk-management framing

NIST, *Artificial Intelligence Risk Management Framework (AI RMF 1.0)*, [official publication record](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10), January 2023. **Accessed:** 2026-09-24. **Read:** official landing page and framework identity only. It supports risk-management framing; it was not opened as a source for clinical, legal, youth-safety, vendor, price, incident, or local implementation claims.
