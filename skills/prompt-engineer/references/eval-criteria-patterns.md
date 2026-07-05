# Defining Eval Criteria for a Prompt

Use this when you need a way to tell whether a prompt change is an improvement or a regression, instead of relying on a single manual read of the output.

## Why this matters

"It looks good to me" does not survive contact with the next prompt edit, the next model version, or the next reviewer. Without eval criteria defined *before* you ship, every future change to the prompt is a coin flip you can't score — you find out it broke something in production, from a user, instead of in a five-minute local check.

## Three patterns, cheapest to most rigorous

### 1. Golden input/output pairs

Collect 8-15 representative inputs (including at least one of each: typical case, edge case, ambiguous case, out-of-scope case, adversarial case) with a known-good output for each. Re-run the prompt against all of them on every change; diff against the golden outputs.

- Cheapest to build, cheapest to run.
- Best for tasks with a narrow, checkable output shape (classification, extraction, structured JSON).
- Weak for open-ended generation where "correct" isn't a single string — pair with an LLM-judge rubric instead of exact-match.

### 2. Rubric-based scoring

Define 3-6 scored dimensions (e.g. "cites a real ticket ID", "does not fabricate policy details", "matches the declared output schema", "refuses out-of-scope questions") each scored 0/1 or 0-2. Score every golden example against the rubric, by a human or an LLM-judge.

- Works for open-ended or subjective output where exact-match is too strict.
- The rubric itself is the artifact — write it down, version it alongside the prompt, and let it accumulate cases over time.

### 3. LLM-judge prompt

A second prompt (usually a stronger or cheaper-but-well-calibrated model) that takes the task input, the candidate output, and the rubric/golden answer, and returns a pass/fail or score plus a reason.

- Scales past what a human can review by hand.
- Calibrate it: run the judge against a handful of outputs a human has already scored, and check agreement before trusting it as your sole signal.
- The judge prompt is itself a prompt — it needs the same rigor (explicit output contract, few-shot examples of a correct judgment) as the prompt it's judging.

## Minimum bar before shipping

At minimum, before marking `hasEvalCriteria: true` in a prompt spec:

- A committed set of golden examples or a rubric exists somewhere durable (not just in the engineer's head or a scratch chat).
- The set includes at least one adversarial/injection case (see `injection-and-safety.md`) and one out-of-scope case, not only happy-path cases.
- There is a documented way to re-run the check (a script, a judge prompt, or an explicit manual checklist) — "I'll remember to check" is not a criterion.

## Common mistakes

- **Eval set that's all happy path.** A golden set with 10 typical-case examples and zero edge/adversarial cases will pass every regression that matters and catch none of them.
- **No re-run discipline.** Defining golden examples once and never re-running them after a prompt edit is equivalent to not having them.
- **LLM-judge with no calibration.** An uncalibrated judge that agrees with itself is not evidence the prompt works — it's evidence the judge and the prompt share the same blind spot.
