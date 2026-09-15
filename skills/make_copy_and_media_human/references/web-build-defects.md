# Web build defects — the half you can reproduce

A different KIND of finding from the rest of this catalog. Everything here is a defect you can reproduce by opening the page: it scrolls sideways at 390px, the button is not a button, the grey text fails contrast. So none of it is an inference about who built the page, none of it carries the fairness caveat the rest of the skill insists on, and all of it can be acted on with full confidence — the same standing as a dead citation. Act on this file FIRST: a page that does not work on a phone has a bigger problem than a page that reads a bit generated.

Most of these are decidable from source and run in the normal structural pass. The ones marked `rendered` need `scripts/render_check.py`, the one optional script in this bundle, which opens the page at real viewports and names the elements at fault.

_17 items. Generated from catalog.json — edit there, then re-run `scripts/regenerate_references.py`. Do not hand-edit this file._

_Every item carries a **False positive when** line. Read it before you act on the item: these are cues for an editor, not evidence about an author._

<!-- humanize:ignore-start
     Everything below is a specimen catalog. It quotes the tells it documents,
     including literal machine residue, so reviewing it with humanize_review.py
     would flag the exhibits rather than the writing. -->

### `clickable-div-not-button`  ·  high · generic-llm · web-ui · structural · family: defect

A div or span with a click handler and no button role, so it is unreachable by keyboard and unannounced by assistive tech.

**Why it reads AI:** It looks identical on screen and works for a subset of people, which is exactly the class of defect that survives a visual review.

**Detect:** Elements matching div/span with an onClick attribute and no role=button, tabindex or key handler. Static, near-zero false positive.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Use <button type="button">. Strip its default styling with `all: unset` plus your own if you need it to look like a div. If it genuinely must stay a div it needs role="button", tabIndex={0}, and onKeyDown handling Enter AND Space — which is the argument for using a button.

**False positive when:** A click handler on a container for event delegation, or for dismissing a modal by backdrop click, is not a control and needs no role.

**Before**

> <div onClick={open} className="cta">Get started</div>

**After**

> <button type="button" onClick={open} className="cta">Get started</button>

### `focus-outline-removed`  ·  high · generic-llm · web-ui · structural · family: defect

outline:none or outline:0 with no :focus-visible replacement anywhere.

**Why it reads AI:** The ring is ugly in a screenshot and invisible in the generation loop, so it gets removed. Keyboard users then cannot see where they are.

