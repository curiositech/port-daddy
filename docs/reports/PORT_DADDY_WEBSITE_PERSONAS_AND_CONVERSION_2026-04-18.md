# Port Daddy Website Personas And Conversion Analysis

Date: 2026-04-18
Scope: current `website-v2` public site, with emphasis on who we want to attract to install the product, fund a pilot, sponsor the work, or hire the builder
Methods used: product appeal analysis, UX friction analysis, route audit, current copy audit

## Executive Read

The site is already good at earning technical respect.

It is not yet equally good at telling the right visitor:

- this is for you
- this solves your problem now
- here is the next click you should take

The public site should optimize first for people with active multi-agent coordination pain, second for technical buyers who can justify a team rollout, and third for employers, partners, and sponsors who are judging the builder behind the product.

That means the site needs a sharper persona stack than "technical people who like infra."

## Strategic Rule

The site should sell three things, in this order:

1. Immediate relief from local multi-agent chaos
2. A credible path from local daemon to team control plane
3. Evidence that the builder has rare systems, product, and documentation taste

If a page is not helping at least one of those three outcomes, it is probably noise.

## Primary Targets

These are the six people the site should most aggressively help first.

1. Solo AI coding-agent operator
2. Multi-agent monorepo builder
3. Startup CTO running agent experiments
4. DevEx or platform engineer standardizing workflows
5. Security-minded evaluator reviewing trust boundaries
6. Hiring manager at a serious AI or infrastructure company

Why these six:

- they have the clearest pain or the clearest leverage
- they can install, approve a pilot, sponsor further work, or create career upside
- the current site is already closest to persuading them, so the conversion lift is realistic

## Desirability Calibration

Scores use the same three-part lens:

- `Identity`: does the site feel like it was made for this person
- `Urgency`: does the site make the pain feel immediate and concrete
- `Trust`: does the site look real, disciplined, and credible

Scores are out of `10`.

## Persona Library

### Tier 1: Install And Use The Product

These visitors have the shortest path from interest to actual usage.

| # | Persona | Why they come | Must-see proof | Best current route | Missing conversion surface | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Solo Claude Code operator | Their local repo is turning into terminal-tab chaos. Ports drift, context gets lost, and agents overwrite each other. | Concrete collision story, deterministic ports, `begin → note → done`, salvage | `/`, `/tutorials/getting-started` | A shorter install-first lane on the homepage | `9 / 9 / 8` |
| 2 | Cursor or Codex poly-agent builder | They are already running multiple coding tools in one repo and can feel the lack of shared state. | File claims, sessions, pub/sub, salvage | `/`, `/tutorials/multi-agent`, `/tutorials/getting-started` | A "running more than one agent?" audience rail near the hero | `9 / 8 / 8` |
| 3 | Startup CTO with agent prototypes | Their team is moving from novelty demos to repeated workflows and needs coordination before things get messy. | Local-first wedge plus believable team-control-plane path | `/docs`, `/whitepaper`, `/tutorials/fleet` | A direct "evaluate for a team" page with pilot framing | `8 / 8 / 8` |
| 4 | DevEx or platform engineer | They want one sane coordination layer instead of every engineer inventing their own scripts and ports. | Docs discipline, fleet YAML, repeatable workflows, operator surfaces | `/docs`, `/tutorials/fleet`, `/agents` | A cleaner rollout story for adopting Port Daddy inside a team | `8 / 8 / 9` |
| 5 | Security-minded infra engineer | They care less about convenience and more about whether the trust boundaries are honest. | Harbor boundary language, verification story, explicit live vs legacy semantics | `/whitepaper`, `/docs/features/harbors`, `/docs/features/arbiter` | A concise "security posture" page that translates proofs into operator value | `7 / 8 / 9` |
| 6 | Release or CI engineer experimenting with agents | They want bots to react to commits without creating invisible state or broken follow-through. | Fleet triggers, QA/documentarian/cartographer, salvage | `/agents`, `/tutorials/fleet` | A commit-to-outcome walkthrough with one believable workflow | `7 / 7 / 8` |
| 7 | Consultancy or AI agency owner | They need a repeatable coordination layer they can use across client projects without looking reckless. | Governance story, open-core honesty, team visibility path | `/tutorials/fleet`, `/docs`, `/roadmap` | A partner or consulting-facing page that says why clients should pay for this layer | `8 / 8 / 7` |
| 8 | OSS maintainer using contributor bots | They want automation without docs drift, review drift, or bot collisions. | Fleet starter agents, open-core credibility, docs parity discipline | `/agents`, `/tutorials/fleet`, `/blog` | A maintainer-focused case study or recipe | `7 / 6 / 8` |

