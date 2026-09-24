# B05 research: protocols, markets, and MAS foundations

Accessed 2026-09-24. Full active SKILL.md files were read, with targeted references noted. Research handoff only; no execution/tests. Internal evidence means repository model/code, not independent validation. Novelty remains pending Book comparison.

## harbor-results
Read active skill, results-compendium.md, l3-tacit-lessons.md, sheaf_mechanism_proof.py, a3_epsilon_ledger.py, sheaf_repair_and_2complex.py. Compendium labels verified vs internal and names seed 20260816. These are primary artifacts for bounded models, not product evidence. C6 mechanism illustrates cycle-vs-cut. Ledger assumes atomic single-writer commits and says complete mediation is external. CR-4 "optimal/minimum-cost" and "<= beta1 rounds" exceed its evidence: the script asserts one 12-node beta1=1 fixture and one cheap bridge; it permits up to |E| rounds. This is missing general proof, not a counterexample. CR-5 synthetic endpoints do not establish a field classifier.
Improve "The Seventeen", CR-4/CR-5 and scripts section with claim/assumptions/artifact/evidence class/boundary. Positive example: relayed but un-compared edge on C6 may leave residual; cut edge cannot; severed evidence remains dark. Scope CR-4 to fixture pending proof/adversarial cost graphs. Do not promote bounded checks to product.
Diagrams: evidence ladder (derivation, bounded model, seeded run, mutation witness, implementation refinement, deployment); R6 compared/relayed/severed topology. No relevant ASCII.
Book candidate: claim-to-evidence boundary table; compare existing proof/product-truth treatment before novelty claim.

## bellifemine-2007-jade-fipa
Sources: Bellifemine et al., Developing Multi-Agent Systems with JADE, Wiley 2007 record https://onlinelibrary.wiley.com/doi/book/10.1002/9780470058411 (book not accessed); JADE v4.6 API maps its management ontology to FIPA spec 23 version H, 2001-08-15: https://jade.tilab.com/doc/api/jade/domain/FIPAAgentManagement/package-summary.html. FIPA endpoints unavailable; JADE is implementation evidence.
Improve protocol selection and arbitrary time/resource/Byzantine thresholds. Remove 5/30s, 500 concepts, 100ms, queue-size rules; unsupported. Timeout is not proof of peer death/malice. Worked rule: freeze CFP reply-by; collect propose/refuse; accept/reject; wait for inform/failure or a timeout outcome.
Diagrams: CFP protocol state machine; FIPA contract vs JADE callback vs app policy. Convert ASCII decision tree.
Book candidate: standard communicative act to JADE callback mapping; check existing implementation coverage.

## bordini-hubner-2007-jason
Sources: Bordini et al., Programming Multi-Agent Systems in AgentSpeak using Jason, Wiley record https://onlinelibrary.wiley.com/doi/abs/10.1002/9780470061848; Jason official https://jason-lang.github.io/ and https://github.com/jason-lang/jason.
Improve numeric failure cutoffs and plan-selection tree. Replace >3 branches/repeats and depth >10 with task-specific observations. Catch-all plans can mask missing beliefs. Example: update belief from obstacle perception; select recovery only when context holds, else stop/escalate.
Diagrams: Jason event/options/deliberation/intention/action cycle; intention success/failure/recovery/unmatched state machine. Terra should verify current diagrams render.
Book candidate: operational semantics versus runtime extensions, if current manuscript stays abstract.

## agent-conversation-protocols
Sources: FIPA XC00025D primary body inaccessible; CiteSeer mirror timed out. A2A immutable v1.0 spec https://a2a-protocol.org/v1.0.0/specification/ and normative proto https://github.com/a2aproject/A2A/blob/v1.0.0/specification/a2a.proto. MCP versioned details https://modelcontextprotocol.io/specification/2026-07-28/changelog.
Improve: local trace schema is not wire compliance. Preserve freeze-membership/epoch/reducer rules. Worked example: three-review gather freezes participants before replies; one missing leaves BLOCKED; CANCELLED does not establish remote process stopped.
Diagrams: terminal fence (COMPLETE/BLOCKED/CANCELLED); causal DAG versus replay tie-break. No ASCII.
Book candidate: separate delivery, semantic completion, lifecycle, external effect.

