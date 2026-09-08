# PR-4 — Blog + examples

**Branch name:** `voice-design-pr4-blog-examples`
**Worktree path:** `~/coding/port-daddy/.claude/worktrees/voice-design-pr4-blog-examples`

## Files you own (and ONLY these)

- `website-v2/src/pages/BlogPage.tsx`
- `website-v2/src/pages/BlogPostPage.tsx`
- `website-v2/src/data/blogMetaData.ts` (12 entries — voice the
  excerpts; bylines were already fixed in #42)
- All MD/MDX files under `website-v2/src/blog-posts/` if they exist;
  otherwise the post bodies live in another data file — find it
- `website-v2/src/pages/ExamplesPage.tsx`
- `website-v2/src/pages/ExampleDetailPage.tsx`
- `website-v2/src/data/examples.ts` if it exists

## What to do

1. **Voice pass** — biggest concentration of teaching writing on the
   site. The blog post excerpts in `blogMetaData.ts` are the highest
   leverage edit (they appear on the index, in OG cards, in search
   results). Make every excerpt punchy in Erich's voice.
2. **Design pass** — blog index card styles, examples grid card
   styles. Color block where it makes sense.
3. **Don't touch the MDX bodies** unless you find a clearly broken
   passage; the blog post bodies are long-form authored content. Stick
   to titles, excerpts, and the wrapping page chrome.

## Validation gates + PR template

- Screenshots of /blog and /examples in `.scratch/`
- All blog excerpts read in Erich's voice (compare to whitepaper
  glossary entries — same register)
- Bylines remain "Erich Owens" / "Erich Owens, with Thomas Youle
  (Indiana University)" — do not regress