### Tier 2: Pay For A Team Pilot Or Commercial Relationship

These visitors are less likely to install from raw curiosity, but they matter because they can turn technical interest into revenue.

| # | Persona | Why they come | Must-see proof | Best current route | Missing conversion surface | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | Engineering manager funding a productivity pilot | They need proof this reduces chaos, not just creates more tooling overhead. | One concrete before/after workflow with measurable pain removed | `/`, `/tutorials/getting-started`, `/docs` | A pilot-focused CTA and commercial page | `7 / 8 / 7` |
| 10 | VP Engineering evaluating team rollout | Agent use is happening informally already; they need a governance story before it spreads. | Serious shell, controlled route budget, control-plane framing | `/docs`, `/whitepaper`, `/roadmap` | A clear "why start a pilot this quarter" argument | `7 / 8 / 8` |
| 11 | Enterprise architect or platform buyer | They want to know where this fits in the stack and whether it grows into policy and audit. | Architecture narrative, daemon boundary, local-first wedge, team path | `/docs`, `/whitepaper` | A reference architecture or deployment-model page for buyers | `7 / 7 / 8` |
| 12 | Compliance or security lead under procurement pressure | They care about evidence, auditability, and key custody more than they care about clever demos. | Explicit live vs roadmap language, verification, future enterprise controls | `/whitepaper`, `/docs/features/harbors` | An audit-and-policy page that is business-readable | `6 / 8 / 8` |
| 13 | AI tooling founder evaluating partnership or embed | They may want Port Daddy as the coordination layer under their own product. | CLI, MCP, API quality, local-first composability | `/docs/api`, `/mcp`, `/docs` | A partnership story and "embed this layer" language | `8 / 7 / 8` |
| 14 | Technical OSS sponsor or serious patron | They want to back disciplined infrastructure work, not hype. | Honest roadmap, whitepaper, visible shipped depth | `/roadmap`, `/whitepaper`, GitHub link | A support or sponsorship narrative that explains what sustained funding unlocks | `6 / 4 / 9` |

### Tier 3: Hire, Partner With, Or Publicly Endorse The Builder

These visitors create career upside, collaborations, referrals, and reputation.

