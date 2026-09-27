# Solo vs. Group Brainstorming

Different modes, different failure profiles, different protocols. Most "brainstorming" research over the last 50 years finds that *interactive* groups underperform the same number of people brainstorming individually and pooling. This is counterintuitive but well-replicated. The implication for facilitators: silent / written generation is often the right default, not the exception.

## The core finding

**Nominal groups** (N individuals brainstorming alone, then pooling) consistently produce more ideas, more diverse ideas, and ideas of equal-or-higher quality than **interactive groups** (N people brainstorming verbally together).

Causes:
- **Production blocking**: in verbal brainstorming, only one person speaks at a time. Others lose their idea while waiting, or self-censor for relevance to the current thread.
- **Evaluation apprehension**: people hold back ideas they're unsure of, even with explicit "no judgment" rules. The norm fights against millennia of social wiring.
- **Free riding / social loafing**: in groups, individual effort attribution is diffuse. Some people coast.
- **Anchoring**: the first speaker's idea sets the cognitive frame for everyone else.

Caveats:
- Convergence and *building on* ideas works better in groups. The nominal-group advantage is in *generation*, not selection.
- Diverse expert groups can outperform nominal groups when problems require specialized knowledge that no single person has.
- Brainwriting (silent group generation with passing) captures most of the benefits of both modes.

## Mode selection

| Situation | Recommended mode |
|---|---|
| Solo expert with deep knowledge | Solo with technique rotation |
| Pair with shared context | Two parallel solo passes, then merge |
| Small team (3–6), generation-heavy | Brainwriting (silent + share) |
| Small team, refinement-heavy | Verbal "yes-and" sessions |
| Large group (7+) | Split into pairs/trios; never one big group for divergence |
| Cross-functional team, low shared context | Solo first to surface diverse priors, then group converge |
| One dominant senior person | Silent first; senior person shares last |
| Remote / distributed | Default to silent + shared doc, with verbal layer for convergence |

## Solo brainstorming protocol

When working alone, the failure modes are different — no production blocking, but also no cross-pollination. Compensating moves:

### Setup
- Eliminate evaluation: keep a separate "criticism" doc; if you have to evaluate, do it there, not in the generation doc.
- Set a quantity floor: "I will not start judging until I have 30 options." Numbers force quantity.
- Time-box: 25 min generation, 10 min break, 25 min more, then converge. The break dramatically improves second-half quality.

### Technique rotation
Solo sessions benefit from rapid technique switching. Rotate every 10 min:

1. **Crazy Eights** (8 min, 8 ideas, fast first pass)
2. **Random Stimulus** (3 prompts, 3 ideas each — break fixation)
3. **Reverse / Worst Possible** (5 min, generate the worst possible solutions)
4. **SCAMPER** (15 min, systematic variants)

This rotation produces more diverse output than any single technique sustained.

### AI-assisted solo
With Claude (or any capable LLM), solo brainstorming can simulate group dynamics without group failure modes. Patterns:

| Pattern | What it does |
|---|---|
| **Devil's advocate** | "Push back on each of these ideas. What's wrong with them?" |
| **Forced perspective** | "Re-imagine this problem as if you were [persona X]." Repeat with 3–5 personas. |
| **Random stimulus generator** | "Give me 3 unrelated objects/concepts." Force association with each. |
| **Worst possible idea** | "Generate 10 terrible solutions to this. Make them really bad." |
| **Pattern-completing** | Give Claude 5 ideas you've generated; ask for 10 more in similar style, then 10 in a *different* style. |
| **Inversion** | "What's the opposite of each of these?" |
| **Cross-domain analogy** | "What does [problem] look like in nature? In medicine? In finance?" |
| **Synthesis** | At convergence: "Cluster these. What clusters did I miss?" |

The key with AI assistance: don't let the AI converge for you. Generate volume with AI; converge yourself (or with humans). AI evaluation is often confidently wrong about which ideas are *interesting* — it tends to pick the safe-sounding one.

## Pair brainstorming protocol

Pairs are the most efficient collaborative mode. Lower friction than groups, more cross-pollination than solo.

Protocol:
1. **Frame together**: 5 min agreeing on the HMW question.
2. **Solo generation**: 15 min apart, silent, each generates as many ideas as possible.
3. **Pool**: share lists. Build on each other's ("yes, and what if...").
4. **Joint generation**: 10 min verbal, riffing.
5. **Converge together**: criteria, voting, shortlist.

This pattern (solo → pool → riff → converge) outperforms either pure-solo or pure-verbal pair brainstorming.

## Small group (3–6) protocol

The brainwriting-first pattern wins:

1. **Frame together** (10 min): HMW, constraints, criteria for success.
2. **Silent solo write** (10 min): each person writes ideas independently; no talking.
3. **Pass and build** (15–25 min): 6-3-5-style passing, building on each other in writing.
4. **Verbal share + cluster** (15 min): each person shares 1–3 favorites; cluster as you go.
5. **Independent voting** (5 min): silent dot voting on clustered options.
6. **Discuss surprises** (15 min): high-variance options, advocacy round.
7. **Shortlist + handoff** (10 min): finalize, capture rejected-but-interesting, owner/action/deadline.

Total: ~85–90 min. Skipping the silent-write phase is the most common mistake; it's what differentiates this protocol from standard meeting "brainstorming."

## Large group (7+) protocol

Never run a large group as one unit for divergence. Always split.

1. **Plenary frame** (10 min): everyone hears the question and constraints together.
2. **Split into pairs or trios** (5 min): mixed across functions / seniority.
3. **Pair/trio brainstorm** (25 min): each unit runs its own session using whichever protocol fits.
4. **Plenary share** (15 min): each unit shares its top 3.
5. **Plenary cluster** (10 min): combine across units.
6. **Independent vote** (5 min): silent.
7. **Plenary converge** (15 min): discuss top tier, advocacy, shortlist.
8. **Plenary close** (5 min): handoff.

Total: ~90 min. The key principle: divergence is parallel-many-units; convergence is plenary. Inverting this loses both.

## Mode-switching mid-session

Sometimes you start in one mode and realize it's wrong. Indicators to switch:

| Indicator | Switch to |
|---|---|
| Solo session feels stuck after technique rotation | Add an AI co-thinker or call a peer |
| Pair is converging too easily (suspect anchoring) | Each person solo for 10 min, then resume |
| Small group has dominant voice | Switch to silent brainwriting |
| Small group is too quiet | Switch to verbal yes-and; or add a stimulus prompt |
| Large group dynamics are chaotic | Split smaller; or appoint a facilitator-of-facilitators |

Mode switching is not failure. It's responsive facilitation. Name it: "I think we should switch modes here for the next 15 minutes."

## When more brains aren't better

Sometimes adding people *hurts* the session:
- The added person is far less informed about the domain (slows everyone down)
- The added person has institutional power that suppresses others' candor
- The session is in late convergence and adding voices restarts divergence
- The problem requires deep technical specialization that few participants have

The default assumption "more people = more ideas" is wrong. *Right* people, *right* mode, *right* protocol beats raw headcount.
