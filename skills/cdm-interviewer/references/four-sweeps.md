# The Four Sweeps — Detailed Protocol

CDM is structured as four sequential passes through the same incident. Each has a specific goal, distinct probes, and a "done" signal. Running them in order matters: each sweep builds the scaffolding the next sweep relies on.

## Sweep 1 — Incident selection and ground

**Time**: 10–15 minutes. **Goal**: lock onto ONE specific incident.

### Opening

Frame the session collaboratively before the first probe:

> "I'm going to walk you through a structured interview about one specific situation. I'll be asking the same incident from four different angles, so it'll feel repetitive in places — that's intentional. We'll spend the first 10 minutes picking the right case, then build a timeline, then dig into your decisions, then look at counterfactuals. Sound okay?"

This frame buys you permission to redirect them later when they drift. Skipping the frame makes Sweep 3 feel adversarial.

### Selection criteria (need at least one)

- **Non-routine**: standard procedures didn't fully apply, or applied in ambiguous ways
- **High-stakes**: real consequences attached
- **Intuition-heavy**: the expert had unexplained leaps
- **Counterfactually interesting**: a less-experienced person would have done differently
- **Memorable**: the expert can date it, place it, name people involved

### What to reject and how

| Expert offers | What it actually is | Redirect |
|---|---|---|
| "I generally handle X by..." | Composite, not incident | "Has there been a specific time that didn't go to plan? Walk me through one." |
| "Last week we had..." (routine) | Recent but uninteresting | "Was that hard? Or just a busy day? I'm looking for one that made you stop and think." |
| "There was this time, I forget when..." | Memory too thin | "Pick something you can date. Even roughly." |
| Three incidents in one breath | Fishing | "Which of those would you tell at a conference?" |

### Done signal

You can name: incident, date (or rough date), expert's role, two-to-three-sentence summary, and at least one element matching the selection criteria. The expert references specific people, places, or systems by name.

## Sweep 2 — Timeline construction

**Time**: 15–20 minutes. **Goal**: build dense event chronology with no analysis.

### The discipline

Experts will jump to interpretation: *"so I realized the cooling system was failing because..."* — STOP. That's Sweep 3. Pull them back:

> "Hold that for a moment — I want to come back to it. First: what happened next, in time?"

This feels rude the first time you do it. It is not. The expert will follow you because you've already framed the structure. Without timeline discipline, Sweep 3 produces narrative reconstruction (a plausible story) instead of recall (actual reasoning).

### Probe pattern

Cycle through:
- "Then what?"
- "Where were you when X happened?"
- "Who was there? What did they say?"
- "How long did that take?"
- "What were you doing while [event] was happening?"

### Decision-point flagging

Mark a DP whenever the expert mentions:
- A choice ("I decided to...", "I went with...", "rather than...")
- An assessment ("I figured...", "it looked like...")
- An action that wasn't dictated by procedure
- A point where they paused, waited, or chose to escalate (or not)
- A judgment call on incomplete information

Don't probe these yet. Just mark them — number them in your notes (DP1, DP2...).

### Done signal

Timeline has 5–15 events with rough timestamps; 3–8 decision points flagged; expert has stopped offering interpretation and is now in narrative mode. If you have fewer than 3 DPs, the case may not be CDM-worthy — consider whether to switch incidents.

## Sweep 3 — Deepening at decision points

**Time**: 25–35 minutes. **Goal**: surface cues, alternatives, expertise at each DP. **This is where the L3 lives.**

### Per-DP protocol

For each DP, work this minimum sequence (full library in `probe-library.md`):

1. **Re-anchor**: "Going back to DP3 — that's the moment you decided to bypass the standard alarm response. Set the scene for me again."
2. **Cues**: "What were you noticing right then? What was telling you something was off?"
3. **Knowledge**: "What did you know that made you read it that way? What would someone without that knowledge have seen?"
4. **Analogues**: "Did this remind you of any other situation? Have you seen this pattern before?"
5. **Options**: "What other options did you consider? Why not those?"
6. **Time pressure**: "How much time did you have? What if you'd had ten times more time?"
7. **Confidence**: "How confident were you? What would have changed your mind?"

