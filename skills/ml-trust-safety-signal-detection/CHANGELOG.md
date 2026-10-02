# ML Trust & Safety Signal Detection -- Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation
- Core process: hash-matching + ML classifier pipeline (Mermaid flowchart)
- Three-tier threshold routing flowchart (no-action / human-review / auto-action)
- Behavioral/velocity/network signal guidance
- Feedback loop requirement (log reviewer verdicts against classifier scores)
- Three anti-patterns: single-threshold auto-action, trusting vendor default
  thresholds, content-classifier tunnel vision
- References: classifier-architecture.md, threshold-tuning.md, behavioral-signals.md