## agent-discovery-directories-guilds
Sources: FIPA SC00023K unavailable; JADE maps older version H. A2A community discovery guide https://agent2agent.info/specification/discovery/ says card standardized, discovery diverse/open; not normative. Official A2A v1 data model https://a2a-protocol.org/v1.0.0/specification/. DNS-SD RFC6763 https://www.rfc-editor.org/rfc/rfc6763.
Improve claim that FIPA mandates singleton yellow-pages agent/that DF federation is guaranteed. A logical DF does not imply deployment topology. A2A standardizes card, not registry. Rule: retrieve card, authenticate/authorize, validate expiry/version, filter capability, perform task-level verification.
Diagrams: discovery trust gates; central/federated/DHT topology tradeoffs. Convert ASCII and remove unsupported scale cutoffs.
Book candidate: advertised capability is not attestation; compare existing trust chapter.

## agent-interchange-formats
Sources: A2A v1 proto above; MCP 2026-07-28 versioned overview https://modelcontextprotocol.io/specification/2026-07-28 and JSON-RPC 2.0 https://www.jsonrpc.org/specification.
Improve universal claim "JSON-RPC wire standard; A2A for multi-agent" and fixed envelope requirements. A2A handles agent tasks/messages; MCP host-client-server tools/context. MCP 2026-07-28 removes initialize/session IDs, uses per-request metadata; Tasks is opt-in extension draft, not core. A2A task IDs are server-generated. Rule: MCP host-to-tool, A2A remote agent delegation; explicit bridge maps auth/data.
Diagrams: MCP vs A2A roles; schema/proto to generated binding to runtime validation provenance. Convert selection ASCII.
Book candidate: versioned boundary matrix is volatile; likely web appendix.

## fipa-00037-communicative-act-library
Sources: accessible archived FIPA XC00037H full PDF https://jmvidal.cse.sc.edu/library/XC00037H.pdf (2000/H, not J); canonical J endpoint 403 https://www.fipa.org/specs/fipa00037/SC00037J.html. H says unambiguous conformance testing is unsolved.
Improve invented inform confidence <0.8 threshold and inform-if advice. Communicative semantics do not verify world truth; agree is commitment to try, not completion. Worked trace request -> agree/refuse -> inform-done/failure; verify consequential effect separately.
Diagrams: communicative act vs external truth layers; request lifecycle with failure/refusal/not-understood. Convert ASCII and version-pin H/J.
Book candidate: acts do not prove external effect; compare authority chapter.

## fipa-00086-ontology-service
Sources: XC00086D bibliographic title/date metadata https://ko.cuni.cz/node/2312.html (2000; revision 2001-08-15), not primary body. Canonical FIPA page/PDF unavailable; source validation incomplete. JADE management ontology is not substitute.
Improve centralized Ontology Agent/OKBC-as-standard and unsupported +/-2C, +/-5km/h promises. Treat mediator as an option. Specify mapping version/direction/loss and competency tests. Example 68F converts to 20C; "comfortable" still needs shared task threshold.
Diagrams: syntax/conceptualization/task-valid inference; source vocab -> versioned map -> mediator -> consumer validation with lossy/unknown branch. Convert ASCII, flag source gap.
Book candidate: task-relative mapping adequacy, contingent on full primary spec access.

## hong-et-al-2024-metagpt
Sources: Hong et al., MetaGPT: Meta Programming for A Multi-Agent Collaborative Framework, arXiv v7 2024-11-01 https://arxiv.org/abs/2308.00352v7; abstract/body access page opened; ICLR 2024; author code https://github.com/geekan/MetaGPT.
Improve agent-count/confidence thresholds and claim unsupported text is automatically regenerated. Paper tests SOP/role design on selected setup, not universal hallucination reduction. Bind feedback to an independent oracle/artifact. Example: QA runs generated test and records output; untested claim stays unresolved.
Diagrams: requirements/design/tasks/code/tests role pipeline; test failure to bounded repair with verifier separated. Replace generic mindmap with trace.
Book candidate: role-separated evidence pipeline; compare software lifecycle chapter.

## wu-2023-autogen
Sources: Wu et al., AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation, arXiv v2 2023-10-03 https://arxiv.org/abs/2308.08155v2; abstract/body access page opened.
Improve central-orchestrator/human-as-special-case sections and API examples. Paper is design precedent, not current API docs or proof of superiority. Compare topologies with equal budget/tools and independent oracle. Same model/premise is not independent corroboration.
Diagrams: routed topology with actors/termination; computation vs control/authority. Replace mindmap with trace.
Book candidate: common-mode evaluator independence; compare debate chapter.