**Detect:** Presence of an outline-removal rule with no :focus-visible selector in the same stylesheet. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Replace it, do not remove it: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`. :focus-visible only shows for keyboard focus, so you get the clean mouse appearance you wanted. Then tab the whole page and confirm you can always see where you are.

**False positive when:** Removing the outline while supplying a different visible focus treatment (a ring, a border, a background shift) is fine — the detector looks for :focus-visible specifically, so a box-shadow-based ring under a different selector may read as a false positive.

**Before**

> button { outline: none }

**After**

> button { outline: none }
> button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }

### `framework-look-without-responsive`  ·  high · generic-llm · layout · structural · family: defect

The page wears the visual idiom of a modern utility-CSS framework — flex rows, rounded cards, spacing scale, shadows — and contains not one responsive variant or width media query.

**Why it reads AI:** The look was copied; the part that does work was not. A generator produces the class names that make a screenshot look right, and responsive behaviour only shows up if someone resizes the window, which nothing in the generation loop does.

**Detect:** Count utility-class tokens against responsive prefixes (sm:/md:/lg:/xl:) and width-based @media rules. A high idiom count with zero of either is the signal. Purely static, decidable from source.

**Thresholds** (read by `scripts/humanize_review.py`): `min_idiom` = 25

**Fix:** Pick the three widths that matter — roughly 390, 768 and 1200 — and make the page correct at each. Concretely: every multi-column grid needs a single-column form below the first breakpoint (grid-template-columns: 1fr by default, columns added at min-width); every fixed pixel width becomes max-width plus width:100%; horizontal padding lives on one container rather than on each child; and replace repeat(3, 360px) with repeat(auto-fit, minmax(280px, 1fr)), which needs no breakpoint at all. Then open it at 390px before you believe any of it.

**False positive when:** Embedded widgets, email templates, print stylesheets, and admin tools with a documented desktop-only support policy. Also a fragment that inherits its responsive behaviour from a parent layout — check whether the file is a whole page.

**Before**

> <div class="grid" style="grid-template-columns: repeat(3, 360px)">

**After**

> <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">

### `horizontal-overflow-at-mobile`  ·  high · generic-llm · layout · rendered · family: defect

The page scrolls sideways at phone width. Content is literally off screen.

**Why it reads AI:** This is the lived form of the previous entry. It is also the single most common failure of a site styled to look like a framework without being built with one.

**Detect:** Rendered check only: load at 390px and compare documentElement.scrollWidth against innerWidth, then walk the DOM for the outermost elements extending past the right edge. scripts/render_check.py does this and names the culprits.

**Fix:** Fix the named elements outermost-first; a wide child inside a wide parent is one bug. The usual four causes, in order of frequency: a fixed pixel width that wants max-width:100%; a grid with a hardcoded column count that needs a single-column form below the breakpoint; 100vw where 100% was meant, which overflows by the scrollbar width; and a long unbroken string (a URL, a token, a code sample) that needs overflow-wrap:anywhere. Add `html { overflow-x: clip }` only after you have fixed the cause — as a first move it hides the bug rather than solving it.

**False positive when:** Deliberate horizontal scrollers (a carousel, a wide data table in its own overflow container) are correct. The finding is about the PAGE scrolling, not a component.

**Before**

> .wrap { width: 1180px; margin: 0 auto }

**After**

> .wrap { max-width: 1180px; margin-inline: auto; padding-inline: 1.5rem }

### `missing-viewport-meta`  ·  high · generic-llm · web-ui · structural · family: defect

No viewport meta tag, so a phone renders the page at desktop width and scales the whole thing down.

**Why it reads AI:** It is one line that every framework scaffold includes and that only goes missing in hand-assembled markup. Its absence is close to proof nobody opened the page on a phone.

**Detect:** Absence of a meta viewport tag in a document that has a head. Binary and static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the head. Do not add maximum-scale or user-scalable=no with it — that blocks pinch zoom, which people rely on.

**False positive when:** HTML fragments, partials and email templates have no head and should not have one.

**Before**

> <head><title>Product</title></head>

**After**

> <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Product</title></head>

### `placeholder-copy-residue`  ·  high · generic-llm · marketing-copy · structural · family: residue

Template filler reaching a reader: lorem ipsum, "Your Company", "Acme Inc", "Product Name", "Your logo here".

**Why it reads AI:** Nobody read the page end to end. This is the visual-design sibling of the unfilled merge tag.

**Detect:** Closed-set literal match. Static, and proof rather than inference.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Replace with real copy, or delete the section until you have some. An honest three-section page beats a seven-section one with two sections of filler.

**False positive when:** Design-system documentation, component galleries and Storybook stories use lorem deliberately to avoid implying real content.

**Before**

> <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>

**After**

> <p>Northwind matches bank lines to invoices and flags the 2% that need a human.</p>

### `scaffold-title-residue`  ·  high · generic-llm · web-ui · structural · family: residue

The framework's default document title shipped: "Create Next App", "Vite + React", "Untitled", "Document".

**Why it reads AI:** Proof rather than inference, like an unfilled merge tag. It is what the browser tab, the search result and every shared link will say.

**Detect:** Match the title text against the closed set of scaffold defaults. Static, near-zero false positive.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Write the title: product name, then what it is, under about 60 characters so search does not truncate it. Set a distinct one per route, and while you are in the head add a meta description and an og:image — they are missing for the same reason.

**False positive when:** A scaffold that genuinely has not shipped yet. That is a reason to fix it before it does, not to ignore it.

**Before**

> <title>Create Next App</title>

**After**

> <title>Northwind — invoice reconciliation for finance teams</title>

### `wcag-fail-from-generated-palette`  ·  high · generic-llm · color · rendered · family: defect

Text below WCAG AA contrast: 4.5:1 for body, 3:1 for large text. Usually muted grey on white or on a tinted ground.

**Why it reads AI:** A palette chosen for how it photographed in a hero mock rather than for whether anyone can read it. Muted grey secondary text is the default because it looks calm in a screenshot.

**Detect:** Rendered: compute relative luminance of computed foreground against the nearest opaque ancestor background. scripts/render_check.py reports ratios per element. Partial static detection is possible for known low-contrast utility tokens on a known ground.

**Fix:** Darken the foreground token until it passes rather than patching each element — there is almost always one --muted token behind every failure. On white, grey needs to reach about #595959 for body text. Check the states too: placeholder, disabled and hover are where this recurs after the fix.

**False positive when:** Genuinely decorative text, disabled controls (exempt from AA), and text over an image where the real background is a scrim the checker cannot resolve. Verify the computed background before filing.

**Before**

> color: #9ca3af on #ffffff  (2.54:1)

**After**

> color: #595959 on #ffffff  (7.0:1)

### `body-text-below-readable`  ·  medium · generic-llm · typography · rendered · family: defect

Text rendering under about 12px.

**Why it reads AI:** Small type reads as refined in a zoomed-out mock and is unreadable at arm's length. Generated pages inherit the look of a design shot rather than of a page someone reads.

**Detect:** Rendered: computed font-size on elements with direct text content.

**Fix:** Floor body text at 16px and secondary text at 14px. Note iOS zooms the page when a form input under 16px receives focus, so inputs specifically must be 16px or larger. If the layout only works at 11px, the layout is too dense — cut content rather than shrinking type.

**False positive when:** Legal footnotes, chart axis labels and dense tabular data have long-standing conventions below 12px.

**Before**

> .eyebrow { font-size: 11px }

**After**

> .eyebrow { font-size: 14px }

### `dead-anchor-href`  ·  medium · generic-llm · web-ui · structural · family: defect

Navigation links pointing at href="#" or nothing.

**Why it reads AI:** The generator produced the SHAPE of a nav without destinations, because the template has slots and the site has no pages.

**Detect:** Count anchors with an empty or hash-only href. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Point each link at a real destination or delete it. A nav with three real links beats one with eight dead ones, and the dead ones are the first thing a visitor clicks.

**False positive when:** href="#" on a control that JavaScript intercepts is a long-standing (if dated) pattern, and a skip-link legitimately targets a fragment. Check whether a handler is attached.

**Before**

> <a href="#">Docs</a>

**After**

> <a href="/docs">Docs</a>

### `div-soup-no-semantics`  ·  medium · generic-llm · web-ui · structural · family: defect

Everything is a div. No main, nav, header, footer, section or article anywhere.

**Why it reads AI:** A generator emits the box it needs to style. Semantic elements pay off only for people using a screen reader or reader mode, and nothing in the loop represents them.

**Detect:** Ratio of div elements to semantic landmark elements. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_divs` = 20, `max_semantic_share` = 0.08

