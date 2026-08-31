# Harbor Architect Baseline Ambition Archaeology

Status: active work packet for the Harbor Architect of Record.

## Mission

Read the Agent Harbor binder and the broad Port Daddy ambition corpus. Produce
consistency proposals that say what the binder is missing, what it contradicts,
what it has absorbed, and what should be explicitly rejected or deferred.

This is not a reaction memo. It is the baseline archaeology pass that lets the
Architect of Record own binder truth.

## Solely responsible concern

Own this question:

> Does the Agent Harbor binder preserve, supersede, or intentionally reject the
> major ambitions Port Daddy has ever claimed in docs, website pages, examples,
> tutorials, whitepapers, V4 plans, recovery maps, and design artifacts?

## Required reading

Read these first:

- `docs/architecture/agent-harbor-technical-binder/README.md`
- `docs/architecture/agent-harbor-technical-binder/01-product-and-surfaces.md`
- `docs/architecture/agent-harbor-technical-binder/02-runtime-authority-and-deployment.md`
- `docs/architecture/agent-harbor-technical-binder/03-agent-contract-and-extension-api.md`
- `docs/architecture/agent-harbor-technical-binder/04-context-memory-and-skills.md`
- `docs/architecture/agent-harbor-technical-binder/05-cooperative-coding-and-governance.md`
- `docs/architecture/agent-harbor-technical-binder/06-security-privacy-billing-and-accounts.md`
- `docs/architecture/agent-harbor-technical-binder/07-milestones-and-work-dag.md`
- `docs/architecture/agent-harbor-technical-binder/08-adversarial-review.md`
- `docs/architecture/agent-harbor-technical-binder/09-data-model-and-api.md`
- `docs/architecture/agent-harbor-technical-binder/10-operator-control-panel.md`
- `docs/architecture/agent-harbor-technical-binder/11-redteam-whitehat-cross-lens-review.md`
- `docs/architecture/agent-harbor-technical-binder/12-agent-work-chains-and-second-pass-review.md`
- `docs/architecture/agent-harbor-technical-binder/13-platform-plays-and-runtime-surface-review.md`
- `docs/architecture/agent-harbor-technical-binder/14-work-intake-and-node-shaping.md`
- `docs/architecture/agent-harbor-technical-binder/15-recursive-critical-synthesis.md`
- `docs/architecture/agent-harbor-technical-binder/16-binder-architect-of-record.md`
- `docs/proposals/official-port-daddy-agent-compliance-plan.md` — authored on `codex/gpui-harness-mux`; will land with that branch (not yet shipped on main)

Then read the ambition corpus:

- `docs/proposals/articles-of-agreement-harness-roadmap.md`
- `docs/plans/V4-MASTER-PLAN.md`
- `docs/plans/V4-MARKETING-MONETIZATION.md`
- `docs/plans/PHONE-INTEGRATION-MASTER-PLAN.md`
- `docs/V4-RECOVERY-MAP.md`
- `docs/IDEAS_INDEX.md`
- `docs/recovery/IDEAS-TROVE.md`
- `docs/manifesto-why-agent-economies.md`
- `docs/talk/index.html`
- `docs/strategy/harbor-editor-battle-plan.md`
- `docs/design/operator-console-implementation-roadmap.md`
- `docs/design/fleetbar-mockups/VISION-OPERATOR-TUI.md`
- `docs/design/fleetbar-mockups/operator-console-v11-SPEC.md`
- `docs/shipwright/AGENT-MODEL.md`
- `docs/shipwright/UTOPIAN-VISION.md`
- `docs/shipwright/SHIPWRIGHT-DAEMON.md`
- `docs/shipwright/SHIP-GRAMMAR.md`
- `whitepaper/research/program/archive/north-star/README.md`
- `whitepaper/research/program/archive/north-star/00-INTRODUCTION.md`
- `whitepaper/research/program/archive/north-star/00-HARBOR-VOLUME-ARCHITECTURE.md`
- `whitepaper/research/program/archive/north-star/00-HARBOR-LIBRARY.md`
- `whitepaper/research/program/archive/north-star/00-THE-FOUR-PAPERS.md`
- `whitepaper/research/program/archive/north-star/agent-economy-anchor.md`
- `whitepaper/research/program/archive/north-star/legibility-leviathan.md`
- `whitepaper/research/program/archive/north-star/tokens-compaction.md`
- `website-v2/src/data/product.ts`
- `website-v2/src/data/examples.ts`
- `website-v2/src/data/tutorials.ts`
- `website-v2/src/data/blogData.ts`
- `website-v2/src/data/whitePapers.ts`
- `website-v2/src/pages/HarnessPage.tsx`
- `website-v2/src/pages/AgentsPage.tsx`
- `website-v2/src/pages/MacPreviewPage.tsx`
- `website-v2/src/pages/ManifestoPage.tsx`
- `examples/README.md`
- all direct child `README.md` files under `examples/`

