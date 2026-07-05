# Multi-Agent Authoring Product Bar

Define and measure the product-quality bar a multi-agent authoring tool must
clear before its own makers reach for it over Claude Code or Codex for real
work.

Use this skill when you need to audit whether a swarm/console feature is
ready to replace an incumbent, sequence roadmap priority between
single-agent inner-loop parity and coordination-plane work, or check whether
a "we dogfood our own tool" claim is honest or a vanity metric in disguise.

## Quick Start

1. Read `SKILL.md`.
2. Load `references/table-stakes-and-differentiators.md` for the par rubric
   and what "real" means per differentiator axis.
3. Load `references/dogfood-stickiness-signals.md` for the comeback-trigger
   vocabulary and how to collect an honest stickiness signal.
4. Fill `templates/output-template.md` for the product at hand, or write a
   self-assessment matching `schemas/product-bar-spec.schema.json` directly.
5. Run `node scripts/dogfood_bar.mjs --input assessment.json`.

A self-assessment that scores `pass: true` should mean table-stakes parity
holds, enough coordination differentiators are real (not Potemkin), and the
stickiness signal is honest. If it doesn't, fix the product, not the
self-assessment.
