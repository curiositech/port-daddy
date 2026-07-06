# Visual design tells — the v0/Lovable look and AI imagery

What makes a UI, slide, or image read as generated: the defaults nobody chose, clustering together.

_14 items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._

### `ai-image-waxy-skin-mangled-hands`  ·  high · generic-llm · web-ui · llm-judge

Generated photos used as hero or testimonial imagery show diffusion tells: waxy plastic skin with no pores, an HDR over-sheen, mangled hands (extra/merged fingers), garbled background text, and over-symmetric composition.

**Why it reads AI:** Skin reads as airbrushed plastic, hands have anatomy errors, and embedded text is melted gibberish — the most reliable, well-documented signatures of synthetic imagery.

**Detect:** llm-judge: 'Does the image show synthetic signatures — poreless waxy skin with uniform sheen, anatomically wrong hands, melted gibberish text in signage, or unnaturally symmetric framing?'

**Fix:** Use real photography or licensed images. If generative imagery is necessary, post-process to restore pore texture and reduce sheen, crop out hands and embedded text, and never use synthetic faces for testimonials.

**Before**

> Hero photo of a 'team' with poreless waxy faces, one person's hand showing six fingers, a blurred office sign reading 'OFFICCE WROK'.

**After**

> A licensed documentary-style photo of a real team, natural skin texture and lighting, legible signage, asymmetric candid framing — or an honest illustrated hero.

### `centered-hero-three-card-skeleton`  ·  high · generic-llm · layout · structural

The whole-page template: centered badge pill ('Now in beta'), giant centered headline with one gradient word, one-line subhead, two buttons (solid + ghost), then a 3-column grid of icon-title-blurb cards (icons often emoji). Section order and centering are near-identical across generated sites.

**Why it reads AI:** This is the statistical mean of every landing page in the training set; generators reproduce the skeleton verbatim. The giveaway is that the structure, not just the styling, is interchangeable with a thousand other AI sites.

**Detect:** structural: DOM-pattern match a hero with text-align:center, a pill above an h1, an h1 with a gradient span, a subhead, exactly two sibling CTAs, then a grid-cols-3 of 3-4 icon+heading+paragraph cards. The full sequence co-occurring is the tell.

**Fix:** Break the symmetry: asymmetric/left-aligned hero, a product screenshot or demo doing the talking, one primary CTA, and feature sections with varied layouts (alternating media-text rows, a bento grid) rather than a uniform 3-up.

**Before**

> Centered 'Now in beta' pill -> 'The future of <gradient>work</gradient>' -> subhead -> Get started + Learn more -> 3 identical icon cards.

**After**

> Left-aligned hero with a live product canvas on the right, one CTA (Start building), then an alternating sequence: a wide demo, a 2x2 bento of differentiated capabilities, a metric strip.

### `emoji-as-ui-icons`  ·  high · generic-llm · iconography · structural

Emoji stand in for a real icon system: rocket in 'Get started' buttons, check bullets in feature lists, lock next to 'Secure,' lightning for 'Fast.' Rendered as OS emoji glyphs rather than SVG icons.

**Why it reads AI:** Emoji as UI elements vary per OS, don't inherit color, and can't be sized to the grid; no design system ships them as iconography. It's the fastest visual giveaway of zero design investment.

**Detect:** structural: scan rendered text nodes and button labels for emoji codepoints in UI chrome (U+1F300-1FAFF, U+2600-27BF, U+2705, U+1F680, U+26A1, U+1F512). Any emoji codepoint inside a button, nav, feature-card title, or list marker is a defect; distinguish from user-generated content.

**Fix:** Replace every UI emoji with a consistent SVG icon set (Lucide, Heroicons, Phosphor). Icons inherit currentColor and share stroke weight. Reserve emoji for actual content.

**Before**

> Feature card: 🚀 Lightning fast / 🔒 Bank-grade security / ✅ No setup required; CTA reads Get started 🚀.

**After**

> Feature card: a 20px Lucide Rocket, ShieldCheck, Check icon in brand color above each title; CTA reads Get started with an inline ArrowRight SVG.

### `identical-face-different-people`  ·  high · generic-llm · web-ui · llm-judge

Across 'different' avatars or testimonial photos, the same underlying face recurs — same bone structure, eye spacing, smile — with only hair/clothes swapped, plus a shared teal-and-orange grade and creamy bokeh across all images.

