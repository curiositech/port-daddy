# agentsd.ai Public Shell Audit

Date: 2026-04-11
Scope: reduced-shell redesign pass inside `website-v2`, centered on the landing/docs primitives rather than the full current route inventory
Methods used: WCAG contrast audit, 5-second test, UX friction analysis, product appeal analysis

This audit is grounded in the landing/docs redesign work checked into [`website-v2/src/main.tsx`](/Users/erichowens/coding/port-daddy/website-v2/src/main.tsx) and related shell primitives, not in every currently routed legacy/tutorial/marketing surface.

## Executive Read

The shell is now strong on trust and seriousness for technical audiences. It is weaker on urgency and buyer self-recognition than it is on credibility.

What works:

- The site now feels like infrastructure, not a side project.
- The docs route budget is disciplined enough to feel trustworthy.
- Architecture and verification sections create real technical confidence.

What still drags:

- The homepage still speaks more fluently to infra-minded peers than to buyers with messy day-to-day operator pain.
- The monetization section is structurally clear but still abstract.
- Non-technical friends, family, and general employers will understand that it is serious software, but not always why they should care.

## Immediate WCAG Findings

### Fixed in this pass

The dark-mode complaints were valid.

Previous failing combinations in the live shell:

- White on dark-mode brand blue `#7db4ff`: about `2.13:1`
- White on lime `#dfff00`: about `1.14:1`
- White-tinted subtext on dark-mode blue cards: about `1.06:1` to `1.64:1`

These failed WCAG AA for normal text by a wide margin.

This pass fixed the issue at the token/component level:

- Added explicit foreground tokens for blue and lime brand surfaces
- Moved terminal-style panels onto dedicated code tokens instead of theme-inverting them
- Fixed accent-backed controls and navigation so dark mode uses dark ink on bright lime
- Replaced status wording that looked like calls to action with state labels

Current target ratios after the patch:

- Blue surface primary text:
  - light theme: `5.25:1`
  - dark theme: `8.78:1`
- Blue surface secondary text:
  - light theme: `5.07:1`
  - dark theme: `5.73:1`
- Lime surface primary text:
  - both themes: `16.45:1`
- Lime surface secondary text:
  - both themes: `7.29:1`

### Remaining verification note

The code and computed ratios are clean, and production plus Storybook builds passed. A final browser-driven dark-mode screenshot pass is still worth doing outside the current sandbox limitations.

## 5-Second Test

What a cold visitor learns quickly:

1. What is this?
   - An infrastructure/control-plane product for agent workflows.
2. Who is it for?
   - Developers, infra teams, and security-minded operators.
3. What is the core promise?
   - Agent work becomes governable, attributable, and less collision-prone.
4. What should I do next?
   - Read docs or inspect architecture/security.

Score: `7.5/10`

Why not higher:

- Category recognition is strong.
- Trust is strong.
- Urgency is still softer than it should be.
- Some visitors will think “interesting infra” before they think “this solves my problem now.”

## UX Friction Analysis

### Cross-cutting friction

1. The hero explains the category before it lands the pain.
   - Strong for infra people.
   - Weaker for operators who feel collision pain but do not use “control plane” language.

2. Documentation status chips previously looked like clickable promises.
   - This pass reduced that by changing them to `Live`, `Compatibility`, and `Roadmap` and adding a legend.

3. Monetization explains structure better than value.
   - It says how the business works.
   - It does not yet say what pain gets removed at each paid tier.

4. The proof section builds trust but not yet consequence.
   - Readers learn that verification exists.
   - They do not yet see one concrete operator nightmare that verification prevents.

5. The shell lacks one real operator artifact.
   - Diagrammatic trust is high.
   - Experiential trust would improve with one real control-plane screenshot, timeline, or violation review example.

## Product Appeal Analysis

### Desirability triangle summary

For the audiences most likely to pay, the shell is strongest on trust, moderate on identity fit, and weaker on explicit urgency.

Current aggregate scores by audience cluster:

| Audience cluster | Identity fit | Problem urgency | Trust signals | Read |
| --- | ---: | ---: | ---: | --- |
| Friends and family | 3 | 2 | 7 | “Serious, but niche and hard to place” |
| Peers and potential employers | 8 | 6 | 9 | “This looks real and technically credible” |
| Buyers and operators | 8 | 7 | 8 | “Interesting and likely useful, but I want one sharper concrete use case” |

## Persona Audit

Scores are `identity / urgency / trust` out of 10.

### Friends and family

| Persona | Score | Likely reaction | Primary friction | Appeal lever |
| --- | --- | --- | --- | --- |
| Non-technical partner | 2 / 1 / 7 | “This looks impressive but I cannot explain it back.” | Jargon density | Visual seriousness helps social proof |
| Parent or older relative | 1 / 1 / 6 | “You built infrastructure software.” | No plain-language use case | The site looks legitimate |
| Designer friend | 4 / 2 / 8 | “The system looks coherent and intentional.” | Product value remains abstract | Strong visual discipline |
| Founder friend with light technical fluency | 5 / 4 / 8 | “I think this matters if teams are using many agents.” | Buyer pain not specific enough | Sees category potential |
| Engineer friend outside AI | 5 / 3 / 8 | “Cool infra, but why now?” | Pain is framed around agents, not general coordination failure | Proof and architecture sections convert skepticism |

### Peers and potential employers

