# Anti-Patterns

Failure modes in CDM sessions and how to recover. Both interviewer and expert can drift; this catalog covers both. Read this before your first session and skim it again before each subsequent one until the diagnostics become automatic.

## Interviewer-side anti-patterns

### 1. Front-loading abstraction

**Symptom**: opening with "tell me how you generally approach X" or "what's your decision-making framework?"

**Why it fails**: experts give you their textbook answer — the answer they'd give a journalist. That's not L3; that's L0/L2 polish. The actual reasoning is case-bound and won't surface from abstract prompts.

**Recovery**: as soon as you notice you've drifted into abstraction, redirect with: *"Let me ground this — has there been a specific time when you had to apply that? Walk me through one."*

### 2. Skipping the timeline

**Symptom**: rushing into Sweep 3 because "we already know what happened."

**Why it fails**: Sweep 3 needs event anchors. Without a built timeline, the expert reconstructs a plausible-sounding story rather than recalling actual reasoning. You'll get narrative, not analysis.

**Recovery**: stop. Build the timeline now, even if it feels redundant. The cost of going back is much smaller than the cost of fake L3.

### 3. Letting the expert generalize

**Symptom**: the expert answers DP probes with "usually I would..." or "in general I find that..."

**Why it fails**: generalizations are often wrong about the specific case the expert claims they describe. The expert is reconstructing from a stable mental model, not recalling the actual decision. The mental model may not match the reasoning.

**Recovery**: pull back to the specific. *"Going back to that day, in that moment — what did you actually do?"*

### 4. Accepting "I just knew"

**Symptom**: expert says "I just knew" or "experience told me" and you nod and move on.

**Why it fails**: that's the start of the conversation, not the end. Behind every "I just knew" is a pattern, a cue, or an analogue the expert hasn't articulated.

**Recovery**: try in order:
1. "What were you noticing? If I'd been standing next to you, what would I have seen but missed the meaning of?"
2. "Have you ever seen something that *looked* like that but wasn't? How would you have known the difference?"
3. "When you train someone new, how do you teach them to see this?"

### 5. Treating workarounds as errors

**Symptom**: expert says "well, I'm not supposed to do this, but I always..." and you respond with "you should follow the procedure."

**Why it fails**: you've just lost the gold. Workarounds are evolved adaptations to procedure inadequacy. They contain the highest-density L3 in any operational domain. Lecturing the expert breaks rapport and shuts down further sharing.

**Recovery**: opposite move. *"That's exactly the kind of thing I'm interested in. How did you learn this was needed? What does the procedure miss?"*

### 6. Leading the witness

**Symptom**: probes like "so you must have been thinking about X, right?" or "I assume you considered Y, no?"

**Why it fails**: you're putting answers in the expert's mouth. They will agree (politeness, deference, fatigue). Your protocol is now contaminated.

**Recovery**: open-ended probes only. "What were you thinking about?" not "were you thinking about X?"

### 7. Adversarial challenge

**Symptom**: probing in a way that sounds like cross-examination. "Why didn't you just do Z?" with a tone of judgment.

**Why it fails**: the expert defends rather than discovers. Defensive answers are post-hoc rationalizations.

**Recovery**: frame challenge collaboratively. *"I'm trying to understand the difference between this case and the case where Z would be right. Help me see what you saw."* Same probe, different stance.

### 8. Closing too early

**Symptom**: when the expert says "I think that's it," you accept and end the session.

**Why it fails**: the highest-yield closing question — *"Is there anything about this incident you've never told anyone, or that you assume everyone knows but might not?"* — consistently produces surprises in the last 10% of session time.

**Recovery**: never end without running at least one closing probe.

### 9. Failing to extract heuristics live

**Symptom**: you take notes but don't translate to heuristics in-session. You'll do it later from the recording.

**Why it fails**: live extraction lets you offer back drafts and watch the expert refine them. The refinement is more valuable than your draft. Also, "later" rarely happens at the quality the live moment supports.

**Recovery**: budget the last 5 minutes of any session for one explicit heuristics-extraction pass with the expert in the room.

