---
name: brainstorm-facilitator
description: Facilitate idea generation sessions that actually produce diverse, useful options instead of degenerating into the first plausible answer. Use for product ideation, feature exploration, problem-reframing, naming, design alternatives, strategic option-generation, or any task where the failure mode is "we picked the obvious thing too fast." Covers solo and group sessions, divergence/convergence discipline, technique selection (SCAMPER, Crazy Eights, How Might We, 6-3-5 Brainwriting, Reverse Brainstorming, Worst Possible Idea, Random Stimulus), facilitation moves for handling dominant voices and groupthink, and structured convergence to a shortlist with rationale. Outputs a session artifact with options generated, evaluation, shortlist, and the rejected-but-interesting list.
license: Apache-2.0
---

# Brainstorm Facilitator

Most "brainstorming" produces three or four obvious ideas, picks one, and calls it a session. That's not brainstorming — that's the first instinct dressed up. Real brainstorming is a discipline of (1) deferring judgment long enough for non-obvious options to surface, (2) using techniques that defeat fixation, (3) handling group dynamics that suppress dissent, and (4) converging deliberately rather than by exhaustion.

This skill is the operating manual for running sessions that beat the first-instinct ceiling.

## When to use

Use this skill when:
- The team is converging on the first plausible answer and you suspect better ones exist
- A problem has multiple valid framings and you haven't explored them
- You need a *range* of options to evaluate, not a single recommendation
- A previous decision is locked in but feels wrong — you want to surface the alternatives that weren't considered
- You're naming a thing, choosing a metaphor, or making a creative call
- You want to break fixation on a known approach
- Stakeholder input is needed but politics are suppressing real options