**Fix:** It is a rename, not a rewrite, and usually twenty minutes: one <main> around the page content, <nav> for the nav, <header> and <footer>, and <section> wherever a heading introduces a region. Then tab through the page and use the browser's accessibility tree to check the landmarks read sensibly.

**False positive when:** Component fragments, design-system primitives and rendered subtrees legitimately return divs; the landmark lives in the layout that composes them. Judge whole pages.

**Before**

> <div class="nav">...</div> <div class="content">...</div>

**After**

> <nav>...</nav> <main>...</main>

### `missing-or-placeholder-alt`  ·  medium · generic-llm · web-ui · structural · family: defect

Images with no alt attribute, or alt text that describes the file rather than its job: "image of a laptop", "screenshot.png".

**Why it reads AI:** Generated alt text describes the picture because that is what the model can see. Useful alt text describes what a reader would lose, which requires knowing why the image is on the page.

**Detect:** Images missing alt, or whose alt starts with image/photo/picture/screenshot, or is a filename. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2

**Fix:** For each image ask what a reader loses if it does not load, and write that. If the answer is nothing, use alt="" so screen readers skip it rather than announcing a filename. A product screenshot's alt should carry the thing the screenshot proves.

**False positive when:** Decorative images correctly carry alt="", and an adjacent caption can legitimately carry the description instead (with the image marked decorative).

**Before**

> <img src="dash.png" alt="image of a dashboard">

**After**

> <img src="dash.png" alt="The reconciliation queue, showing 38 unmatched lines out of 1,840">

