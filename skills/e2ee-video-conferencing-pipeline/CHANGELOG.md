# Changelog: e2ee-video-conferencing-pipeline

## v1.0.0 (2026-09-19)

- Initial skill creation, based on 4-agent research pass covering E2EE
  patterns, codec/SVC/transport selection, premium-feature E2EE
  compatibility, and Zoom/Telegram/Discord/Meet internals (including
  corrections: Zoom uses a custom protocol not MLS; Telegram's E2EE group
  calls shipped April 2025 as "Conference Calls"; Discord's DAVE protocol
  makes E2EE the mandatory default, not opt-in).
- Core decision tree, key-management pattern comparison, codec/transport
  guidance, and the rekey-cost calculator script.
