# Output Format

The deliverable from a CDM session is a structured Markdown artifact, not a transcript. Transcripts are raw material; the artifact is the distilled product. Both should be retained, but the artifact is what gets distilled into skills, runbooks, or training material.

## Template

```markdown
# CDM Session: [Incident Name]

## Provenance

- **Expert**: [name or anonymized role]
- **Interviewer**: [name]
- **Session date**: [YYYY-MM-DD]
- **Incident date**: [YYYY-MM-DD or "approximately YYYY-MM"]
- **Domain**: [e.g., SRE on-call, clinical decision-making, code review]
- **Consent**: [open / internal-only / anonymized-share / no-share]
- **Anonymization**: [list of substitutions made, e.g., "company name → 'CompanyA'"]

## Incident Summary

Three sentences max. What was the situation, what did the expert do, what was the outcome.

## Timeline

| # | Time (relative or absolute) | Event | DP? |
|---|---|---|---|
| 1 | T+0 | [event description] | |
| 2 | T+3min | [event description] | DP1 |
| 3 | T+5min | [event description] | |
| 4 | T+8min | [event description] | DP2 |

Aim for 5–15 events with 3–8 decision points flagged.

## Decision Points

### DP1 — [short label, e.g., "Bypass alarm threshold"]

- **Situation at the moment**: [what was true when this decision arose]
- **Cues observed**: [specific perceptual triggers — the L3 gold]
  - [cue 1, with the underlying reason it mattered]
  - [cue 2, with the underlying reason it mattered]
- **Knowledge applied**: [what the expert knew that gave the cues meaning]
- **Analogues**: [prior cases this resembled, if any]
- **Options considered**: 
  - **Chosen**: [option taken and why]
  - **Rejected option A**: [option and why rejected]
  - **Rejected option B**: [if applicable]
- **Time pressure**: [decision economics — how much time, what was tradedaway]
- **Confidence**: [stated confidence + the disconfirming signal the expert was monitoring]
- **Outcome of this decision**: [what happened next as a result]

### DP2 — [...]

[same structure]

## Heuristics Extracted

The deliverable section. Each heuristic in the form:

> **When [observable cue], because [causal reason], do [action], unless [exception].**

1. **[Short label]** — When [cue], because [reason], do [action], unless [exception].
   - *Source DP*: DP1
   - *Confidence*: [expert's stated confidence in this rule, or "low/medium/high"]
   - *Falsifying condition*: [what evidence would invalidate this heuristic]

2. **[Short label]** — [same structure]

3. ...

Aim for 2–5 heuristics. Fewer than 2 means the case wasn't CDM-worthy or the deepening sweep failed. More than 5 usually means you're conflating heuristics — try merging.

## Anti-Patterns Observed

What novices, less experienced practitioners, or rule-followers would have done wrong. Each item:

1. **[Anti-pattern name]** — A novice would [mistake], because they would read [misleading cue] as [wrong meaning]. The cue that should prevent this: [specific signal].

The "cue that should prevent" is what makes this section operational instead of decorative.

## Open Questions

Things the expert couldn't articulate, points where probing stalled, candidates for follow-up sessions:

- [Question 1: e.g., "Expert couldn't articulate how they distinguish cavitation from upstream blockage from the panel alone — needs a second session focused on this."]
- [Question 2]

## Quotes Worth Preserving

Verbatim phrases (with consent) that capture something the structured fields can't:

> "I never thought about it that way, but I think what I'm actually looking for is the *rate* of pressure change, not the absolute value."

These quotes are valuable for two reasons: they're the moment of self-discovery (signal that scaffolding worked), and they're the rawest L3 in the artifact.

## Distillation Targets

Where this content should be deposited:

- [ ] [Target SKILL.md path] — [which sections / heuristics]
- [ ] [Target runbook] — [which anti-patterns]
- [ ] [Target training material] — [which DP narratives]
- [ ] Followup session needed: [yes/no, on what topic]

## Session Notes

Optional. Process notes for future interviewers:
- What worked particularly well in this session
- What you'd do differently
- Probe families that yielded most / least
```

## Heuristic-extraction tips

The hardest part of CDM authoring is translating session content into the **when-because-do-unless** form. A few patterns:

### Pattern A — Cue + reason from Sweep 3, action from timeline, exception from Sweep 4 counterfactual

Most heuristics assemble from across sweeps:
- The **when** (cue) comes from Sweep 3 cue probes
- The **because** (reason) comes from Sweep 3 knowledge probes
- The **do** (action) is what the expert actually did at that DP in the timeline
- The **unless** (exception) comes from Sweep 4 cue-absence and counterfactual probes

### Pattern B — Quotes are clues

If the expert said something like *"the thing I'm always watching for is X"* — that's a heuristic in raw form. Translate it.

### Pattern C — Anti-patterns inverted

Sometimes the cleanest heuristic comes from inverting the anti-pattern: "novices do X because they confuse cue Y for cue Z" → heuristic: "When cue Y appears alone (not with cue Z), do W."

### Pattern D — Falsifiability check

Every heuristic should pass: *"Could this rule ever fire incorrectly?"* If no, it's a tautology, not a heuristic. Examples:
- ❌ "When the system is in a bad state, take corrective action." — unfalsifiable
- ✅ "When p99 latency exceeds 2x baseline AND error rate is flat, because that pattern indicates head-of-line blocking rather than backend failure, drain a pod before scaling out — unless error rate is also rising, in which case scale first."

## Provenance discipline

Without provenance, heuristics decay into folklore. Always record:
- **Who** said this (or anonymized role + organization size)
- **About what incident** (date and brief description)
- **On what date** (the session)
- **With what consent** (use rights downstream)
- **Anonymizations** (so future readers can interpret without confusion)

Heuristics deposited into shared skill files should carry their provenance, even if abbreviated. A line like *"Source: SRE CDM 2026-04-12, ALCV-incident"* attached to a heuristic enables future challenge, refinement, and re-elicitation.

## Length norms

- Total artifact: 1500–4000 words for a 60–90 minute session
- Per DP: 150–400 words
- Heuristics: 2–5 in the form above
- Anti-patterns: 2–4

If the artifact balloons past 5000 words, you're over-narrating; cut the timeline detail and keep DPs and heuristics. If it's under 800 words, you under-elicited or under-distilled — re-engage either the expert or the session notes.
