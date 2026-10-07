# Moderation Triage Routing — Changelog

## v1.0.0 (2026-09-19)

- Initial skill creation: severity-tiered queue design, Tier 0 isolation for
  child-safety/imminent-harm content, automatic reviewer context assembly,
  tooling comparison (Directus/Retool/Refine/self-built), and operational
  metrics (turnaround time, false-positive rate, time-per-report) with a
  weekly audit-log export pattern.
- Core process defined as a Mermaid flowchart (intake → triage → routing →
  action → audit log).
- Two anti-patterns encoded: the undifferentiated queue, and the
  vendor-locked core system.
