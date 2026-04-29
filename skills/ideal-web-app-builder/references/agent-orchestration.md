# Agent Orchestration

Use this when the work is larger than a small fix.

## Port Daddy

In Port Daddy repos:

1. Run `pd status`, `pd briefing`, and `pd salvage` if abandoned work might
   matter.
2. Start a session and leave a note describing scope.
3. Claim or lock files for overlapping edits.
4. Use tuples or notes for machine-readable coordination when the task spans
   multiple slices.
5. End with a handoff that records files changed, tests run, and remaining
   risks.

## Plan Discipline

The on-disk plan is the coordination source:

- Copy `templates/pessimistic-plan.md` into the target repo.
- Keep it pessimistic. Include research, design, content, implementation,
  testing, observability, PWA, launch, and cleanup.
- Update it after each completed slice.
- Do not delete deferred work. Move it to explicit later phases with reasons.
- If the user changes scope, update the plan before continuing.

## Sidecar Agents

Only launch subagents when the active environment and user authorization allow
it. Useful sidecars:

- Design archivist: visual database and pattern evidence.
- Competitive cartographer: positioning map and white space.
- Token auditor: scans CSS, Tailwind, components, stories, and generated files.
- Accessibility reviewer: keyboard, screen-reader, contrast, focus, motion.
- Performance reviewer: bundle, hydration, image, font, and Core Web Vitals.
- Content editor: legal pages, blog, SEO, editorial differentiation.
- Adversarial auditor: tries to falsify "done".

Give every sidecar:

- session identity
- purpose
- owned files or read-only scope
- expected output
- quality gates
- what not to touch

## Background and Event-Triggered Agents

Consider always-on or event-triggered agents when they reduce latency or catch
drift:

- file-change token drift scanner
- Storybook visual regression watcher
- accessibility watcher
- bundle budget watcher
- Sentry release verifier
- content freshness checker
- SEO metadata checker

Do not create unbounded spawn loops. Set budgets, singleton behavior, trigger
scope, and failure stop rules.

## Adversarial Review

Use `agents/adversarial-auditor.md` for independent review. The auditor should
lead with failures, not praise:

- raw visual literals
- inconsistent tokens
- inaccessible controls
- missing states
- mobile overlap
- false content
- weak legal pages
- missing observability
- missing Storybook stories
- missing tests
- performance risk
- fake completion claims