| # | Persona | Why they come | Must-see proof | Best current route | Missing conversion surface | Score |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | Hiring manager at a frontier AI company | They want evidence of systems thinking, technical rigor, and product taste in one body of work. | Real code-backed docs, formal verification story, honest limits | `/whitepaper`, `/docs`, `/roadmap` | A stronger founder or builder narrative that connects the work to leadership value | `8 / 6 / 9` |
| 16 | Staff or principal engineer interviewer | They are looking for architecture taste, constraint clarity, and operator empathy. | Explicit compatibility boundaries, local-first discipline, technical docs | `/docs`, `/whitepaper`, `/blog` | A "design decisions" path that highlights tradeoffs without marketing gloss | `8 / 6 / 9` |
| 17 | CTO or founder hiring a founding engineer | They want someone who can think in product, infrastructure, and delivery all at once. | A sharp homepage, a coherent docs system, and believable shipped depth | `/`, `/docs`, `/roadmap` | A routed builder or about page that makes "work with the builder" explicit instead of accidental | `8 / 6 / 8` |
| 18 | DevRel or technical content leader | They need proof the builder can make complex systems comprehensible. | Tutorials, docs structure, long-form explanations that stay grounded in code | `/tutorials`, `/docs`, `/blog` | A curated "best technical writing" entry point | `7 / 5 / 8` |
| 19 | Open-source maintainer or ecosystem partner | They may want interoperability, co-marketing, or shared protocol work. | Open-core clarity, docs truthfulness, non-hype technical style | `/docs`, `/mcp`, GitHub link | A partner or ecosystem page with clear collaboration hooks | `7 / 5 / 8` |
| 20 | Conference organizer, podcast host, or workshop buyer | They want a concrete story that demos well and teaches something real. | A vivid narrative: agent collisions, control plane, salvage, security boundary | `/tutorials/fleet`, `/blog`, `/whitepaper` | A talks, workshop, or demo request surface | `6 / 4 / 8` |

## What The Current Site Appeals To Best

The current site overperforms with:

- staff-plus engineers
- security-conscious technical evaluators
- infra-minded peers
- hiring managers who value rigor and discipline

Why:

- the shell looks like real software
- the docs budget is not cartoonishly bloated
- technical claims feel specific instead of sloganized
- route names are mostly concrete

## What The Current Site Underserves

The site still underserves:

- managers who need a pilot story
- consultants and agencies who need a client story
- sponsors who want a public "why this matters" explanation
- employers who are not going to reverse-engineer the founder value from technical docs alone

Why:

- commercial value is still implied more than stated
- there is not yet a clean "what happens after local success" page
- some routes still carry internal or operator-cleanup energy instead of buyer energy
- the site lacks an explicit collaboration, consulting, sponsorship, or hiring pathway

## Product Appeal Analysis

### What makes people want this

The strongest emotional hooks in the current product story are:

1. "My agents keep stepping on each other"
2. "I need one daemon of record instead of invisible shell state"
3. "I want real coordination primitives, not another vague AI wrapper"
4. "I trust builders who state their limits plainly"

That means Port Daddy wins when it sounds like:

- a control plane
- a coordination daemon
- an operator tool
- a serious local-first wedge into a larger problem

It loses when it sounds like:

- a fake hosted dashboard
- a mascot-led novelty devtool
- a self-referential internal cleanup project
- a speculative product story that outruns the current runtime

### Current appeal strengths

- The core category is legible: this is about agent coordination, not generic AI.
- The site has more technical credibility than most AI tooling marketing pages.
- The local-first story feels defensible instead of hand-wavy.
- The verification and protocol material creates unusual trust.

### Current appeal gaps

- The homepage still speaks better to peers than to buyers.
- The site does not yet have a clean commercial wedge for teams.
- The builder value is visible indirectly, but not intentionally packaged for hiring or sponsorship.
- The strongest proof remains abstract unless paired with a real operator artifact or honest workflow walkthrough.

## UX Friction Analysis

### Highest-friction moments

1. The site still asks visitors to infer their lane.
   - A solo builder, a VP Engineering buyer, and a hiring manager are all reading the same general-purpose shell.
   - That means identity fit is weaker than it should be.

2. The public-vs-local boundary has been confusing.
   - Any route that looks like a live hosted dashboard creates category damage if it is not truly live.
   - This is especially toxic for security-minded or platform-minded visitors.

3. Tutorial presentation has not always matched the seriousness of the shell.
   - Narrow layouts, inconsistent rhythm, and contrast failures make the product feel less mature than the underlying technical work.

4. The commercial story lacks a destination.
   - The site hints at open core, team control plane, and enterprise controls.
   - It does not yet provide a direct page for "how do I evaluate or buy this."

5. Hiring, consulting, and sponsorship intent are not intentionally captured.
   - People who like the work can admire it, but the next action is often implicit instead of explicit.

