# Visual design tells — the v0/Lovable look and generated imagery

What makes a UI, slide, or image read as generated: the defaults nobody chose, clustering together. Read the currency line on every item here — the image-forensics advice in particular has a short shelf life, and some of it has already expired.

_17 items. Generated from catalog.json — edit there, then re-run `scripts/regenerate_references.py`. Do not hand-edit this file._

_Every item carries a **False positive when** line. Read it before you act on the item: these are cues for an editor, not evidence about an author._

<!-- humanize:ignore-start
     Everything below is a specimen catalog. It quotes the tells it documents,
     including literal machine residue, so reviewing it with humanize_review.py
     would flag the exhibits rather than the writing. -->

### `centered-hero-three-card-skeleton`  ·  high · generic-llm · layout · structural · family: visual

The whole-page template: centered badge pill ('Now in beta'), giant centered headline with one gradient word, one-line subhead, two buttons (solid + ghost), then a 3-column grid of icon-title-blurb cards (icons often emoji). Section order and centering are near-identical across generated sites.

**Why it reads AI:** This is the statistical mean of every landing page in the training set; generators reproduce the skeleton verbatim. The giveaway is that the structure, not just the styling, is interchangeable with a thousand other AI sites.

**Detect:** structural: DOM-pattern match a hero with text-align:center, a pill above an h1, an h1 with a gradient span, a subhead, exactly two sibling CTAs, then a grid-cols-3 of 3-4 icon+heading+paragraph cards. The full sequence co-occurring is the tell.

**Fix:** Break the symmetry: asymmetric/left-aligned hero, a product screenshot or demo doing the talking, one primary CTA, and feature sections with varied layouts (alternating media-text rows, a bento grid) rather than a uniform 3-up.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Centered 'Now in beta' pill -> 'The future of <gradient>work</gradient>' -> subhead -> Get started + Learn more -> 3 identical icon cards.

**After**

> Left-aligned hero with a live product canvas on the right, one CTA (Start building), then an alternating sequence: a wide demo, a 2x2 bento of differentiated capabilities, a metric strip.

### `emoji-as-ui-icons`  ·  high · generic-llm · iconography · structural · family: visual

Emoji stand in for a real icon system: rocket in 'Get started' buttons, check bullets in feature lists, lock next to 'Secure,' lightning for 'Fast.' Rendered as OS emoji glyphs rather than SVG icons.

**Why it reads AI:** Emoji as UI elements vary per OS, don't inherit color, and can't be sized to the grid; no design system ships them as iconography. It's the fastest visual giveaway of zero design investment.

**Detect:** structural: scan rendered text nodes and button labels for emoji codepoints in UI chrome (U+1F300-1FAFF, U+2600-27BF, U+2705, U+1F680, U+26A1, U+1F512). Any emoji codepoint inside a button, nav, feature-card title, or list marker is a defect; distinguish from user-generated content.

**Fix:** Replace every UI emoji with a consistent SVG icon set (Lucide, Heroicons, Phosphor). Icons inherit currentColor and share stroke weight. Reserve emoji for actual content.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Feature card: 🚀 Lightning fast / 🔒 Bank-grade security / ✅ No setup required; CTA reads Get started 🚀.

**After**

> Feature card: a 20px Lucide Rocket, ShieldCheck, Check icon in brand color above each title; CTA reads Get started with an inline ArrowRight SVG.

### `identical-face-different-people`  ·  high · generic-llm · web-ui · llm-judge · family: visual

Across 'different' avatars or testimonial photos, the same underlying face recurs — same bone structure, eye spacing, smile — with only hair/clothes swapped, plus a shared teal-and-orange grade and creamy bokeh across all images.

**Why it reads AI:** A diffusion model collapses toward an attractive mean face, so a batch of generated people look like siblings. The shared grade and identical bokeh confirm one generator made them all.

**Detect:** llm-judge: 'Do the supposedly distinct people share one mean face with cosmetic variation, and do all images share an identical color grade and depth-of-field, indicating one generator produced them?'

**Fix:** Use distinct real people. If generating, vary seeds/prompts hard and verify faces are genuinely different, or avoid faces entirely. Diversify color grade and depth-of-field.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Four testimonial avatars that are visibly the same face with different hairstyles, all teal-orange graded with identical background bokeh.

**After**

> Four genuinely distinct licensed portraits with varied lighting, framing, and color treatment — or four monogram/initial avatars instead of faces.