**Why it reads AI:** A diffusion model collapses toward an attractive mean face, so a batch of generated people look like siblings. The shared grade and identical bokeh confirm one generator made them all.

**Detect:** llm-judge: 'Do the supposedly distinct people share one mean face with cosmetic variation, and do all images share an identical color grade and depth-of-field, indicating one generator produced them?'

**Fix:** Use distinct real people. If generating, vary seeds/prompts hard and verify faces are genuinely different, or avoid faces entirely. Diversify color grade and depth-of-field.

**Before**

> Four testimonial avatars that are visibly the same face with different hairstyles, all teal-orange graded with identical background bokeh.

**After**

> Four genuinely distinct licensed portraits with varied lighting, framing, and color treatment — or four monogram/initial avatars instead of faces.

### `purple-blue-gradient-text-headline`  ·  high · generic-llm · color · structural

The headline (or one hero word) uses a linear-gradient clipped to text running indigo-to-violet or violet-to-cyan, with the same gradient on hero buttons and blobs. The 'gradient word' in an otherwise solid headline is a signature move.

**Why it reads AI:** Gradient text was a 2021-2023 SaaS trend the models over-learned; combined with indigo-violet stops it screams template. Real brands use gradient text sparingly with custom stops.

**Detect:** structural: look for `background: linear-gradient(...); -webkit-background-clip: text; color: transparent` or `bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent`, with gradient stops in the indigo/violet/blue hue range (H 220-280). Presence on the H1 is the tell.

**Fix:** Make the headline a solid, confident color. If a gradient is truly wanted, use unexpected stops tied to brand and apply it to one deliberate element, not every accent.

**Before**

> <h1>Build <span class='bg-gradient-to-r from-indigo-500 to-fuchsia-500 bg-clip-text text-transparent'>faster</span></h1> with a matching gradient CTA.

**After**

> <h1>Build faster</h1> in solid near-black; a single restrained accent underline in the brand terracotta; buttons are flat brand fill.

### `tailwind-indigo-default-palette`  ·  high · generic-llm · color · structural

The most reliable web AI-ism: the brand/primary color is Tailwind's default indigo-500 #6366F1 (or violet-500 #8B5CF6, blue-500 #3B82F6). Buttons, links, focus rings, and accents land on the unmodified Tailwind palette.

**Why it reads AI:** Models trained on 2019-2024 web code saw bg-indigo-500 disproportionately (Tailwind UI shipped it as the default button color); Adam Wathan publicly apologized for it. A brand whose primary is the framework default reads as un-art-directed.

**Detect:** structural: scan CSS/computed background-color of primary buttons for exact hex #6366F1, #8B5CF6, #4F46E5, #3B82F6 or classes `bg-indigo-500/600`, `bg-violet-500`; also flag any primary/accent in the indigo-violet hue band (~250-275deg). Exact-hex match against the Tailwind default ramp is a high-precision signal.

**Fix:** Define a bespoke brand hue — shift H/S/L off the default ramp, build a custom 50-950 scale, and never ship the literal #6366F1. Even rotating 20-40 degrees of hue and adjusting saturation breaks the tell.

**Before**

> Primary CTA bg-indigo-600 hover:bg-indigo-700, links text-blue-500, focus ring ring-indigo-500.

**After**

> Custom brand token --brand: oklch(0.62 0.17 28) (a warm terracotta) with a hand-tuned scale; CTA, links, and focus ring all derive from it; zero default-Tailwind swatches.

### `badge-pill-now-in-beta`  ·  medium · generic-llm · web-ui · structural

A small rounded-full pill above the headline with a tiny dot or sparkle and text like 'Now in beta,' 'Introducing X,' or 'New.' Subtle border, muted background, centered — the reflexive hero garnish.

**Why it reads AI:** The announcement pill is a Linear/Vercel-ism every generator prepends to heroes automatically, whether or not there's anything to announce. Its presence as default garnish signals templated output.

**Detect:** structural: detect a rounded-full inline-flex element directly preceding the h1 with a small status dot/icon plus short text (often border-white/10 bg-white/5 text-xs). Its position above a centered h1 plus pill styling is the pattern; also flag text-xs here as failing the 14px legibility floor.

