# Anthropic Hiring Manager Website Direction

Date: 2026-04-29
Owner: `port-daddy:website-anthropic-direction`

## North Star

Make `portdaddy.dev` read like a serious systems artifact for people who care
about reliable, interpretable, and steerable AI systems.

The target reader is a technically strong Anthropic hiring manager. They should
understand within one minute that Port Daddy is not generic agent hype. It is a
local control plane for making multi-agent coding work observable, governed,
recoverable, budgeted, and honest about failure.

## Reader Promise

Port Daddy should answer four questions cleanly:

1. What hard problem does this solve?
   - Autonomous coding agents collide, lose context, hide costs, and create
     ambiguous ownership unless a control plane makes their work inspectable.
2. What is technically interesting?
   - Sessions, file claims, locks, tuples, actor inboxes, salvage, FleetBar,
     Shipwright, resource governance, and fail-closed launch policy form a
     concrete coordination substrate.
3. Why should a safety-minded AI company care?
   - The product treats agentic autonomy as something to steer and audit, not
     as magic. It makes provenance, budget, readiness, resource pressure, and
     handoffs visible.
4. What is the evidence?
   - Screenshots, CLI examples, route docs, tests, current failures, promotion
     status, and operator-visible UI should be shown directly. Avoid vague
     claims unless there is a live surface or command behind them.

## Tone

Use serious, plain, high-agency language.

Prefer:

- "observable multi-agent repo work"
- "recoverable sessions"
- "inspectable claims and handoffs"
- "fail-closed launch readiness"
- "local resource and budget governance"
- "agent-to-agent coordination through shared state"
- "operator-visible evidence"

Avoid:

- generic "AI swarm" or "magic" copy
- anthropomorphic claims that suggest agents literally have subjective
  experience
- mascot, nautical, or roleplay language on the public homepage
- vague platform claims like "orchestrate anything"
- unexplained feature piles

If agent subjectivity appears in copy, reframe it as observable state:
"what an agent can know, claim, publish, recover, and hand off." That is more
interesting and more defensible.

## Visual Direction

The site should feel like a research lab control console, not a startup mascot
page and not soft UI.

Use:

- high information density with calm hierarchy
- flat Swiss-modern layout, strong rules, precise grids
- real screenshots or generated diagrams that explain system state
- evidence strips near claims
- code and UI examples that are readable at normal viewport size
- small, rigorous motion only when it explains causality

Avoid:

- soft shadows, inset relief, bokeh/orbs, decorative gradients
- huge empty hero space
- decorative icons where system screenshots or diagrams would be stronger
- first-person agent mysticism
- marketing cards that do not teach anything

## Homepage Structure

Recommended first-screen arc:

1. Headline:
   "A local control plane for steerable coding agents."
2. Supporting copy:
   "Port Daddy makes agent work inspectable: sessions, claims, locks, inboxes,
   resource pressure, budgets, salvage, and launch readiness all become visible
   before work reaches a commit."
3. Proof panel:
   Show a compact live-flow screenshot or generated control-plane diagram with
   labels for claims, notes, budget, resource, and handoff.
4. Primary CTA:
   "Open the control-plane tour" or "Install the Mac preview."
5. Secondary CTA:
   "Read the technical docs."

Recommended homepage sequence after hero:

1. Why agents need a control plane
2. What agents can see and do through Port Daddy
3. FleetBar and Fleet Control Center
4. Resource and budget governance
5. Shipwright cold start
6. Safety / steering / failure recovery
7. Technical proof: CLI, tests, routes, docs
8. Install and current release status

## Active Session Reorientation

### Mac app / distribution slice

Session: `session-eb7d6202-7d73-4558-a59d-9bae1e4b0b4b`

Direction:

- Keep FleetBar as proof of a real operator surface, not just a downloadable app.
- Put "why this matters" before "how to install."
- Show that FleetBar opens the same daemon-served control plane as the browser.
- Make backend readiness, Shipwright, resource governance, and budget controls
  feel like serious launch constraints.

Acceptance test:

- A reader should think: "This person understands the operational burden of
  autonomous coding agents."

### Stale dashboard / public route cleanup

Session: `session-07e47082-8074-4f08-afb1-29fe0aa05c26`

Direction:

- Delete stale dashboard surfaces cleanly, but preserve reachability to the
  important current surfaces.
- Make route tests enforce the new story: docs, examples, tutorials, Mac app,
  safety/governance, and install status.
- Remove old v3.7-era copy that makes the site look abandoned.

Acceptance test:

- A reader should never hit a page that feels older than the product shown in
  Fleet Control Center.

### PR5 docs / PD Tube / PKI slice

Session: `session-1639a885-732a-4723-aee1-020e966a4549`

Direction:

- Treat PD Tube and PKI as proof of secure, inspectable agent infrastructure.
- Avoid making them feel like extra feature confetti.
- Tie them to provenance, secure relay, trust boundaries, and operator control.

Acceptance test:

- A reader should think: "The security story is explicit enough to audit."

### Swiss-modern / depth polish

Session: `session-acacd5da-8391-426c-9376-09fb1ace4b1e`

Direction:

- Continue the flat, information-dense system.
- Do not reintroduce soft UI or visual metaphors that weaken the research-lab
  feel.
- Use structure, contrast, typography, and real evidence as the "wow."

Acceptance test:

- A reader should feel the site is mature, restrained, and technically dense,
  not visually noisy.

### Runtime / agent naming / telemetry slices

Sessions: `session-68d68d1d-a8f0-4947-9c00-00862a3d9179` and related runtime work

Direction:

- Human-readable agent names are website material. They make examples legible.
- Telemetry failures are not embarrassing; they prove the product has
  fail-closed launch ethics. Explain them clearly when relevant.

Acceptance test:

- A reader should see failures as governed states, not mysterious breakage.

## Copy Rubric

Every public claim should pass at least one of these:

- Does it show how agent work becomes observable?
- Does it show how autonomy is constrained, steered, or recovered?
- Does it show a live UI, command, route, test, or artifact?
- Does it reduce the human coordination burden without hiding responsibility?
- Would a serious AI safety / systems engineering reader trust the sentence?

Delete or rewrite claims that do not pass.

## Immediate Coordination Notes

- Do not make "agent subjective experience" a literal homepage claim.
  Translate it into observable context, memory, claims, and handoffs.
- Do not let the homepage become a Mac download page. The Mac app is the front
  door to the control plane; the control plane is the thesis.
- Do not let generated imagery replace proof. Generated visuals can explain
  architecture, but screenshots and commands carry more trust.
- Keep active dirty slices separated. The site needs a coherent story more than
  one more section.

## External Reference

Anthropic's public careers pages repeatedly frame the work around reliable,
interpretable, steerable, safe, beneficial AI systems, and around impact toward
trustworthy AI. That language should inform the website's seriousness without
copying Anthropic's voice or pretending affiliation.

Useful official references:

- Anthropic careers, Research Engineer Interpretability:
  https://www.anthropic.com/careers/jobs/4980430008
- Anthropic careers, Model Evaluations:
  https://www.anthropic.com/careers/jobs/4990535008
- Anthropic Responsible Scaling Policy:
  https://www-cdn.anthropic.com/files/4zrzovbb/website/bf04581e4f329735fd90634f6a1962c13c0bd351.pdf
