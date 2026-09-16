# Surface Appeal Adapters

Load this when the thing to evaluate is not a finished live page — a wireframe,
a prototype, a deck — and you need to know which parts of the Desirability
Triangle you are actually entitled to score.

For papers, monographs, textbooks, and technical whitepapers, use
`references/technical-document-appeal.md` instead; it is a bigger change than
an adapter.

## The rule for wireframes

> **A wireframe can fail appeal. It cannot pass it.**

A structural appeal defect found in a wireframe is real and worth fixing now,
while fixing it is cheap. A wireframe with no structural defects has told you
nothing about whether the finished product will appeal, because the three
things that most drive appeal — words, images, and craft — are not present.

Put that sentence in the report. The failure mode this prevents is a team
reading "no appeal findings" as "the design is good", then shipping grey boxes
with real copy poured in and wondering why it converts at two percent.

## What a wireframe can and cannot tell you

| Triangle vertex | Assessable from a wireframe? | What you can actually score |
| --- | --- | --- |
| **Identity fit** | Partially | **Structural** identity signals only: density, option count, complexity. Sparse with three choices reads simplicity-seeker; dense with a sidebar of filters reads power user. That is a real signal and a wireframe carries it. |
| | Not assessable | Language resonance, visual identity, tone, whether the implied user looks like the target. These are the *majority* of identity fit. Score them `null`, not a number. |
| **Problem urgency** | Partially | Whether a slot exists for the problem statement, and where it sits relative to the fold and the first ask. |
| | Not assessable | Whether the words in that slot land. An empty box labelled "value prop" is not a value prop. |
| **Trust signals** | Partially | **Placement** of trust slots: is there a testimonial region, a logo strip, a guarantee near the CTA? Absence of the slot is a real finding. |
| | Not assessable | Whether the proof is convincing, whether the execution looks legitimate, whether the social proof is from people like the target. |
| **Trust ladder** | **Fully** | This is the wireframe's strongest appeal signal. Count the frames between arrival and the first ask for an account, an email, or money. Count the frames between arrival and the first demonstration of value. If the ask comes first, that is a Trust Ladder Violation, it is structural, and it is confirmed. |

## The scoring discipline

When you score a wireframe, **write `null` for what you cannot see, never a
guess**. A confident 7/10 on "language resonance" for a page of lorem ipsum is
a fabrication, and it is the kind that survives into a summary slide.

The appeal spec supports this directly: omit `identityFit.language` and the
audit script will reject the persona rather than silently averaging a made-up
number into a vertex score. That rejection is the feature. If you need a
partial score, score the sub-fields you can defend and say in the report which
vertices are unscored and why.

## What to actively look for in a wireframe

1. **Where is the first ask, and what came before it?** The single most
   valuable appeal question a wireframe can answer.
2. **Is there a value demonstration at all?** Many wireframes have a hero, a
   features grid, and a signup, and never show the product doing the thing.
   This is structural and it is fatal.
3. **Does a trust slot exist?** Not whether the proof is good — whether there
   is anywhere to put it. Retrofitting social proof into a finished layout is
   how logo strips end up in footers where nobody sees them.
4. **How many options at the decision point?** Option count is structural and
   it drives both appeal (identity signalling) and friction (working memory).
5. **Is the primary action dominant by size and position alone?** With no
   colour to lean on, this is the only way to test it — and it is the right
   test, because colour should be reinforcing dominance, not creating it.

## Fidelity is a variable, not an accident

Stakeholders respond to the fidelity level they are shown. A high-fidelity
mockup gets feedback about colour; a low-fidelity wireframe gets feedback about
flow. If you want structural feedback, deliberately keep fidelity low and say
why — otherwise you will get a debate about the shade of the button and no
answer about the trust ladder.

## Prototypes and clickable flows

A clickable prototype adds one thing a static wireframe cannot give you: the
*sequence* of asks. Walk it as a first-time user and record the order in which
the product asks for something versus gives something. That ordering is the
trust ladder, and it is now measurable rather than inferred.

Everything in the "not assessable" column above still applies. Copy is still
not real.

## Slide decks

A deck's appeal is dominated by the presenter, so the deck alone under-
determines the outcome. What a deck can be scored on: whether the first slide
states a problem the audience has, whether the ask comes before or after the
demonstration, and whether the identity signals (density, jargon level, chart
style) match the room. Say explicitly that the presenter is unmodelled.
