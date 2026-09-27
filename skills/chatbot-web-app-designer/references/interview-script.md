# Structured Founder Interview Script

Work through these in order. Don't skip ahead to features before goals/audience are clear — later answers keep contradicting earlier ones otherwise.

## 1. Goals & audience
- What problem does this solve, for whom, specifically? (Reject "everyone" as an answer — push for a specific user.)
- What does success look like in 6 months? In 2 years?
- Who are 2-3 competitors or comparable products, and what do you want to do differently?

## 2. Core user flows (this drives the node-graph directly)
- Walk me through what a new user does in their first 5 minutes.
- What's the one action that, if a user never does it, means the product failed for them?
- For each major feature named: does it stand alone, or does it require another feature first? (This is a `depends-on` edge.)
- For each major screen named: what can you navigate to from here? (This is a `navigates-to` edge.)

## 3. Must-have vs. nice-to-have
- If you could only ship 3 features for v1, which 3?
- What's explicitly out of scope for v1 that you might want later? (Capture this for the PRD's out-of-scope section — it prevents scope creep during build and manages expectations.)

## 4. Brand & tone
- Three adjectives for how this should feel to use.
- Any existing brand assets (logo, colors, an existing site) to anchor the design system to, or starting fresh?
- Light, dark, or both? (Feeds `dark-mode-design-expert` at the design-system phase.)

## 5. Technical constraints
- Any existing backend/infra this needs to integrate with?
- Expected scale at launch (10 users vs. 10,000) — this matters for which pure technical skills apply later, but doesn't block discovery now.
- Any regulatory/compliance context that changes what can be built? (If yes, this may need a vertical-specific compliance skill alongside this one — don't silently absorb compliance-shaping answers into the generic PRD.)

## Running the loop
After each answer that introduces a new screen or feature, do Step 2 of the core process (sketch + node-graph) before moving to the next question — don't batch all interview questions first and wireframe/graph afterward, since you lose the natural moment when an edge (e.g., "oh, and from there they can start a video call") comes up.