### `invisible-unicode-artifacts`  ·  high · chatgpt · typography · structural · family: residue

Invisible or near-invisible codepoints left in the text: U+202F narrow no-break space (characteristically wrapped around em dashes), zero-width space, word joiner, byte-order mark, soft hyphen.

**Why it reads AI:** This is residue, not style. Its presence means the text was pasted out of a model's rendered output rather than typed, which is a fact about provenance rather than an inference about taste.

**Detect:** Count the codepoints. U+202F is the strongest single countable tell available: no mainstream keyboard layout produces it and no word processor inserts it around a dash.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Normalize whitespace before judging anything else: U+202F and U+00A0 to a plain space, zero-width characters deleted. Then re-read, because the prose problems are separate.

**False positive when:** Typeset documents legitimately use U+00A0 (and French typography uses U+202F before high punctuation by convention). Exclude markup files where &nbsp; is deliberate, and exclude French-language copy from the U+202F rule entirely.

**Evidence:** Catalogued by Wikipedia's WikiProject AI Cleanup among formatting-residue signs.

**Before**

> A sentence — with residue in it.

**After**

> A sentence — with the residue removed.

### `purple-blue-gradient-text-headline`  ·  high · generic-llm · color · structural · family: visual

The headline (or one hero word) uses a linear-gradient clipped to text running indigo-to-violet or violet-to-cyan, with the same gradient on hero buttons and blobs. The 'gradient word' in an otherwise solid headline is a signature move.

**Why it reads AI:** Gradient text was a 2021-2023 SaaS trend the models over-learned; combined with indigo-violet stops it screams template. Real brands use gradient text sparingly with custom stops.

**Detect:** structural: look for `background: linear-gradient(...); -webkit-background-clip: text; color: transparent` or `bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent`, with gradient stops in the indigo/violet/blue hue range (H 220-280). Presence on the H1 is the tell.

**Fix:** Make the headline a solid, confident color. If a gradient is truly wanted, use unexpected stops tied to brand and apply it to one deliberate element, not every accent.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> <h1>Build <span class='bg-gradient-to-r from-indigo-500 to-fuchsia-500 bg-clip-text text-transparent'>faster</span></h1> with a matching gradient CTA.

**After**

> <h1>Build faster</h1> in solid near-black; a single restrained accent underline in the brand terracotta; buttons are flat brand fill.

### `tailwind-indigo-default-palette`  ·  high · generic-llm · color · structural · family: visual

The most reliable web AI-ism: the brand/primary color is Tailwind's default indigo-500 #6366F1 (or violet-500 #8B5CF6, blue-500 #3B82F6). Buttons, links, focus rings, and accents land on the unmodified Tailwind palette.

**Why it reads AI:** Defaults cluster. The causal story is credible and the origin is on the record — Tailwind's creator has said publicly that making every Tailwind UI button indigo-500 is why generated UI is indigo — but no published study has measured font or color defaults in generated interfaces. State the mechanism, not a frequency.

**Detect:** structural: scan CSS/computed background-color of primary buttons for exact hex #6366F1, #8B5CF6, #4F46E5, #3B82F6 or classes `bg-indigo-500/600`, `bg-violet-500`; also flag any primary/accent in the indigo-violet hue band (~250-275deg). Exact-hex match against the Tailwind default ramp is a high-precision signal.

**Fix:** Define a bespoke brand hue — shift H/S/L off the default ramp, build a custom 50-950 scale, and never ship the literal #6366F1. Even rotating 20-40 degrees of hue and adjusting saturation breaks the tell.

**False positive when:** Indigo is a legitimate brand color that predates all of this, and a design system may have chosen it deliberately years ago. The tell is indigo co-occurring with Inter, a gradient headline, and rounded-2xl — never indigo alone.

**Confidence:** anecdotal

**Evidence:** Adam Wathan (Tailwind CSS), public statement, August 2025. Anecdotal origin, not a measurement — do not cite a study, because there isn't one.

**Before**

> Primary CTA bg-indigo-600 hover:bg-indigo-700, links text-blue-500, focus ring ring-indigo-500.

**After**

> Custom brand token --brand: oklch(0.62 0.17 28) (a warm terracotta) with a hand-tuned scale; CTA, links, and focus ring all derive from it; zero default-Tailwind swatches.

### `ai-default-token-repetition`  ·  medium · generic-llm · web-ui · structural · family: visual