### When the expert says "I just knew"

This is *not* a stopping point. It's the start. Try in order:

- "What were you noticing? If I'd been standing next to you, what would I have seen but missed the meaning of?"
- "Have you ever seen something that *looked* like that but wasn't? How would you have known the difference?"
- "When you train someone new, how do you teach them to see this?"
- "If you had to write a checklist for the moment before this decision, what would be on it?"

Eighty percent of the time, one of these unblocks articulation. The remaining 20% is genuine ineffability — note it as an open question.

### Done signal per DP

The expert has said something like: *"I never thought about it that way"*, *"I didn't realize I was doing that"*, or *"huh, I guess what I'm looking for is..."*. They've named at least one specific cue and one specific alternative they rejected. If they're only restating the timeline, you haven't deepened — try a different probe family.

### Done signal for the sweep

Every DP has been worked. You have specific cues (not "experience told me"), at least one rejected alternative per DP, and at least one moment of self-discovery from the expert.

## Sweep 4 — What-if and novice errors

**Time**: 10–15 minutes. **Goal**: counterfactuals expose discrimination knowledge.

### Probe order (high-yield first)

1. **Novice error** — *"What if you'd had less experience? Where would a novice have gone wrong here?"* This is the highest-yield single CDM question. Ask it for each major DP, not just once.
2. **Cue absence** — *"What if [the key cue from Sweep 3] had been absent or different? What would you have done?"*
3. **Wished-for information** — *"Was there information you wished you had at that moment? What stopped you from getting it?"*
4. **Recurrence** — *"If this happened again tomorrow, would you do anything differently? Why?"*
5. **Advice** — *"What advice would you give a less experienced [role] facing this?"*
6. **Hidden knowledge** — *"Is there anything about this incident you've never told anyone, or that you assume everyone knows but might not?"*

### Why probe 6 matters

The "never told anyone" question consistently yields surprises in the last 10% of session time. Reasons it works:
- The expert has spent the session in articulation mode and is "primed"
- It explicitly licenses sharing things that feel obvious-or-illegal
- It signals the session is closing, which sometimes loosens guarded answers

Never skip it. If the expert says "no, that's everything," accept that and move on — but always ask.

### Heuristics extraction (last 5 min)

Force one explicit translation pass. Pick 2–4 candidate heuristics from your notes and offer them back:

> "Let me try to capture one of these as a rule. Tell me where I'm wrong: *When the cooling temperature climbs more than 3°C above setpoint AND the secondary loop pressure stays flat, because that pattern indicates pump cavitation rather than a thermostat issue, divert flow to backup loop before raising the alarm — unless secondary pressure is also dropping, in which case the issue is upstream and you escalate immediately.*"

Watch the expert refine it. The refinement is more valuable than your draft.

## Recovering from stalls

| Symptom | Likely cause | Fix |
|---|---|---|
| Expert keeps generalizing | Insufficient frame; comfort-seeking | "Going back to that day — what was happening at that moment?" |
| Expert sounds rehearsed | They're reciting a postmortem they wrote | "Let's try a moment that wasn't in the report. What's something you didn't write down?" |
| Expert says "I just knew" repeatedly | Probe family exhausted | Switch to "if you trained someone new, how would you teach this?" |
| Sweep 3 producing narrative not analysis | You skipped Sweep 2 | Stop. Build the timeline now. |
| Expert is shutting down | Trust loss; perceived judgment | Drop the probe. Acknowledge: "This is hard to put words to — that's normal." Resume with a different DP. |
| You're running out of time | Common — protocol is long | Skip Sweep 3 deepening on minor DPs; never skip Sweep 4 novice-error probe. |

## Time budget cheat sheet

| Total session | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| 60 min | 10 | 15 | 25 | 10 |
| 90 min | 15 | 20 | 35 | 15 |
| 120 min | 15 | 25 | 50 | 25 |

Sub-60-minute CDM is not real CDM — it's a structured chat. If you only have 30 minutes, run Sweeps 1, 2, and 4 (skip the deepening) and book a follow-up.