### Friction by persona class

| Persona class | Main friction | Effect |
| --- | --- | --- |
| Install-now users | Too many possible routes before value | slows install and tutorial starts |
| Buyers | No crisp pilot page or commercial CTA | curiosity does not turn into evaluation |
| Security evaluators | Any fake-looking runtime surface harms trust | skepticism spikes immediately |
| Employers | Builder credibility is inferable but scattered | they have to do work to connect the dots |
| Sponsors and partners | No explicit support or collaboration lane | goodwill has nowhere to land |

## Anti-Personas

These people may still visit, but the site should not optimize around them first.

1. Generic AI hype tourists
2. People expecting a fully hosted SaaS control plane today
3. Non-technical mass-market consumers
4. Visitors who mainly want mascot energy or whimsy
5. Whitepaper tourists who care more about grand theory than operational reality

## What Each Main Route Should Primarily Serve

| Route | Best-fit personas | Why it matters |
| --- | --- | --- |
| `/` | 1, 2, 3, 4, 9, 15 | homepage must convert pain into action fast |
| `/tutorials/getting-started` | 1, 2, 6 | shortest path from curiosity to installation confidence |
| `/tutorials/fleet` | 3, 4, 6, 7, 20 | shows automation, leverage, and operational shape |
| `/docs` | 3, 4, 5, 10, 11, 13, 16 | trust and evaluation surface |
| `/whitepaper` | 5, 10, 11, 12, 15, 16 | security and rigor proof |
| `/agents` | 6, 7, 8, 20 | "what can this do for me in practice" |
| `/roadmap` | 10, 11, 14, 15, 19 | seriousness, ambition, and forward path |
| `missing: builder/about route` | 15, 17, 18 | site currently lacks a clean builder-credibility destination |

## Highest-Leverage Site Changes

### Immediate

1. Add a persona rail near the hero.
   - Suggested cards:
   - `Stop local agent collisions`
   - `Evaluate for a team`
   - `Review the security model`
   - `See who built this`

2. Make the install path the shortest, clearest action.
   - Fewer clicks from homepage to first command
   - Fewer competing narratives above the first command

3. Finish removing public runtime fiction.
   - No fake dashboard language
   - No hosted view pretending to be a real local control plane

4. Add one real operator artifact.
   - truthful screenshot
   - truthful timeline excerpt
   - truthful salvage or file-claim example

### Near-Term

5. Create a commercial evaluation page.
   - local daemon today
   - team control plane next
   - policy and audit value for serious orgs

6. Create a work-with-the-builder page or section.
   - for hiring
   - for consulting or implementation help
   - for talks or workshops

7. Create a support or sponsorship path.
   - who should fund this
   - what sustained support unlocks

### Structural

8. Keep the route budget disciplined.
   - add routes only when they close a real conversion gap for one of the target personas

9. Keep terminology concrete.
   - collisions
   - claims
   - salvage
   - evidence
   - policy
   - control plane

10. Do not let public copy drift into internal cleanup monologue.
   - visitors do not care that the site is being normalized
   - they care whether the product solves their problem

## Backlog Checklist

- [x] Define a 20-persona library grounded in the current site
- [x] Separate install, buyer, sponsor, and hiring audiences instead of treating them as one blob
- [x] Identify which existing routes already serve which personas
- [x] Identify missing conversion surfaces
- [ ] Add persona rails to the homepage
- [ ] Add a commercial evaluation path
- [ ] Add a builder, hiring, consulting, or workshop path
- [ ] Add a sponsor or support path
- [ ] Pair the strongest claims with one real operator artifact

## Bottom Line

Port Daddy does not need more generic traffic.

It needs more of the right visitors:

- people who are already feeling local multi-agent pain
- people who can greenlight a serious pilot
- people who can recognize and reward the builder's technical taste

The current site is close on trust.
The next win is sharper audience recognition and clearer next actions.