Do NOT use when:
- The decision is genuinely binary or has one obvious right answer (don't perform creativity)
- You need execution, not options (separate skill)
- The constraint set already eliminates all but one path
- Time is shorter than 20 minutes — real brainstorming has a minimum dose
- The "creativity" request is actually political cover for a decision already made (call this out)

## The core discipline: separate divergence from convergence

This is the single most important rule in this skill. **Never mix divergence and convergence in the same phase.** If you let evaluation in during divergence, you will:
- Anchor on the first idea that survives critique
- Suppress wild ideas (which are where novel solutions live)
- Trigger evaluation apprehension (people stop offering ideas)
- Produce a smaller, narrower option space

If you defer convergence until divergence is genuinely done, you will:
- Generate 3–10x more options
- Find non-obvious framings ("we've been solving the wrong problem")
- Produce shortlists that include at least one real surprise
- Build buy-in (everyone's idea got real airtime before being cut)

See `references/divergence-convergence.md` for the discipline and how to enforce it mid-session when someone breaks it.

## The three phases

### Phase 1 — Frame the question (5–10 min)

A bad question produces a bad session. The frame determines the option space.

Test the question against three lenses:
- **Specificity**: "How might we improve onboarding?" is too vague; "How might we reduce time-to-first-value for new users below 5 minutes?" is workable.
- **Frame breadth**: "How do we make this button more clickable?" forecloses; "How might users discover this feature?" opens.
- **Constraint honesty**: list real constraints (budget, time, must-haves) BEFORE divergence. Hidden constraints surface as objections in convergence and waste divergence work.

The "How Might We..." (HMW) framing is the standard opening because it presupposes solvability without prescribing approach. Use it.

If the question produces fewer than 10 ideas in 10 minutes from a single facilitator+1 group, the question is wrong, not the participants. Reframe.

### Phase 2 — Diverge (15–60 min)

Pick a technique from `references/technique-catalog.md` based on the situation. Run it with strict divergence rules:
- Quantity over quality (target 30–100 ideas, not 3–5)
- Defer ALL judgment (no "yes but," "we tried that," "legal won't allow")
- Build on others' ideas ("yes, and...")
- Wild ideas welcome — wild ideas often unlock practical ones via subsequent edits
- Stay focused on the question (digression is fine; off-topic is not)
- One conversation at a time (in groups)

Capture everything visibly. Whiteboard, doc, sticky notes, shared editing. Visibility serves two purposes: it prevents idea loss, and it lets people build on what others said (the "Yes, and" mechanism).

Switch techniques mid-session if the well runs dry. A second technique on the same problem typically produces 30–50% more ideas because it forces a different angle of attack.

### Phase 3 — Converge (15–30 min)

Convergence is its own protocol, not "we just pick the best one."

Sequence:
1. **Group / cluster** — affinity map duplicates and near-duplicates. Done together, not by the facilitator alone.
2. **Criteria first** — agree explicit evaluation criteria BEFORE looking at ideas. Default: NUF (Novel, Useful, Feasible) or impact-vs-effort. Custom criteria when domain demands it.
3. **First-pass scoring** — dot voting or matrix scoring against criteria. Each person votes independently *before* discussion to prevent anchoring.
4. **Discuss top tier** — surface disagreements; let advocates make their case for surprising picks.
5. **Shortlist** — 3–5 options for further work, plus 1–2 "interesting but rejected" preserved with rationale. The rejected-but-interesting list is gold for future sessions.

The session ends with: ranked shortlist, decision criteria used, rejected-but-interesting list, and explicit handoff (what happens next, who owns it, when).

## Mental models

**Divergence is volume; convergence is judgment.** Two different muscles. Don't try to use them at the same time. Don't trust people who claim they can.

**Fixation is the default.** First plausible idea anchors all subsequent thinking (Ward 1994, Smith et al.). The whole point of technique-driven brainstorming is to defeat this default. If the session "feels easy," you're probably fixated.

**Wild ideas are the substrate, not the deliverable.** A "build a teleporter" idea isn't the answer. But its *edit* — "remove travel time" — might lead to async-first onboarding. Always probe wild ideas for the kernel before discarding.

**Brainwriting > brainstorming for many groups.** Solo idea-generation followed by sharing produces more, more diverse ideas than verbal brainstorming, especially with groups of 4+. See `references/solo-vs-group.md` for when to use which mode. Verbal brainstorming has well-documented production-blocking and evaluation-apprehension effects.

**Diverse inputs > diverse minds.** A solo expert with three techniques often beats a homogenous group with one technique. Diversity of *approach* matters as much as diversity of *people*.

**Convergence reveals divergence quality.** If shortlisting feels obvious, your divergence was weak. If shortlisting is hard because there are 5 genuinely different good options, your divergence worked.

**Track rejected ideas with reasons.** "We rejected X because Y" is the highest-yield artifact for future sessions on the same problem. Constraints change; rejected ideas often become viable later.

## Solo vs. group

Different protocols. See `references/solo-vs-group.md`.

- **Solo with AI**: think-aloud + the AI playing devil's advocate, technique rotator, and forced-perspective generator. Often produces better volume than small groups because there's no production blocking.
- **Pairs**: lowest-friction collaborative mode. Run two parallel solo passes, then share.
- **Small groups (3–6)**: brainwriting works better than verbal brainstorming for divergence; switch to verbal for convergence discussion.
- **Large groups (7+)**: never run as one group. Split into pairs or trios for divergence, share at convergence.

## Reference files

| File | When to load |
|------|--------------|
| `references/divergence-convergence.md` | The core discipline; how to enforce separation; how to recover when someone breaks it |
| `references/technique-catalog.md` | Technique menu (SCAMPER, Crazy Eights, How Might We, 6-3-5, Reverse, Worst Possible Idea, Random Stimulus, Lotus Blossom, Six Thinking Hats) with selection criteria for each |
| `references/facilitation-moves.md` | Group-dynamics moves: handling dominant voices, drawing out quiet voices, breaking groupthink, equal-airtime mechanisms |
| `references/solo-vs-group.md` | Mode selection; protocol differences; when brainwriting beats brainstorming; AI-assisted solo patterns |
| `references/anti-patterns.md` | Failure modes (HiPPO, premature convergence, anchoring, production blocking, false-consensus, decision-not-ideation) and recovery moves |

## Anti-patterns

**Calling the meeting "brainstorming" when the decision is already made.** This is political theater. Refuse or rename the session. Doing fake brainstorming to launder a decision destroys trust in real brainstorming.

**Letting "yes but" through during divergence.** Every "yes but" trains the room to self-censor. Intervene immediately and consistently. Replace with "yes, and."

**Verbal brainstorming as the default.** Default to silent solo generation first, then share. Verbal-first brainstorming has decades of research showing it underperforms brainwriting on volume and diversity.

**Convergence without explicit criteria.** Without criteria, convergence selects the loudest advocate, the highest-status voice, or the safest-sounding option. Set criteria before scoring.

**Shortlisting only the "safe" ideas.** A shortlist of 5 obvious options is a sign you converged too fast or didn't enforce divergence rules. A good shortlist includes at least one option that surprises someone.

**No rejected-but-interesting list.** The single highest-leverage convergence artifact, and almost always omitted. Preserve it.

**Treating "we already tried that" as terminal.** "We tried that" is information, not a verdict. Probe: when, with what variation, with what constraints, is anything different now? Some "we tried that" ideas are exactly the right ideas now.

**Session ends without explicit next-action handoff.** A shortlist with no owner is a dead artifact. Always close with: who, what, when.

## Output format

Every session produces a structured artifact:

```markdown
# Brainstorm Session: [topic]

## Frame
- **Question (HMW form)**: ...
- **Constraints**: [hard / soft / aspirational]
- **Success criteria for the session**: [shortlist size, depth required]

## Participants & mode
- [solo / pair / small / large group]
- [verbal / brainwriting / hybrid]

## Techniques used
- [technique 1, when, why]
- [technique 2, when, why if switched]

## Ideas generated
[full list, lightly clustered, NO evaluation in this section]

## Convergence

### Criteria
- [agreed criteria, with rationale]

### Scoring / clustering
[matrix or affinity result]

### Shortlist (3–5)
1. [option] — [rationale, score]
2. ...

### Rejected-but-interesting (1–3)
1. [option] — [why rejected, what would make it viable, who/when revisit]

## Handoff
- **Next action**: ...
- **Owner**: ...
- **By when**: ...

## Session notes
- What worked
- What I'd do differently
- Open questions
```

## Shibboleth

Someone running real brainstorming will:
- Refuse to start until the question passes the three-lens test
- Aggressively prevent evaluation during divergence
- Switch techniques mid-session when the well dries up
- Insist on independent voting before group discussion in convergence
- Preserve rejected-but-interesting options with rationale
- End with explicit handoff, not just a shortlist

Someone doing brainstorm cosplay will:
- Open with "okay, let's just throw out ideas" with no question framing
- Let "yes but" through and call it "healthy debate"
- Pick the highest-status person's idea and call it consensus
- Discard rejected ideas without recording why
- End with "great session, let's circle back" — i.e., no next move