### `no-reduced-motion-guard`  ·  medium · generic-llm · layout · structural · family: defect

An animated page with no prefers-reduced-motion media query.

**Why it reads AI:** The motion was added as a finish. Honouring the OS-level preference requires knowing the preference exists.

**Detect:** Count animation, transition and motion-library declarations; flag when several exist and no prefers-reduced-motion block does. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_animations` = 6

**Fix:** Add the guard, which is four lines: @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important } }. For a motion library, read the preference and pass a zero-duration variant.

**False positive when:** A page whose only transitions are sub-100ms colour or opacity changes on hover does not trigger vestibular symptoms and is not what the preference is for.

**Before**

> (twelve scroll-triggered fade-ups, no guard)

**After**

> (the same, wrapped so reduced-motion users get instant state changes)

### `tap-target-too-small`  ·  medium · generic-llm · layout · rendered · family: defect

Interactive controls smaller than about 44x44 CSS pixels at phone width.

**Why it reads AI:** Desktop-first styling that was never checked with a thumb. Padding tuned for a cursor is too small for a finger.

**Detect:** Rendered at 390px: measure bounding boxes of anchors, buttons and form controls.

**Fix:** Give controls a minimum 44x44 hit area with min-height and min-width, or put the padding on the control rather than on its container. Nav links set to display:inline with tiny padding are the usual offender — make them inline-block or flex items with real vertical padding. Inline links inside a paragraph are exempt.

**False positive when:** Inline text links within prose, and dense data tables on desktop, are legitimate exceptions the guideline itself carves out.

**Before**

> .nav a { padding: 2px 6px; font-size: 11px }

**After**

> .nav a { display: inline-flex; align-items: center; min-height: 44px; padding-inline: 12px; font-size: 15px }

### `image-without-dimensions`  ·  low · generic-llm · web-ui · rendered · family: defect

Images with no width and height attributes, so the layout shifts as they load.

**Why it reads AI:** The attributes matter only while the page is loading, which nothing in the generation loop observes.

**Detect:** Rendered or static: images over about 40px in either dimension with no width/height attributes.

**Fix:** Set width and height to the real intrinsic pixel dimensions and let CSS scale with `height: auto`. The browser then reserves the space from the aspect ratio before the bytes arrive. Add loading="lazy" to anything below the fold and fetchpriority="high" to the hero image.

**False positive when:** Images in a fixed aspect-ratio container, or with an explicit aspect-ratio CSS property, already reserve their space.

**Before**

> <img src="hero.png">

**After**

> <img src="hero.png" width="1200" height="720" style="height:auto" fetchpriority="high" alt="...">

### `important-escalation`  ·  low · generic-llm · web-ui · structural · family: defect

Heavy use of !important.

**Why it reads AI:** Specificity fought rather than designed — what happens when rules are added without reading the ones already there.

**Detect:** Count occurrences. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 8

**Fix:** Find the rule being overridden and change it. Where you genuinely need to win, raise specificity deliberately or use a cascade layer (@layer) rather than the nuclear option. Keep !important for utility overrides, print styles and the reduced-motion guard, where it is correct.

**False positive when:** Utility-first frameworks and the reduced-motion guard use !important by design; a generated utility stylesheet will have many legitimately.

**Before**

> .card p { color: #333 !important }

**After**

> (the base rule corrected, so nothing needs to win)

### `z-index-escalation`  ·  low · generic-llm · web-ui · structural · family: defect

z-index values in the hundreds or thousands.

**Why it reads AI:** Stacking resolved by bidding. A z-index of 9999 means nobody knows what it is competing with.

**Detect:** Maximum z-index value in the stylesheet or utility classes. Static.

**Thresholds** (read by `scripts/humanize_review.py`): `max_z` = 100

**Fix:** Define a small named scale and use only it: base 0, sticky 10, dropdown 20, overlay 30, modal 40, toast 50. Put them in CSS custom properties so the scale is visible in one place. Most stacking bugs are actually stacking-context bugs — a transform or filter on an ancestor — which a bigger number will never fix.

**False positive when:** Third-party widgets sometimes require a high value to sit above host content, and a documented single high value is not escalation.

**Before**

> z-index: 9999

**After**

> z-index: var(--z-modal)  /* 40 */

<!-- humanize:ignore-end -->
