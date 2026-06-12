# Product Marketing Context — Port Daddy

Read this before any marketing-skill task in this repo.

## What it is
Port Daddy is a local control plane for AI coding agents: a daemon
(localhost:9876) giving Claude Code, Codex, Cursor, Gemini CLI, Aider, and
local models a shared-state substrate — sessions, file claims, notes,
channels, locks, readiness, budgets, salvage. Open source. Mac preview app,
Rust/GPUI console, CLI, MCP server, SDK.

## Who builds it
One person: Erich Owens (Curiositech). Never "the team," never
"Port Daddy Engineering." He builds it by operating the thing it sells —
a fleet of agents running on his own Claude Max subscription.

## Two audiences, one site
1. **Practitioners** (staff/senior engineers running coding agents): they
   arrive from search or HN with a coordination pain — agents clobbering
   each other, lost work, port collisions. They want primitives and proof.
2. **People who might hire/engage Erich** (EMs, founders, VPs): they arrive
   from a forwarded link. The site is a hiring surface. The conversion is
   "one engineer shipped ALL of this by running agent fleets" →
   erichowens.com ("Work with me" footer funnel, shipped 2026-06).

## Voice (non-negotiable)
Erich's voice: high-low register collisions, em-dash asides, wild analogies,
lists with personality, self-deprecation as ballast. BANNED: rule-of-three
decorative triads, "not just X but Y", buzzword verbs (leverage/unlock/
delve/elevate), hedge-aspiration ("aims to"), vague-future mood words.
Specifics, numbers, and file paths over adjectives. Blog posts are
cold-open: the reader has never heard of Port Daddy.

## Proof assets
- 17+ deep technical blog posts (flat-blueprint illustrated, Tufte sidenotes)
- The papers: "The Legible Swarm," "The Single-Writer Kernel" (TikZ figures,
  ProVerif/TLA+ verified protocol work)
- Relay v0: zero-trust Cloudflare worker, 3 red-team rounds, 14 vulns fixed
- pd-console: Rust/GPUI operator console
- 3,200+ tests, hundreds of merged PRs, all shipped by the fleet
- The subscription economics: $20–200/mo seat powers the whole fleet at $0
  marginal cost (claude-cli + codex as first-class backends)

## Competitors / landscape
No direct "local agent control plane" incumbent. Adjacent: agent frameworks
(LangGraph, CrewAI — orchestration, not coordination), terminal multiplexers,
CI bots. The differentiated claim: coordination enforcement (guard blocks
commits without notes/claims) and salvage (work survives dead agents).

## Goals, in order
1. Make EMs/founders want to hire or engage Erich (site → erichowens.com)
2. Practitioner adoption (brew install, GitHub stars, MCP installs)
3. Authority: be the citable source on multi-agent coordination
