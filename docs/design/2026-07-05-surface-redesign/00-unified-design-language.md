# Unified Design Language — the Triad, Scout, and portdaddy.dev Accounts

**Date:** 2026-07-05 · **Status:** Design target (mockups in `mockups/` are the visual source)
**Grounds:** binder ch. 01/05/06/10/19, `website-v2/docs/design/BRAND.md`, `docs/design/tokens.aaa.css`, ADR-0029/0039/0040/0027, PR #455 story palette, PR #652 surface consolidation.
**Backing skills:** `beautiful-gui-design`, `web-design-expert`, `cooperative-vibe-coding`, `international-code-of-signals` (signal grammar), `adhd-design-expert` (glanceability), `dark-mode-design-expert`.

## Why everything looks generic today

The screenshots (2026-07-04) show three unrelated products: FleetBar is an iOS-white settings popover, pd-console is a navy debug TUI, Control Center is a dark bootstrap admin panel, and Scout ships a fourth ad-hoc palette (rounded, shadowed, off-token). None of them use the identity the repo already owns. The generic look is not a missing design system — it is **four surfaces ignoring the shipped one**.

The repo's real identity, already gated in CI:

- **Substrate:** warm paper `#f2eee6` / warm ebony `#1e1b18` — never flat white, never pure black.
- **Structure:** flat, `2px` hard ink borders do the figure-ground; **no shadows, no rounded corners** (system primitives excepted). Separation = borders + alternating surfaces + spacing on an 8pt grid.
- **Type:** Big Shoulders Display (display), Recursive (sans), Recursive Mono (code/labels/proofs). Hierarchy from weight/scale/case/tracking, never from more families. Body ≥ 14px, AAA where the operator lives.
- **Color as meaning:** the story palette — every hue is a *layer or state*, never decoration. Cobalt `#003fb8` = L0 truth; teal `#006b5f` = L2 legibility; sage = health; violet = identity; rust = reputation; amber = economy/warning; crimson = mayday.
- **Signal grammar:** the six-state ICS flag system (`tokens.aaa.css`): Hotel=claim-active, Foxtrot=awaiting-human, Bravo=burning-cash, Victor=conflict, Delta=blocked, Yankee=claim-stale, Mike=idle, Quebec+`[NEW]`=pratique/newcomer. Status is always **word + flag + color**, never color alone.

## One house, two rooms (resolving the cobalt/mustard fork)

Two "brand primaries" ship today: cobalt (website, vitest-gated) and mustard `#FFDB33` (console, `check-brand-colors`-gated). Resolution — keep both, scope them:

| Room | Surfaces | Accent | Meaning |
|---|---|---|---|
| **Storefront** (public web: portdaddy.dev, accounts, receipts) | website, login, account pages | **Cobalt** `#003fb8` (+teal) | truth/verification — the brand of *receipts* |
| **Operator deck** (the triad + Scout) | FleetBar, Control Center, pd-console, Scout | **Mustard** `#FFDB33` (`accent_ink #8A5A00` for text-on-paper) | attention/consent — the brand of *the conn* |

Shared across both rooms: substrate, borders, type, story palette, ICS signal grammar, spacing. A user moving from portdaddy.dev to FleetBar should feel the same house; the accent shift tells them which room they're in. Mayday crimson `#C41E30` and the status hues are identical in both rooms.

## The laws (apply to every surface, from the binder)

1. **"Scout captures intent. FleetBar grants consent. pd-console shows the truth."** A control that doesn't serve the surface's verb belongs on another surface (deep-link, don't grow panes).
2. **Status = word + flag + color.** "LIVE" only when stream evidence/heartbeat is recent. Six-state glance grammar everywhere an agent appears.
3. **Click-first.** No happy path types an agent id, session id, or worktree path. "If the answer is 'type an ID into a command line,' the surface has failed."
4. **No unenforceable controls.** Observed agents show state, never buttons.
5. **Empty states teach.** Every empty region says what's missing and offers the next action ("No mission cards parsed — add (UNCOMMITTED)/(BLOCKED) tags to your roadmap" beats "All 0").
6. **No walls of identical rows.** Group by status; differentiate tiers ≥1.5× size + weight; the most important fact is the biggest thing on screen.
7. **Cost lives at the consent gate,** not as ambient per-agent anxiety.
8. **≥14px body, AAA on operator surfaces, visible focus, keyboard path for everything.** No emoji as icons — ICS flag glyphs, Lucide, or SF Symbols.
9. **Operator language over taxonomy.** "trusted agent, ready to launch, safety stop, proof of work" — internal terms (`AgentNode`, `C5`, graft) live in inspectors and receipts.
10. **Honest, not Potemkin.** No buttons that do nothing; stale data carries a visible stale marker.

## Per-surface theses (specs live beside the mockups)

- **FleetBar** (`mockups/fleetbar-popover.html`): *the front door is intent.* Four verbs top-to-bottom: intent composer → human gates (the ONLY attention-demanding items) → resume cards → quick actions. The fleet roster and dev-berth list are demoted to a collapsed drawer. Six-state glance strip replaces "16 idle."
- **Control Center** (`mockups/control-center.html`): FleetBar's *deep window face*, not a fourth product. One header row (not three), gates + roster + flow as conjoined panes, budget as a consent object, empty states that teach.
- **pd-console** (`mockups/pd-console.html`): the command room — left rail (saved views), center roster grouped by the six states, right detail with the **live transcript first-class** above the fold; files/claims visible without scrolling past metrics; no `worktree: unknown` debug rows — unknowns render as remediation prompts.
- **Scout** (`mockups/scout-popup.html`): the intake wedge on-token: paper substrate, 2px borders, mustard accent, honest Online/Offline daemon chip, evidence-first layout (screenshot is the hero), deep-link to console for anything beyond intake.
- **Login** (`mockups/login.html`): storefront room. Local-first honesty above the fold ("Port Daddy works without an account"), GitHub OIDC primary, account-key story explicit ("the website never holds your keys"), device pairing with the 4-digit code as a first-class ritual.
- **Account** (`mockups/account.html`): devices (pair/revoke), receipts (`/r/<id>` — the Strava-map of code work), plan/billing with cost caps, harbors (personal→team→guest cards), provider keys, export/delete.
- **Remote harbor co-op** (`mockups/coop-harbor.html`): the vibe-coding-together room — crew presence with roles (operator/voyagers/longshoremen), claims map (symbol/region claims with intent types), parley panel (structured reconciliation, not chat), pratique lane for newcomers (Q + `[NEW]` + reduced ceiling), gates queue, budget consent, all with the stale-marker discipline for remote truth.

## Tokens (mockup-local copy; canonical sources noted)

Storefront: `website-v2/src/styles/tokens.semantic.css`. Operator deck: `docs/design/tokens.aaa.css` + console v12 tokens. Mockups embed local copies — swap for canonical imports at build time. Fonts load from Google Fonts in mockups; production uses `docs/design/fonts/all.css`.
