# Session Note Templates

Copy the relevant block, fill in the blanks, then write it via:

```bash
pd note --type <progress|decision|blocker|finding|intent|handoff> "<one-line summary>

Why: ...
What: ...
Next: ..."
```

The first line is the summary; the daemon stores the full body. The summary is what shows up in `pd sitrep`.

---

## progress

```
<one-line summary of what just shipped>

Why: <motivation — what triggered this work>
What: <what was actually done; commit SHAs welcome>
Next: <next concrete step>
```

Use after every primitive milestone (a test passing, a route landing, a blocker resolving). `catch_me_up` and salvage rely on these.

## decision

```
<one-line summary of the decision>

Why: <constraint that forced it; alternatives considered>
What: <the chosen path; trade-offs>
Next: <the immediate consequence>
```

High-signal. Future-you will thank you.

## blocker

```
<one-line summary of the blocker>

Why: <root cause as best you understand it>
What: <what you've tried; what the symptom is>
Next: BLOCKED — <what unblocking would look like, or who to ask>
```

The `Next: BLOCKED` prefix is what surfaces this to humans on the dashboard.

## finding

```
<one-line summary of the bug/smell>

Why: <hypothesized root cause>
What: <reproducer; file:line; evidence>
Next: <fix sketch, or "needs human triage">
```

Used by the QA fleet agent.

## intent

```
<one-line summary of what you're about to do>

Why: <why now>
What: <plan>
Next: <first concrete action>
```

Forward-looking — write this **before** touching files, so other agents see your intent on their next sitrep.

## handoff

```
<one-line summary for the next agent>

Why: <why you're handing off — done, dying, scope-cut>
What: <state at handoff: tests green? branch? open files?>
Next: <one or two specific steps for the receiving agent>
```

Specifically targeted at salvage and intentional handoff. Make this great. The receiving agent has nothing else.
