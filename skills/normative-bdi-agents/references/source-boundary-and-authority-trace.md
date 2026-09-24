# Norm provenance is not ethical or runtime authority

Tufiș and Ganascia, “Grafting Norms onto the BDI Agent Model” (2015), DOI [10.1007/978-3-319-21548-8_7](https://link.springer.com/chapter/10.1007/978-3-319-21548-8_7), was read at §§7.2–7.7 depth on 2026-09-24 from an author-hosted full text; publisher metadata was cross-checked. Its model addresses norm instantiation/internalization and conflict. It is not proof of legal compliance, ethical correctness, or authority to cause an external effect. “A Normative Extension for the BDI Agent Model” is distinct 2014 CLAWAR work (metadata only here); the 2012 RDA2 paper is also distinct.

```mermaid
flowchart TD
  A[Norm claim] --> B{Issuer, scope, time, bindings verified?}
  B -->|No| C[Candidate only; abstain or recheck]
  B -->|Yes| D[Evaluate under declared local policy]
  D --> E{Conflict/incomparability?}
  E -->|Yes| F[Preserve alternatives and escalate]
  E -->|No| G[Propose deliberative constraint]
```

```mermaid
flowchart LR
  A[Recognized norm] --> B[Applicable instance]
  B --> C[Internalization decision]
  C --> D[Plan proposal]
  D --> E[Independent authorization]
  E --> F[Effect or refusal receipt]
```

The source's BDI extension informs a model of deliberation. Each authority edge above is a local requirement that must be independently verified.

Source bodies supporting the model: [2012 RDA2 paper, printed pp. 37–43](https://ceur-ws.org/Vol-885/paper6.pdf) and [author-uploaded 2015 chapter, §§7.2–7.7](https://www.researchgate.net/publication/286854510_Grafting_Norms_onto_the_BDI_Agent_Model). The exact executable interfaces in this bundle are local worked completions, not copied source implementations. The source model's acquisition and coherence limitations remain open; its fictional scenario is not an empirical ethical validation.
