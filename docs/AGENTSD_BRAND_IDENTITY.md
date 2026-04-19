# agentsd Brand Identity

Last updated: 2026-04-11
Status: Quarantined brand brief for a possible `agentsd.ai` public surface
Authoring session: `port-daddy:agentsd-shell-audit`

This document is design-target research, not authority for the current live `website-v2` branding or route structure.
Promote it intentionally before treating any of its rules as implementation requirements.

## Brand Position

Public brand:

- `agentsd`
- `agentsd.ai`

Internal implementation language may continue to use:

- `port-daddy`
- `pd`

That split is intentional. Public brand should read as infrastructure. Internal implementation can keep the older lineage until runtime/package migration is worth the churn.

## What The Brand Must Signal

- control plane, not novelty CLI
- precise infrastructure, not “AI vibes”
- verified and technical, not magical
- local-first with serious systems discipline
- ready to grow into delegation, policy, and economic rails

It must not signal:

- pirate mascot energy
- cute devtool whimsy
- generic agent startup gradients
- “move fast with AI” fluff

The maritime frame may survive inside product vocabulary where it helps, but it is no longer the public face.

## Core Voice

The brand voice should feel:

- declarative
- exact
- cold-confidence
- technical without apology

Avoid:

- “revolutionary”
- “supercharge”
- “magical”
- “delightful AI”
- mascot banter

## Visual Direction

Primary visual direction:

- Swiss modern structure
- neobrutalist force
- technical editorial restraint

Practical consequences:

- large typographic arguments
- rigid grid
- hard rules and borders
- warm paper field instead of flat white
- one electric cool accent
- one acidic highlight accent, used sparingly
- mono reserved for metadata, code, proofs, and protocol surfaces

## Typography

Use one dominant sans family and one mono family.

Rules:

- the sans carries both display and body
- the mono carries commands, labels, proofs, and reference metadata
- hierarchy comes from weight, scale, case, and spacing, not from many families
- optical sizing matters; use faces with real variable support when practical

If budget exists, spend it on typography first.

Recommended asset priority:

1. primary grotesk/display license
2. mono license
3. diagram system
4. icon set tuning
5. secondary illustration work

## Color System

Base palette:

- paper
- ink
- signal blue
- acid lime

Semantic meaning:

- ink = authority, frame, structure
- paper = editorial field, calm base
- signal blue = active, verified, runtime/system state
- acid lime = registry, selected state, CTA, highlighted proof

Rules:

- lime is scarce and intentional
- blue may occupy larger surfaces
- body copy does not depend on accent color
- contrast beats brand flourish

## Logo Direction

The current `PortDaddyMark` in `website-v2/src/components/PortDaddyMark.tsx` is not the public `agentsd` logo.

Why:

- too illustrative
- too mascot-forward
- too tied to the old maritime persona
- too detailed for infrastructure contexts

It can survive internally or as historical residue. It should not front `agentsd.ai`.

### Requirements

The new logo must be:

- geometric
- scalable down to favicon size
- legible in one color
- credible in docs, nav, splash, social preview, and terminal contexts
- compatible with a severe wordmark lockup

### Recommended Directions

#### 1. Split Monogram

Build a strict `A`/`D` monogram.

- square or implied-square frame
- `A` as structure
- `D` as enclosure / daemon / control plane

This is the safest direction.

#### 2. Register Mark

Abstract the daemon/control-plane idea into a register glyph.

- framed bars
- one active cell
- reads like routing, registry, or control-plane state

This is the best direction if the product narrative stays centered on orchestration and state.

#### 3. Proof Stamp

Use a boxed validation/stamp language.

- strong borders
- minimal geometric center
- feels like verification without becoming a checkmark logo

This is the best direction if formal verification stays central to the public story.

### Explicitly Avoid

- anchors
- ships
- captain characters
- literal port icons
- generic spark/orb AI marks
- gradient “agent platform” logos

## Immediate Rule

Until the new logo exists:

- use the `agentsd` wordmark as text
- use a simple square or monogram placeholder if an icon is required
- do not silently reuse the old Port Daddy mark in public agentsd surfaces

## If We Pay A Designer

The brief should request:

- logo system: mark, wordmark, lockups, favicon
- type recommendation or pairing
- token palette
- diagram grammar for architecture and proof pages
- section rhythm for landing/docs/reference
- Storybook-friendly component styling guidance

The brief should not ask for:

- a giant bespoke illustration suite before the site contract is enforced
- lots of decorative assets before docs architecture is stable
- mascot work