### 10. Skipping provenance

**Symptom**: the artifact has no metadata about who, when, what consent.

**Why it fails**: heuristics without source attribution become unfalsifiable folklore. Future readers can't trust, challenge, or re-elicit them.

**Recovery**: provenance template at the top of every artifact. See `output-format.md`.

## Expert-side patterns and how to handle them

### A. Performance mode

**Symptom**: the expert is reciting a polished version of the story, often the version they've told before in a postmortem or talk.

**Detection**: phrasing that sounds rehearsed; round numbers; clean narrative arcs without ambiguity; same exact wording on different points.

**Response**: switch to a moment that *wasn't* in the polished version. *"What's something about that day you didn't put in the postmortem?"* Or move to a different DP than the famous one.

### B. Modesty deflection

**Symptom**: "anyone would have done that," "it wasn't that hard," "it was a team effort."

**Detection**: deflection of personal expertise, often by senior practitioners.

**Response**: *"I hear you, and let me push back gently. If anyone would have done it, why did the previous shift not? What did you bring to it?"* Don't argue about credit; argue about specifics.

### C. Recency anchoring

**Symptom**: every example the expert offers is from the last two weeks.

**Detection**: dates clustered tightly in recent past.

**Response**: *"Let's go back further. What's an incident from a year or more ago that you still think about?"* Older incidents have settled lessons; recent ones have raw narrative.

### D. Trauma surfacing

**Symptom**: the incident the expert chose was psychologically harder than expected; emotional shift mid-session.

**Detection**: voice change, longer pauses, moisture in eyes, deflection from specific moments.

**Response**: pause the protocol. *"This sounds heavier than I expected. Are you up for continuing, or should we shift to a different incident?"* Never push through. If they continue, plan for a deliberate decompression at the end.

### E. Political constraint

**Symptom**: the expert is omitting things because of org politics, blame, or legal concerns.

**Detection**: vague pronouns where specifics should be ("someone said," "we decided"), sudden generality on specific points, glances at recording equipment.

**Response**: address explicitly. *"Some of this might be sensitive. I can flag specific quotes for non-attribution, or we can keep it off-record entirely. What works for you?"* Honor whatever the expert chooses.

### F. Overclaiming

**Symptom**: the expert is constructing a narrative in which they always knew, were always right, never doubted.

**Detection**: no rejected alternatives surface; no disconfirming signals named; confidence reported as 10/10 on every DP.

**Response**: probe more aggressively for doubt. *"Was there a moment, even a small one, when you thought you might be wrong?"* If still no doubt surfaces, the case is being mis-recalled and the L3 yield will be low.

## Mid-session recovery moves

When a session is going off the rails, three reset moves help:

1. **Re-anchor in time**: *"Let's go back to [specific moment in timeline]. Set the scene for me again."* Pulls the expert back into recall mode.

2. **Switch DP**: if one DP is producing nothing, move to another. *"That's interesting; let me come back to it. Tell me more about DP4 — that moment when you decided to..."*

3. **Take a break**: 5 minutes of non-protocol conversation often resets both you and the expert. *"Let's pause for a minute — water, restroom, whatever you need."* Don't underestimate fatigue.

## Session-end discipline

Always do, in order:
1. Run at least one closing probe (Family 11 in `probe-library.md`)
2. Walk through your draft heuristics with the expert
3. Confirm consent for each heuristic and quote
4. Note any open questions for follow-up
5. Thank the expert for time and candor — explicitly, not as boilerplate
6. If the session was emotionally heavy, decompress with non-protocol conversation before closing

Skipping any of these systematically degrades the program over time, even if individual sessions look fine.

## Self-audit after each session

Three questions to answer in your session notes:

1. **Did I get at least one "I never thought about it that way" moment?** If no, the deepening sweep didn't work.
2. **Did I extract at least 2 falsifiable heuristics?** If no, either the case wasn't CDM-worthy or you didn't translate.
3. **Did I run the closing probe?** If no, you cost yourself the last-10% yield.

Honest scoring against these three keeps your CDM practice from drifting into structured-chat over time.
