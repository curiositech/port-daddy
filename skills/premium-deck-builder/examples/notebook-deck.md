# Worked Example: The Notebook Interview Deck

The 15-slide ET-Book-style deck built for a Staff+EM applicant interviewing at OpenAI and Anthropic. Walks through every decision the skill names.

## Where it lives

- **Build script**: `~/coding/some_claude_skills/erichowens_com/scripts/build_interview_deck.py`
- **Output**: `~/coding/some_claude_skills/erichowens_com/interviews/erich-owens-comment-ranking-spaces.pptx`
- **Rendered PNGs**: `~/coding/tmp/deck-render/v2-slide-*.png`

## The brief

- **Audience**: OpenAI / Anthropic interview loop (Staff+ IC + EM track).
- **Mode**: PITCH (15 slides, 30–45 min slot, with discussion).
- **Aesthetic**: engineer's notebook / graph paper, matching the candidate's portfolio website (which uses ET Book + General Sans + Geist Mono + Homemade Apple).
- **Tone**: editorial, restrained, signals taste + technical depth without performing either.

## Decisions applied from the skill

### Mode → PITCH (not LIVE, not SLIDEDOC)
- 15 slides covering bio + 2 case studies + mission-fit + closer.
- Body text targets 15–20pt (defensible for screen-share to interviewer + light bullet density).
- The deck is meant to be SHOWN in the loop, not handed around as a memo. If reused as a leave-behind, the candidate exports to PDF.

### Composition → Assertion-Evidence + Consulting executive-summary box
- Every content slide has a sentence-headline title (NOT a topic phrase).
  - GOOD: "Thompson sampling + embeddings, in 2015."
  - BAD: "Approach"
- Sub-headlines in red mono indicate the structural beat (EXPLORE vs EXPLOIT / EMBEDDINGS FOR RELEVANCE / etc.)
- Bullets only where content is genuinely enumerable; otherwise a pull-quote callout.

### Typography → Georgia + Helvetica Neue + Menlo
- ET Book (the portfolio's actual face) was the first choice; Georgia is the universally-available stand-in. The user opens the deck on someone else's Mac or PowerPoint Windows machine → Georgia renders correctly everywhere.
- Eyebrow / fig. labels / margin notes use Menlo (mono, system-available on Mac; PowerPoint substitutes Consolas on Windows).
- Three faces total — under the cap.

### Color discipline → 3 colors
- **Paper** (`#FAF7F0`): background.
- **Ink** (`#1A2540`): all body and titles.
- **Red** (`#B8392B`): single accent — punctuation marks (the period after "Comment ranking."), section numerals (huge italic 02 / 03), margin annotations, the underline under the most-important metric.

No other colors. Cover and dividers visible grid uses two near-paper tints of blue (also barely-perceptible).

### Grid → dense on cover/dividers, near-invisible on content
- This is the lesson the user caught me on: web alpha-grid translated to PPTX opaque was way too dark and competed with text. Now:
- Cover + section dividers: `dense=True` → 0.25" fine, every-5th bold. The grid IS the visual.
- Content slides: 0.5" fine, every-4th bold, in pre-composited near-paper hex (`#EDEEEC` for fine, `#D8DDE6` for bold). Sits at the edge of perception.

### Margins → 8% rule
- `MARGIN_L = MARGIN_R = Inches(0.65)` on a 13.333" wide slide = 4.9% per side. Slightly tight; could go to 0.8" for more breathing room.
- `MARGIN_T = Inches(0.55)`, `MARGIN_B = Inches(0.55)`.

### Slide types used (8 of the 10 catalog types)
| Slide | Type |
|---|---|
| 01 | Title |
| 02 | Content (assertion-evidence bio) |
| 03 | Section divider |
| 04–07 | Content (assertion-evidence × 4) |
| 08 | Section divider |
| 09–12 | Content × 4 |
| 13 | Content (why-I'm-here) |
| 14 | Content (NASA bonus) |
| 15 | Closer / Q&A |

Not used: Comparison split, Image-led full-bleed, Quote (the margin notes serve as inline quote callouts), Transitional, Agenda. Acceptable for a 15-slide pitch — every type is a choice not a default.

### Anti-patterns avoided
- No "Thank you / Questions?" final slide — instead: "What would you like to dig into *first*."
- No topic-phrase titles — every content title is a sentence with a verb / conclusion.
- No template defaults — built from blank slides with explicit token system.
- No rainbow chart palette — there are no charts in this deck; if there were, single accent only.
- Stack uses system-safe fonts (Georgia / Helvetica Neue / Menlo) — no embedded foundry fonts, so will render correctly on any client's PowerPoint.

## Verification pipeline applied

After every `python3 scripts/build_interview_deck.py` run:

```bash
# 1. Render to PNGs and ACTUALLY LOOK
~/.claude/skills/premium-deck-builder/scripts/render_deck.sh \
  interviews/erich-owens-comment-ranking-spaces.pptx \
  ~/coding/tmp/deck-render

# 2. Programmatic audit
python3 ~/.claude/skills/premium-deck-builder/scripts/check_deck_quality.py \
  interviews/erich-owens-comment-ranking-spaces.pptx
```

The render verified the grid fix from FM-1 (web → PPTX alpha translation). The audit caught 2 real legibility errors (10/11pt text on bio + closer that needed bumping to ≥14pt).

## What this example teaches

1. **PITCH mode is its own thing** — not live, not slidedoc, with its own size + density tradeoffs.
2. **Match the deck's voice to the candidate's other surfaces** — if their portfolio is editorial-engineer's-notebook, the deck should be too. Foundry-font portfolio + corporate-default deck reads as careless.
3. **Translate visual tokens with care between mediums** — CSS alpha grids → opaque PPTX is the canonical case (FM-1). Always pre-composite, sparser density, thinner strokes.
4. **Render-and-look beats trust-and-ship** — the audit script confirms structural rules; only the PNGs catch "text vs background" legibility.
5. **System-safe fonts are not a compromise** — Georgia + Helvetica Neue + Menlo carry the same editorial character as ET Book + General Sans + Geist Mono on the website, and survive the round-trip onto every interviewer's machine.

## Reusing this pattern

To adapt for another candidate or topic, copy the build script and edit:
- `COMMENT_RANKING_SLIDES` and `SPACES_AVATARS_SLIDES` → your case-study blocks.
- `WHY_HERE_SLIDES` → your mission-fit narrative.
- Token block at top (PAPER / INK / RED) → your brand.
- `FONT_DISPLAY` / `FONT_BODY` / `FONT_MONO` → match your portfolio.

The slide-builder functions (`build_title`, `build_bio`, `build_section_divider`, `build_content_slide`, `build_qa`) are reusable as-is for any pitch / interview deck.