## agent-labor-pricing-function
Sources: Xia & Muthukrishnan, Revenue-Maximizing Stable Pricing in Online Labor Markets, HCOMP 2017 DOI https://doi.org/10.1609/hcomp.v5i1.13299 and AAAI PDF https://cdn.aaai.org/ojs/13299/13299-64-16816-1-2-20201228.pdf; mechanism claims depend on paper model/maximum task price h. Liu et al., truthful team formation, ICC 2015 https://arxiv.org/abs/1812.04865. Myerson 1981 publisher abstract https://pubsonline.informs.org/doi/fpi/10.1287/moor.6.1.58 is seller/single-object/private buyers, not labor procurement. Stripe current standard US domestic online card rate 2.9%+30c https://stripe.com/pricing; scope by processor/method/geography.
Improve generic truthfulness and margin bands (40-60%,70-80%) and competitor incident assertions. State private types, market sides, objective, feasibility, IR, budget, stability and proof first. Single operator may need budget/caps rather than auction.
Diagrams: private types to allocation/payment to IR/truthfulness/stability/budget checks; buyer value/provider/tool/fees/risk ledgers. Convert decision ASCII after assumptions.
Book candidate: counterexample when quality dimensions/budgets break single-parameter truthfulness; compare mechanism-design chapter.

## context-economics-for-agent-swarms
Sources: Liu et al., Lost in the Middle, TACL 2024/arXiv 2307.03172 https://arxiv.org/abs/2307.03172 supports tested position effects, not universal degradation. Anthropic 2025 context engineering https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents is practitioner guidance. Bundled provider capacity ledger pins sources but requires current recheck. MCP current https://modelcontextprotocol.io/specification/2026-07-28.
Improve "tokens are the only way a human sees" work, fixed tool/token budgets, and n-squared attention as causal proof of context rot. Artifacts/UIs are also access; complexity alone does not prove accuracy decline. Example: move same evidence across positions, fixed model/task; compare accuracy against artifact lookup.
Diagrams: cash/native capacity/working context/evidence distinct ledgers; transcript to artifact pointer to overlay summary to zoom-back/verifier. Convert ASCII and label budgets heuristics.
Book candidate: subscription-native capacity and uncertainty reserves; compare resource accounting chapter.

## ASCII inventory and source limits
ASCII branching trees in JADE, Jason, discovery, interchange, FIPA acts, ontology, MetaGPT/AutoGen, pricing, context. Convert real branching only; retain tables as tables; omit unsupported thresholds.
FIPA SC00023K, SC00029H, SC00037J, XC00086D endpoints returned 403/internal errors. XC00037H is accessible older version. Smith 1980 Contract Net is not later FIPA protocol. XC00025D timed out. A2A v1.0.0 proto is normative; agent2agent.info is community guidance. MCP 2026-07-28 is official current version as of access date; Tasks draft is opt-in extension, not core. Recheck changing standards/prices at integration.

## Version-pinned protocol corrections
MCP's released 2026-07-28 changelog, heading “Major changes” (https://modelcontextprotocol.io/specification/2026-07-28/changelog), says the core is stateless, removes initialize and session headers, carries version/capability metadata per request, adds `server/discover` and MRTR, and moves Tasks outside core into an extension. On a broken stream, a client reissues with a new JSON-RPC request ID. Therefore transport request IDs must not be used as durable business-operation idempotency keys: a retried request has a different transport ID and may still repeat an external effect unless the application separately deduplicates it. The overview's sentence about extensions being negotiated during initialization is inconsistent with the versioned stateless design; prefer the changelog and matching versioned normative schema, and call out the editorial mismatch.

A2A is pinned to stable v1.0.0, §3.3.1 “Idempotency” and §3.4.2 “Task Identifier Semantics” (https://a2a-protocol.org/v1.0.0/specification/). Send Message MAY be idempotent and an implementation MAY use `messageId` for duplicate detection; Cancel Task is idempotent, though a duplicate after cancellation/purge may return task-not-found. This does not promise exactly-once external business effects or define a universal idempotency-key contract. New `taskId` values are server-generated; `contextId` can be client-provided. Keep these distinct in examples and generated wrappers.
