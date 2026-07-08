# Case Selection — How to Ground the Expert

Sweep 1 succeeds or fails based on case selection. A weak case yields weak L3 no matter how skilled your probing. This file is the recovery manual when the opening doesn't land.

## What a CDM-worthy case looks like

A case is CDM-worthy if it satisfies at least one (ideally two) of:

| Criterion | Test |
|---|---|
| Non-routine | The expert deviated from or extended standard procedure |
| High-stakes | A real outcome was at stake (not a drill, simulation, or low-consequence task) |
| Intuition-heavy | The expert reports "I just knew" or "something felt off" |
| Counterfactually interesting | A novice or different specialist would plausibly have done differently |
| Memorable | The expert can name when, where, who, and at least one specific detail |

Cases that fail all five: routine work, hypotheticals, secondhand stories ("I heard about a guy who..."), and recent-but-uneventful incidents.

## Opening sequence

A working opener with three layers:

1. **Frame the protocol** (1 minute):
   > "I want to walk through one specific situation in some detail. I'll ask the same incident from a few different angles, so it'll feel a little repetitive — that's intentional. The goal is to get at the reasoning behind decisions, not just the events. Anything off-limits before we start?"

2. **Solicit candidates** (2–3 minutes):
   > "Tell me about a time when [domain] went sideways and you had to figure something out. Doesn't have to be dramatic — just a time you remember, where standard procedure didn't quite fit. Pick one specific incident."

3. **Triage the offers** (2–5 minutes): the expert may offer one case, several, or push back. Use the triage table below.

## Triage: what the expert offers vs. what to do

| Offer | Diagnosis | Response |
|---|---|---|
| One specific incident, can date it, names people | ✅ Take it. | "Great. Let's start there." |
| Three incidents at once | Fishing for the right one. | "Which would you tell at a conference? Let's go with that." |
| "I generally handle X by..." | Composite, not incident. | "Has there been a specific time that didn't go to plan? Walk me through one of those." |
| "I can't think of one." | Often anxiety, not absence. | "What's the last time you stayed late? Or got paged outside hours? Or had to escalate?" |
| Routine recent case | Comfort-seeking. | "Was that hard, or just busy? I'm looking for one that made you stop and think." |
| Secondhand story | Wrong source. | "Got it — what about something *you* were on the inside of?" |
| Hypothetical ("if X happened, I would...") | Wrong mode. | "Has X ever actually happened? Or something close to it?" |
| Story of a colleague's mistake | Voyeurism risk. | "Was there something you almost got wrong yourself, even if you caught it?" |
| Wants to discuss strategy/philosophy | Wrong altitude. | "Let's pin it to a specific moment first. We'll come back to the broader stuff at the end." |

## When the expert offers something painful

Some experts will spontaneously offer the worst incident of their career. Two failure modes here:

1. **Take it without consent.** This produces trauma re-exposure and breaks rapport. Always ask: *"Are you up for going through that one in detail? If it's still raw, we can pick something else."*
2. **Refuse it out of caution.** Painful incidents are often the densest L3 because they're indelibly remembered. If the expert says "yes, I want to," accept gratefully and proceed carefully — and end with a deliberate decompression (see `anti-patterns.md`).

The decision is the expert's, not yours.

## Multiple-incident offers — picking the best

If the expert lists several, prefer the one with:
- Most counterfactual interest ("a novice would have...")
- Most ambiguity at the time ("we didn't know if it was X or Y")
- Most lasting lesson ("I still think about that one")
- Least political baggage (if you're recording or distributing the output)

Avoid:
- The "famous" incident everyone already knows — it's been told too many times and the narrative is calcified
- The most recent one if it's still active — incomplete cases produce incomplete L3
- Anything where the expert was a peripheral observer rather than a primary actor

## When no incident comes to mind

Sometimes the expert genuinely blanks. Recovery prompts in increasing order of specificity:

1. "When was the last time you got paged?"
2. "When was the last time you had to escalate something?"
3. "When was the last time you stayed late because something wasn't going to plan?"
4. "When was the last time you trained someone, and you said 'and *this* is when it gets weird'?"
5. "What's the most recent incident that ended up in a postmortem?"
6. "What's a case you find yourself referencing in design discussions?"

If five of these don't surface anything, the expert may not have CDM-worthy material in this domain — consider whether you're talking to the right person, or whether the domain is genuinely too routine for CDM.

## Domain-flavor openers

Adapt the opener to the expert's vocabulary. Examples:

| Domain | Opener |
|---|---|
| SRE / on-call | "Tell me about an incident where the runbook didn't quite cover it." |
| Code review / architecture | "Tell me about a code review or design review where you flagged something most reviewers would have missed." |
| Clinical | "Tell me about a patient where the differential narrowed in a way the labs alone wouldn't have predicted." |
| Trading / risk | "Tell me about a position where you exited (or didn't enter) on a signal that wasn't in the model." |
| Hiring | "Tell me about a candidate decision where the obvious answer was wrong." |
| Negotiation / sales | "Tell me about a deal where you read the room and changed strategy mid-call." |
| Investigation | "Tell me about a case where you noticed the lead before the evidence justified it." |
| Operations / logistics | "Tell me about a day when the plan stopped working and you had to improvise." |

Generic openers ("tell me about a hard problem") usually produce generic responses. Domain-flavored openers usually unlock specific incidents within a minute.

## After case selection — the bridge to Sweep 2

Before starting the timeline, lock the case explicitly:

> "Okay, so we're going to go through [incident name], which happened on [date], when you were the [role]. Two-sentence summary first, then we'll build a timeline."

Saying it back to them does two things: it confirms you have the right case, and it gives the expert one last chance to say "wait, actually, let me pick a different one." Take that offer seriously if it comes — they often pick a better case the second time.
