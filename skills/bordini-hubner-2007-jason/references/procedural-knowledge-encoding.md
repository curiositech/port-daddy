# Encoding procedural knowledge as plans

The source bundle’s central practical lesson remains: separate a trigger, context, and compact plan body rather than accumulating all cases in one procedure. Split plans when the contexts have different evidence or failure treatments, not because a universal branch-count threshold was crossed.

Keep effects at named action boundaries and make their errors explicit. Plan syntax can organize an attempt; it cannot supply authority to alter an external system.

## Plan-library procedure

Write one plan as `trigger : context <- body.` and split it when contexts have different evidence, effects, or recovery. For each event, list relevant plans, context evidence, effect boundaries, failure handler, and unmatched disposition. If overlap is intentional, publish the selected policy; Jason exposes custom `selectEvent`, `selectOption`, and `selectIntention` functions, so do not call first-applicable selection universal.

Use documented interleaving/singleton patterns when a goal must serialize: `.intend`, `.suspend`, `!!resume`, and short `atomic` regions are tools with reactivity costs. Jason [programming patterns](https://jason-lang.github.io/jason/tech/patterns.html) and [API 3.3.0](https://jason-lang.github.io/api/), accessed 2026-09-24, support those choices.
