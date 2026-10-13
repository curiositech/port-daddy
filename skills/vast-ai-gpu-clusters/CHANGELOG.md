# Changelog: vast-ai-gpu-clusters

## [1.0.0] - 2026-09-19

### Added
- Initial canonical release built in accordance with `skill-architect` specification.
- Three-layer progressive disclosure architecture with lean SKILL.md (<500 lines).
- Automated GPU search filtering with bandwidth floors (>200 Mbps) and reliability scores (>0.95).
- Zero-rent immediate teardown protocols to eliminate stopped-instance disk rent bleed.
- Idle watchdog daemon (`scripts/watchdog.sh`) for autonomous GPU self-destruction.
- 4 critical failure modes: Paused Instance Billing Leak, Spot Eviction, Zombie Compute, Ingestion Bandwidth Choke.
- 3 temporal anti-patterns (Novice vs Expert vs Timeline).
- 3 production worked examples covering Spot RTX 4090, A100 cuSPARSE, and 402 spend-cap emergency shutdown.
- Reference deep dives in `references/vastai-cli-cheatsheet.md` and `references/unrolled-sheaf-diffusion-setup.md`.