Utility-class tokens repeated across every surface: backdrop-blur, rounded-2xl, bg-gradient-to-r, bg-clip-text, from-indigo, bg-grid-, animate-pulse.

**Why it reads AI:** The unstyled style of generated UI: the treatment was applied everywhere rather than designed once. Defaults cluster, and the cluster is the tell, not any single token.

**Detect:** Count occurrences of each token in markup. These are structured code identifiers, so counting them is not free-text classification.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Keep each effect where it earns its place. Design one deliberate surface treatment and reuse that one.

**False positive when:** A design system that deliberately standardizes on a radius token will repeat it everywhere, correctly. Check whether a token file defines the choice.

**Evidence:** Observed across v0/Lovable/Bolt output; see the AI Design Slop catalog in sources.

**Before**

> Every card: rounded-2xl backdrop-blur bg-gradient-to-r

**After**

> One elevated surface with a chosen radius and a real shadow; everything else flat.

### `badge-pill-now-in-beta`  ·  medium · generic-llm · web-ui · structural · family: visual

A small rounded-full pill above the headline with a tiny dot or sparkle and text like 'Now in beta,' 'Introducing X,' or 'New.' Subtle border, muted background, centered — the reflexive hero garnish.

**Why it reads AI:** The announcement pill is a Linear/Vercel-ism every generator prepends to heroes automatically, whether or not there's anything to announce. Its presence as default garnish signals templated output.

**Detect:** structural: detect a rounded-full inline-flex element directly preceding the h1 with a small status dot/icon plus short text (often border-white/10 bg-white/5 text-xs). Its position above a centered h1 plus pill styling is the pattern; also flag text-xs here as failing the 14px legibility floor.

**Fix:** Only show an announcement pill when there is a genuine linkable announcement, and make it a real link. Otherwise delete it. If kept, ensure label text is >=14px or a proper >=600-weight uppercase eyebrow, not text-xs.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> <span class='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs'>✨ Now in beta</span> above the centered h1, linking nowhere.

**After**

> Either no pill, or a real link pill at 14px to a dated launch post: 'Read: v2 is live ->' — and only when that post exists.

### `curly-straight-quote-mixing`  ·  medium · generic-llm · typography · structural · family: residue

Straight and curly quotation marks or apostrophes both used within one document.

**Why it reads AI:** Two sources were pasted together. Typed text uses whatever the editor produces; model output uses the other. Consistency is the default within any single writing process.

**Detect:** Count straight vs curly singles and doubles; flag when both appear at least twice.

**Thresholds** (read by `scripts/humanize_review.py`): `min_of_each` = 2

**Fix:** Normalize to one style across the document, then keep it.

**False positive when:** Code samples and technical documentation legitimately mix, because code requires straight quotes and prose wants curly. Exclude fenced regions before counting — the detector does.

**Evidence:** Widely-reported paste artifact; corroborates the invisible-codepoint family.

**Before**

> The team's “big bet” was the company's "only bet".

**After**

> The team's “big bet” was the company's “only bet”.

### `dark-mode-radial-glow-blobs`  ·  medium · generic-llm · color · structural · family: visual