| Persona | Score | Likely reaction | Primary friction | Appeal lever |
| --- | --- | --- | --- | --- |
| Staff infra engineer | 9 / 6 / 9 | “This is a real systems product, not wrapperware.” | Wants one concrete runtime walkthrough | Verification plus architecture |
| Security engineer | 8 / 7 / 9 | “Finally someone is discussing host-level gaps honestly.” | Wants stronger evidence around revocation and OS binding roadmap | Honest limitations language |
| OSS maintainer | 8 / 5 / 8 | “Open-core framing is acceptable if the free layer stays real.” | Monetization section still abstract | Clear separation of open runtime vs paid ops |
| AI tooling peer | 9 / 8 / 8 | “Yes, this is the missing operations layer.” | Wants remote/team evidence sooner | Problem feels current |
| Internal tools lead | 8 / 7 / 8 | “I can picture this inside a dev org.” | Wants screenshots of actual operator flow | Docs and route restraint |
| Hiring manager at a strong AI company | 7 / 5 / 9 | “This founder understands systems boundaries and productization.” | Wants evidence of adoption or user pull | Competence signal is high |
| VP Engineering employer | 7 / 4 / 8 | “Promising, but I need a clearer business wedge.” | Too much concept, not enough commercial use case | Professional execution |
| Principal engineer interviewer | 8 / 6 / 9 | “This is materially better than most AI-devtool sites.” | Wants specifics on runtime tradeoffs and failure recovery | Strong technical narrative |

### Target buyers and operators

| Persona | Score | Likely reaction | Primary friction | Appeal lever |
| --- | --- | --- | --- | --- |
| Solo agent-builder | 8 / 8 / 8 | “This could stop my local swarm from turning into spaghetti.” | Pricing path beyond open core is still fuzzy | Immediate pain recognition |
| Startup CTO shipping coding agents | 9 / 9 / 8 | “I can justify evaluating this now.” | Needs one proof of team workflow, not only local-first story | Strong category fit |
| DevEx lead | 8 / 8 / 8 | “This looks like operator software I could standardize around.” | Wants deployment story and rollout path | Docs CTA is credible |
| Platform engineer for AI infra | 9 / 9 / 9 | “This is directly in my problem space.” | Wants more on fleet history and remote ops | Strongest fit on the site |
| Security/compliance lead | 7 / 8 / 8 | “I care if this becomes a control point for agents.” | Needs concrete audit/export examples | Limitations honesty helps |
| MLOps / agent platform engineer | 8 / 8 / 8 | “The control-plane framing makes sense.” | Wants evidence of multi-agent orchestration at scale | Good identity match |
| CI/CD owner experimenting with agents | 7 / 7 / 8 | “Maybe relevant if our runners get agent-heavy.” | Needs a use case that sounds like build/release reality | Whitepaper extensions would help |
| Consultancy implementing agent workflows | 8 / 8 / 7 | “This could become part of our delivery stack.” | Needs easier “why clients should pay for this” language | Governance story is sellable |
| Enterprise architect | 7 / 6 / 8 | “Serious enough to keep reading.” | Commercial controls need more specificity | Architecture clarity |
| Procurement-adjacent technical evaluator | 6 / 5 / 8 | “Looks polished and disciplined.” | Needs explicit value proof and packaging clarity | Trust is decent, urgency is not |

## What the Site Sells Well Right Now

- Seriousness
- Technical credibility
- Systems taste
- Discipline around scope and operator truth

## What the Site Does Not Yet Sell Well Enough

- The immediate cost of not using a control plane
- The first concrete operator workflow
- The business value of each paid layer
- Why a skeptical but practical engineering leader should start a pilot this month

## Highest-Leverage Next Fixes

### Immediate

1. Add one real operator artifact above the docs mosaic.
   - Best option: a truthful screenshot or cropped UI strip from the actual control plane
   - Purpose: convert abstract trust into concrete product reality

2. Rewrite the monetization cards around pain removed, not packaging.
   - Example shape:
   - Open Core: stop local agent collisions
   - Team Control Plane: see what happened across people and machines
   - Enterprise Controls: retain evidence, policy, and key custody

3. Add a sharper use-case rail near the hero.
   - Examples:
   - “Running multiple coding agents in one repo”
   - “Tracing who touched what”
   - “Keeping harbor credentials and delegation legible”

4. Add one segmented CTA row for distinct visitors.
   - “Evaluate the runtime”
   - “Review security”
   - “Talk about team rollout”

### Near-term

5. Add one concise proof-to-consequence translation block.
   - Example:
   - “What the verification buys you in practice”
   - replay rejection
   - algorithm pinning
   - explicit legacy boundary
   - host-level gaps not hidden

6. Replace any remaining abstract “agent infrastructure” phrasing with concrete operator nouns.
   - collisions
   - attribution
   - recovery
   - evidence
   - policy

7. Add one buyer-facing case study stub, even if it is synthetic but truthful.
   - A team with multiple agents
   - One bad runtime event
   - What the daemon made visible or preventable

### Guardrails

8. Keep the route budget fixed.
   - The current shell wins partly because it is not a graveyard of thin pages.

9. Do not let docs become aspirational fiction.
   - `Live` means live.
   - `Compatibility` means retained but non-primary.
   - `Roadmap` means unshipped.

10. Keep the homepage pointed at buyers, not internal cleanup narratives.
   - Visitors do not need a lineage lecture.
   - They need the problem, the mechanism, and the reason to trust it.

## Bottom Line

The shell now clears the “impressive and serious” bar for technical visitors.

The next step is not more visual experimentation. It is sharper commercial clarity:

- one real operator artifact
- one sharper pain statement
- one tighter paid-value story

That is the shortest path from “this looks technically real” to “I want to use this and maybe pay for it.”