**Fix:** Only show an announcement pill when there is a genuine linkable announcement, and make it a real link. Otherwise delete it. If kept, ensure label text is >=14px or a proper >=600-weight uppercase eyebrow, not text-xs.

**Before**

> <span class='rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs'>✨ Now in beta</span> above the centered h1, linking nowhere.

**After**

> Either no pill, or a real link pill at 14px to a dated launch post: 'Read: v2 is live ->' — and only when that post exists.

### `dark-mode-radial-glow-blobs`  ·  medium · generic-llm · color · structural

Dark-mode-by-default near-black background (#0A0A0A / slate-950) decorated with large blurred radial-gradient glow blobs in indigo/violet/cyan bleeding from the corners, plus a faint grid or dot overlay.

**Why it reads AI:** Linear/Vercel-style dark hero with ambient purple glows is the default 'looks expensive' move. When every AI site has the same two violet smudges on near-black, it reads as templated.

**Detect:** structural: detect a body background near #000-#0B0F1A combined with absolutely-positioned divs carrying `radial-gradient` + heavy `blur()` (>60px) in indigo/violet/cyan, and/or a repeating grid/dot background SVG. The dark-bg + corner glow-blob + grid-overlay triple is the signature.

**Fix:** Justify the color mode by the product. If dark, build a real neutral scale and use lighting with intent; drop the corner glow-blobs or replace with a meaningful brand visual. Consider light or a distinctive non-black dark.

**Before**

> bg-slate-950 with two blur-3xl violet/indigo radial blobs top-left and bottom-right and a faint dot-grid overlay behind the hero.

**After**

> Warm off-white (#F7F5F2) light theme with a single hand-made hero illustration; or a deliberate deep-green dark theme with one structural light source and no ambient glow blobs.

### `glassmorphism-card-stack`  ·  medium · generic-llm · web-ui · structural

Cards use the identical recipe: semi-transparent fill, backdrop-blur, rounded-2xl/3xl corners, soft drop shadow, and a 1px white-at-10%-opacity inset border. Every card shares the exact token combo.

**Why it reads AI:** It's the default 'premium' card generators emit, copy-pasted across v0/Lovable output. Real systems vary radius, elevation, and surface treatment by component role.

**Detect:** structural: flag the co-occurring quadruple `backdrop-filter: blur` + `border-radius: 16-24px` + `border: 1px solid rgba(255,255,255,0.1)` + soft box-shadow + `background: rgba(...,0.05-0.1)` (Tailwind `backdrop-blur-xl rounded-2xl border border-white/10 shadow-xl bg-white/5`).

**Fix:** Choose a surface treatment that fits the brand and vary radius/elevation by hierarchy. If using glass, restrict it to one intentional layer (a sticky nav), not every card.

**Before**

> Every feature, pricing, and testimonial card: bg-white/5 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl.

**After**

> Feature cards flat with a 1px solid neutral-200 border and 8px radius; the 'popular' pricing card steps up to a real elevation-3 shadow and solid surface; no backdrop-blur except the pinned header.

### `inter-geist-default-typeface`  ·  medium · generic-llm · typography · structural

AI site builders default to Inter (or Vercel's Geist) for every text role with no contrasting display or serif face. Sora, Manrope, and Space Grotesk are the secondary fallbacks that signal the same generator.

**Why it reads AI:** Human designers almost always pair a display face with a text face or pick a typeface with brand intent. One geometric grotesk doing 100% of the work is the statistical-average choice.

**Detect:** structural: inspect computed font-family on h1/h2/body/button. Flag a single family (Inter/Geist/Sora/Manrope/Space Grotesk) used across all text roles with zero pairing; grep CSS for `font-family:.*Inter`, `--font-geist`, `next/font/google` importing Inter. One family doing every job is the signal.

**Fix:** Pair an opinionated display face for headlines with a neutral text face for body, or commit to one face but vary weight/optical-size/tracking with intent. Anything but unmodified Inter-everywhere.

**Before**

> All headings, body, and buttons render in font-family: Inter, sans-serif at weights 400/500/600.

**After**

> Headlines in a high-contrast serif (e.g. GT Sectra) at 600; body in Inter at 400 with -0.011em tracking; clear hierarchy between display and text.

### `mixed-icon-sets-one-view`  ·  medium · generic-llm · iconography · structural

A single view mixes icon vocabularies: some Lucide line icons, some Heroicons solid, a couple of emoji, maybe a Font Awesome glyph — different stroke weights, corner radii, and fill styles side by side.

**Why it reads AI:** Generators pull icons from whatever import is handy per snippet, so a page accretes mismatched sets. Humans standardize on one family and weight.

**Detect:** structural: inventory icon sources in the DOM (lucide-react, @heroicons, react-icons/fa, emoji codepoints, inline SVGs with differing stroke-width). More than one icon system in a viewport, or mixed stroke-width among adjacent icons, is the tell.

**Fix:** Standardize on a single icon library and one style (e.g. Lucide, 1.5px stroke, 24px grid) across the app. Remove emoji from UI. Audit every icon for shared weight, size, and alignment.

**Before**

> Feature row pairs a Lucide outline Zap (stroke 2), a Heroicons solid LockClosed, and a 🔒 emoji — three visual languages in one line.

**After**

> All three are Lucide outline icons at 24px / 1.5px stroke in brand color, optically centered on a shared baseline.

### `sparkle-motif-for-ai`  ·  medium · generic-llm · iconography · structural

The four-point sparkle (Lucide Sparkles, Material's AI sparkle) slapped on anything AI-related: 'AI' badges, generate buttons, magic-wand affordances, and decorative confetti around headlines.

**Why it reads AI:** The sparkle became the universal, unimaginative shorthand for AI 'magic.' Reaching for it signals the design followed the herd rather than inventing a brand-specific affordance.

**Detect:** structural: detect U+2728, Lucide Sparkles/Sparkle/WandSparkles usage, or four-point-star SVG paths near text containing 'AI'/'generate'/'magic'. Count sparkle glyphs per view; any on an AI feature is the cliche, multiple is severe.

**Fix:** Design a distinct affordance for AI actions — a custom glyph, a labeled button, a motion cue. If a sparkle is unavoidable, make it bespoke and use it once.

**Before**

> <button>✨ Generate with AI</button> plus floating ✨ sparkles scattered around the hero headline.

**After**

> <button>Generate</button> with a custom monoline glyph unique to the product; no decorative sparkles; the AI capability is communicated by a short label and a subtle hover shimmer.

### `stock-mesh-gradient-background`  ·  medium · generic-llm · color · structural

The hero or full-page background is a soft multi-stop mesh gradient (pink-purple-blue-teal blend), often the literal default from a mesh-gradient generator, used as decoration unrelated to the brand.

**Why it reads AI:** Mesh gradients had a moment, so models emit them as instant 'modern' backdrop. A pastel mesh that doesn't echo any brand color is decoration-by-default.

**Detect:** structural: detect large conic/radial multi-stop gradients or a mesh-gradient SVG/PNG covering the hero with 3+ pastel stops in the magenta-violet-blue-cyan range, frequently with blur.

**Fix:** Make the background earn its place: a solid brand-tinted surface, a real product visual, a subtle texture, or a gradient built from actual brand colors. Avoid the default rainbow-pastel mesh.

**Before**

> Full-bleed hero behind the headline is a blurred pink-to-purple-to-cyan mesh gradient lifted from a generator preset.

**After**

> Hero sits on a flat warm-neutral surface with a single duotone product screenshot; any gradient uses only the two brand hues at low contrast.

### `uncanny-padding-rhythm-uniformity`  ·  low · generic-llm · layout · structural

Every section uses the exact same vertical padding, every card the same internal padding and gap, every element the same radius token — mechanically uniform rhythm with no focal emphasis or intentional density change.

**Why it reads AI:** Generators apply one spacing scale uniformly because they have no editorial sense of pacing. Designed pages breathe — heroes get more air, dense data less. Perfect evenness feels machine-laid.

**Detect:** structural: measure section vertical padding and card padding/radius/gap across the page; flag near-zero variance in spacing and radius tokens across semantically different sections (e.g. every section py-20, every card p-6 rounded-2xl gap-6).

**Fix:** Introduce intentional rhythm: vary section padding by importance, let a hero be spacious and a table tight, use radius/elevation to signal hierarchy, and add one deliberate irregularity.

**Before**

> Eight consecutive sections all py-20, every card p-6 rounded-2xl gap-6, identical column widths throughout.

**After**

> Hero py-32, feature bento py-24, dense pricing table py-16; a full-bleed quote section breaks the column grid; card radii and padding step with hierarchy.