Dark-mode-by-default near-black background (#0A0A0A / slate-950) decorated with large blurred radial-gradient glow blobs in indigo/violet/cyan bleeding from the corners, plus a faint grid or dot overlay.

**Why it reads AI:** Linear/Vercel-style dark hero with ambient purple glows is the default 'looks expensive' move. When every AI site has the same two violet smudges on near-black, it reads as templated.

**Detect:** structural: detect a body background near #000-#0B0F1A combined with absolutely-positioned divs carrying `radial-gradient` + heavy `blur()` (>60px) in indigo/violet/cyan, and/or a repeating grid/dot background SVG. The dark-bg + corner glow-blob + grid-overlay triple is the signature.

**Fix:** Justify the color mode by the product. If dark, build a real neutral scale and use lighting with intent; drop the corner glow-blobs or replace with a meaningful brand visual. Consider light or a distinctive non-black dark.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> bg-slate-950 with two blur-3xl violet/indigo radial blobs top-left and bottom-right and a faint dot-grid overlay behind the hero.

**After**

> Warm off-white (#F7F5F2) light theme with a single hand-made hero illustration; or a deliberate deep-green dark theme with one structural light source and no ambient glow blobs.

### `glassmorphism-card-stack`  ·  medium · generic-llm · web-ui · structural · family: visual

Cards use the identical recipe: semi-transparent fill, backdrop-blur, rounded-2xl/3xl corners, soft drop shadow, and a 1px white-at-10%-opacity inset border. Every card shares the exact token combo.

**Why it reads AI:** It's the default 'premium' card generators emit, copy-pasted across v0/Lovable output. Real systems vary radius, elevation, and surface treatment by component role.

**Detect:** structural: flag the co-occurring quadruple `backdrop-filter: blur` + `border-radius: 16-24px` + `border: 1px solid rgba(255,255,255,0.1)` + soft box-shadow + `background: rgba(...,0.05-0.1)` (Tailwind `backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl bg-white/5`).

**Fix:** Choose a surface treatment that fits the brand and vary radius/elevation by hierarchy. If using glass, restrict it to one intentional layer (a sticky nav), not every card.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Every feature, pricing, and testimonial card: bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl.

**After**

> Feature cards flat with a 1px solid neutral-200 border and 8px radius; the 'popular' pricing card steps up to a real elevation-3 shadow and solid surface; no backdrop-blur except the pinned header.

### `inter-geist-default-typeface`  ·  medium · generic-llm · typography · structural · family: visual

AI site builders default to Inter (or Vercel's Geist) for every text role with no contrasting display or serif face. Sora, Manrope, and Space Grotesk are the secondary fallbacks that signal the same generator.

**Why it reads AI:** Human designers almost always pair a display face with a text face or pick a typeface with brand intent. One geometric grotesk doing 100% of the work is the statistical-average choice.

**Detect:** structural: inspect computed font-family on h1/h2/body/button. Flag a single family (Inter/Geist/Sora/Manrope/Space Grotesk) used across all text roles with zero pairing; grep CSS for `font-family:.*Inter`, `--font-geist`, `next/font/google` importing Inter. One family doing every job is the signal.

**Fix:** Pair an opinionated display face for headlines with a neutral text face for body, or commit to one face but vary weight/optical-size/tracking with intent. Anything but unmodified Inter-everywhere.

**False positive when:** Inter is a genuinely good UI typeface chosen deliberately by many teams, including before generative tooling existed. It is only a tell inside the default cluster.

**Confidence:** anecdotal

**Before**

> All headings, body, and buttons render in font-family: Inter, sans-serif at weights 400/500/600.

**After**

> Headlines in a high-contrast serif (e.g. GT Sectra) at 600; body in Inter at 400 with -0.011em tracking; clear hierarchy between display and text.

### `mixed-icon-sets-one-view`  ·  medium · generic-llm · iconography · structural · family: visual

A single view mixes icon vocabularies: some Lucide line icons, some Heroicons solid, a couple of emoji, maybe a Font Awesome glyph — different stroke weights, corner radii, and fill styles side by side.

**Why it reads AI:** Generators pull icons from whatever import is handy per snippet, so a page accretes mismatched sets. Humans standardize on one family and weight.

**Detect:** structural: inventory icon sources in the DOM (lucide-react, @heroicons, react-icons/fa, emoji codepoints, inline SVGs with differing stroke-width). More than one icon system in a viewport, or mixed stroke-width among adjacent icons, is the tell.

**Fix:** Standardize on a single icon library and one style (e.g. Lucide, 1.5px stroke, 24px grid) across the app. Remove emoji from UI. Audit every icon for shared weight, size, and alignment.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Feature row pairs a Lucide outline Zap (stroke 2), a Heroicons solid LockClosed, and a 🔒 emoji — three visual languages in one line.

**After**

> All three are Lucide outline icons at 24px / 1.5px stroke in brand color, optically centered on a shared baseline.

### `sparkle-motif-for-ai`  ·  medium · generic-llm · iconography · structural · family: visual

The four-point sparkle (Lucide Sparkles, Material's AI sparkle) slapped on anything AI-related: 'AI' badges, generate buttons, magic-wand affordances, and decorative confetti around headlines.

**Why it reads AI:** The sparkle became the universal, unimaginative shorthand for AI 'magic.' Reaching for it signals the design followed the herd rather than inventing a brand-specific affordance.

**Detect:** structural: detect U+2728, Lucide Sparkles/Sparkle/WandSparkles usage, or four-point-star SVG paths near text containing 'AI'/'generate'/'magic'. Count sparkle glyphs per view; any on an AI feature is the cliche, multiple is severe.

**Fix:** Design a distinct affordance for AI actions — a custom glyph, a labeled button, a motion cue. If a sparkle is unavoidable, make it bespoke and use it once.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> <button>✨ Generate with AI</button> plus floating ✨ sparkles scattered around the hero headline.

**After**

> <button>Generate</button> with a custom monoline glyph unique to the product; no decorative sparkles; the AI capability is communicated by a short label and a subtle hover shimmer.

### `stock-mesh-gradient-background`  ·  medium · generic-llm · color · structural · family: visual

The hero or full-page background is a soft multi-stop mesh gradient (pink-purple-blue-teal blend), often the literal default from a mesh-gradient generator, used as decoration unrelated to the brand.

**Why it reads AI:** Mesh gradients had a moment, so models emit them as instant 'modern' backdrop. A pastel mesh that doesn't echo any brand color is decoration-by-default.

**Detect:** structural: detect large conic/radial multi-stop gradients or a mesh-gradient SVG/PNG covering the hero with 3+ pastel stops in the magenta-violet-blue-cyan range, frequently with blur.

**Fix:** Make the background earn its place: a solid brand-tinted surface, a real product visual, a subtle texture, or a gradient built from actual brand colors. Avoid the default rainbow-pastel mesh.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Full-bleed hero behind the headline is a blurred pink-to-purple-to-cyan mesh gradient lifted from a generator preset.

**After**

> Hero sits on a flat warm-neutral surface with a single duotone product screenshot; any gradient uses only the two brand hues at low contrast.

### `ai-image-waxy-skin-mangled-hands`  ·  low · generic-llm · web-ui · llm-judge · family: visual

**Currency:** ⚠ OBSOLETE — retained as a caution, not as a test.

OBSOLETE AS A PRIMARY TEST. The 2022-2024 image giveaways — six-fingered hands, garbled signage, asymmetric eyes — are largely fixed in 2025-26 models. Repeating this advice now produces confident wrong answers in both directions.

**Why it reads AI:** It frequently no longer does, which is the point of this entry. Detection guidance moved to provenance-first methods precisely because visual-artifact heuristics stopped working.

**Detect:** Do not lead with anatomy. Lead with provenance: C2PA / Content Credentials, EXIF and capture metadata, reverse image search for an earlier appearance, and the publisher's own sourcing. Residual visual signal survives only in hard cases — closed fists, interlaced fingers, dense text-rich scenes, crowds in the mid-ground — and in tonal artifacts such as the amber cast and default shallow-depth-of-field bokeh.

**Fix:** Check provenance before appearance. If the image is yours to fix, the editorial question is unchanged: does this picture show something true, and would a real photograph have been better?

**False positive when:** Almost everywhere now. Real photographs contain motion-blurred hands, odd reflections and unreadable signage constantly. This entry is retained as a caution, not as a test.

**Evidence:** GIJN Reporter's Guide to Detecting AI-Generated Content; Pangram's image-classifier launch rationale; TextFake benchmark, arXiv:2606.01050.

**Before**

> Flagging a hero image as AI because a hand looks slightly off.

**After**

> Checking Content Credentials, running a reverse image search, and asking the designer where the file came from.

### `uncanny-padding-rhythm-uniformity`  ·  low · generic-llm · layout · structural · family: visual

Every section uses the exact same vertical padding, every card the same internal padding and gap, every element the same radius token — mechanically uniform rhythm with no focal emphasis or intentional density change.

**Why it reads AI:** Generators apply one spacing scale uniformly because they have no editorial sense of pacing. Designed pages breathe — heroes get more air, dense data less. Perfect evenness feels machine-laid.

**Detect:** structural: measure section vertical padding and card padding/radius/gap across the page; flag near-zero variance in spacing and radius tokens across semantically different sections (e.g. every section py-20, every card p-6 rounded-2xl gap-6).

**Fix:** Introduce intentional rhythm: vary section padding by importance, let a hero be spacious and a table tight, use radius/elevation to signal hierarchy, and add one deliberate irregularity.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Eight consecutive sections all py-20, every card p-6 rounded-2xl gap-6, identical column widths throughout.

**After**

> Hero py-32, feature bento py-24, dense pricing table py-16; a full-bleed quote section breaks the column grid; card radii and padding step with hierarchy.

<!-- humanize:ignore-end -->