If time is limited, prioritize documents that contain product promises, user
workflows, pricing, security/trust claims, or named platform surfaces.

## Output file

Write proposals to:

`docs/architecture/agent-harbor-technical-binder/17-ambition-archaeology-consistency-proposals.md`

Do not edit product code. Do not rewrite other binder chapters yet. This pass
creates proposals and a classification ledger.

## Classification taxonomy

For each ambition family, assign one:

- `absorbed`: the binder covers it with term, owner, gate, and milestone.
- `superseded`: the binder replaced it; explain why the old path is no longer
  canon.
- `deferred`: still desired, but behind named prerequisites.
- `contradicted`: binder and ambition corpus disagree.
- `orphaned`: meaningful ambition exists, but the binder has no home for it.
- `rejected`: intentionally out of scope; explain why.

## Required proposal sections

The output file must include:

1. **Executive Verdict**
   - Is the binder currently complete enough to guide implementation?
   - What are the top five blindspots?

2. **Ambition Classification Table**
   - At least 30 ambition families.
   - Source files and line anchors where possible.
   - Classification and proposed binder destination.

3. **Contradiction Register**
   - Cross-document contradictions that would mislead implementation.
   - Severity: blocker, major, minor.
   - Proposed resolution.

4. **Missing Chapter Or Section Proposals**
   - Sections to add to existing chapters.
   - New chapters only if truly necessary.
   - Include why each change matters to operators or customers.

5. **Customer Blindspots**
   - Solo local, solo BYOK, Pro sync, team harbor, enterprise/self-hosted,
     OSS/custom-agent developer, privacy-sensitive, mobile operator,
     remote/cloud operator, marketplace participant.

6. **Technical Blindspots**
   - Agent compliance, transcripts, context/memory, skills, MCP/custom agents,
     mobile, relay/cloud, event sourcing, Work Receipts, Harbor Economy,
     performance, cross-platform, packaging, security, privacy, billing,
     operator UI, examples/tutorials, website promises.

7. **Decision Requests For Operator**
   - Product forks an agent cannot decide.
   - Phrase each as a clear decision with tradeoffs.

8. **Implementation Gate Changes**
   - Proof gates that must be added before implementation chains can claim
     readiness.

9. **Binder Patch Plan**
   - A proposed ordered patch sequence. Keep it practical.

10. **Mandatory Ledger Entry**
    - End with the exact `pd note "binder-aor-log: ..."` text that was written.

## Standing constraints

- Prefer exact source citations over impressionistic synthesis.
- Do not preserve old ambitions merely because they are old.
- Do not erase big ambitions merely because they are hard.
- Distinguish product vision, technical architecture, marketing promise, and
  implementation claim.
- Mark uncertainty honestly.
- If a source is huge, sample it and say which portions were read.

## First seed blindspots

Start by testing these, but do not stop here:

- Harbor Economy / Trust-as-a-Service.
- Reactive Coordination Kernel performance promises.
- Anchor Protocol, FloatPlans, escrow, settlement, and bilateral receipts.
- Lighthouse relay, remote GPU, and account tiers.
- Phone as operator surface.
- Publisher SDKs: VS Code, test reporters, browser buttons, webhooks, editor
  lightbulbs.
- Examples as product promises.
- FleetBar and Fleet Control Center versus pd-console authority.
- Shipwright as the arbitrary-repo business wedge.
- Spark/Spider/Cartographer ideation and contradiction loop.
- Skills parliament and skill quality governance.
- Governance coordination hub and auto-remediation.
- Cost-aware model routing and learning from operator decisions.
- Semantic graph, claim tree, graph-centric watches, and synonym registry.
- Worktree reaper and lifecycle hygiene.
- Cross-platform and Windows IPC hardening.
- Open-core packaging, signed app, account creation, self-hosted relay, and SSO.
- The manifesto-level claim about institutions for agent economies.
