# Structure, deck, and marketing-copy tells

Document-shape tells: how generated long-form docs, slides, posts, and emails are assembled, independent of any sentence in them.

_58 items. Generated from catalog.json — edit there, then re-run `scripts/regenerate_references.py`. Do not hand-edit this file._

_Every item carries a **False positive when** line. Read it before you act on the item: these are cues for an editor, not evidence about an author._

<!-- humanize:ignore-start
     Everything below is a specimen catalog. It quotes the tells it documents,
     including literal machine residue, so reviewing it with humanize_review.py
     would flag the exhibits rather than the writing. -->

### `bold-label-colon-bullet`  ·  high · generic-llm · structure · structural · family: shape

The most recognizable AI list shape: every bullet is '**Bold Label:** explanation sentence,' uniform across the whole list. On some models (Gemini) each bullet is also separated by a blank line, producing a tall double-spaced wall.

**Why it reads AI:** Real human lists vary item structure; the rigidly uniform 'bold term: gloss' across every bullet is the single most identifiable AI list fingerprint and is never typed by hand for casual answers.

**Detect:** structural: flag any list where >=60% of items match `^\s*[-*]\s*(\*\*|__).+?(\*\*|__):\s`; 3+ consecutive items in this exact shape is a strong signal. Additional signal: blank line between every bullet combined with the bold-colon template.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 4

**Fix:** Vary the items. Drop the bold labels unless they're true scannable keys in a reference table. Let some items be a phrase and others a full sentence; collapse to prose where it's really reasoning.

**False positive when:** Glossaries, API parameter lists and definition lists are exactly this shape for good reason. The tell is using it for prose that should have been paragraphs.

**Before**

> - **Speed:** It is fast.
> - **Reliability:** It rarely fails.
> - **Scalability:** It grows with you.
> - **Security:** It keeps data safe.

**After**

> It's fast and almost never falls over. We've pushed it to 40k concurrent users without tuning anything, and the security review came back clean.

### `challenges-and-future-directions`  ·  high · generic-llm · structure · structural · family: form

The obligatory penultimate move: a 'Challenges and Future Directions' / 'Future Outlook' section whose body runs 'Despite its X, it faces challenges... Despite these challenges, it continues to...'.

**Why it reads AI:** A rigid formula that ends in speculative positive assessment regardless of subject. The model is completing a document template, not finishing a thought.

**Detect:** Heading regex over the closed set, plus body regex for 'Despite (its|these|the)'.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Delete the section. If a real open problem exists, state it as a specific unresolved question with a name attached to it.

**False positive when:** Grant proposals and review articles have a genuine, long-standing convention of a future-work section. Judge the body, not the heading, in those genres.

**Evidence:** Wikipedia:Signs of AI writing, Outline-like conclusions.

**Before**

> ## Challenges and Future Directions
> 
> Despite its rapid growth, the project faces challenges typical of open-source ecosystems.

**After**

> Maintainer burnout is the live risk: two of the three core committers stepped back in 2024 and neither has been replaced.

### `citation-pathology`  ·  high · generic-llm · structure · llm-judge · family: residue

References that exist but do not do their job: DOIs resolving to an unrelated paper, invalid DOIs and ISBNs, links to search results rather than documents, named refs declared and never used, and refs attached to sentences they do not support.

**Why it reads AI:** Models use legitimate sources inappropriately and invent plausible ones. Wikipedia's cleanup guidance is emphatic that the highest-yield check is not style at all — it is opening the citations.

**Detect:** Structural for the mechanical subset (DOI/ISBN checksum, HTTP status, '/search?q=' in an href, unused named refs). Judge for the one that matters: does the cited source actually support the sentence it is attached to?

**Fix:** Open every reference. Delete or replace any that does not support its sentence.

**False positive when:** Almost none, and note this is the ONE finding class in this catalog that is about truth rather than authorship. Act on it with full confidence — you are checking a claim, not inferring an author.

**Evidence:** Wikipedia:WikiProject AI Cleanup.

**Before**

> Latency fell 40% after the migration.[12]  (ref 12 is a 2011 paper about a different system)

**After**

> Latency fell 40% after the migration (our own p99 dashboard, 12-19 March).

### `conclusion-recap-tag`  ·  high · generic-llm · structure · structural · family: shape

A closing paragraph flagged with 'In conclusion,' 'In short,' 'Ultimately,' 'Overall,' or 'At the end of the day' that re-states the body without adding anything.

**Why it reads AI:** Five-paragraph-essay scaffolding makes the model ring a bell to announce the wrap-up and repeat itself, even in short pieces. Real writing ends when the argument is done.

**Detect:** structural: flag a final/penultimate paragraph whose n-gram overlap with the preceding body exceeds ~50% (high lexical recall of earlier topic sentences = pure recap), independent of the opener word.

**Fix:** End on the strongest concrete point or a forward-looking specific. If a reader could skip the last paragraph and lose nothing, cut it.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> In conclusion, caching is a powerful tool that, when used correctly, can significantly improve performance and enhance user experience.

**After**

> The trap is stale reads after a write; if you can't tolerate them, skip the cache on that path rather than tuning a TTL you'll forget.

### `emoji-section-headers`  ·  high · chatgpt · structure · structural · family: shape

Headings and list items prefixed with a decorative emoji mapped to topic: rocket Getting Started, sparkles Features, wrench Configuration, package Installation, bulb Tips. Especially common in READMEs and release notes.

**Why it reads AI:** The rocket-for-getting-started, sparkles-for-features mapping is a near-deterministic GPT habit; the specific emoji-to-section pairing is rarely how individual maintainers decorate docs.

**Detect:** structural: regex headings and bullet leads for a leading emoji codepoint (U+1F300-1FAFF, U+2600-27BF) plus VS16. Flag if >=2 headers carry a leading emoji, or the rocket/sparkles/wrench/package set appears as header decoration.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2

**Fix:** Remove emoji from headers; rely on heading hierarchy and whitespace for scanning. Reserve emoji for genuine human asides in prose.

**False positive when:** Some projects mandate emoji in their own heading or commit conventions. Flag on introduction into a property that does not already use them.

**Before**

> ## 🚀 Getting Started
> ## ✨ Features
> ## 🔧 Configuration

**After**

> ## Getting Started
> ## Features
> ## Configuration

### `fabricated-testimonial-cards`  ·  high · generic-llm · marketing-copy · llm-judge · family: shape

A testimonial section with placeholder quotes attributed to alliterative invented names ('Sarah Smith, CEO at TechFlow'), AI-generated or generic avatars, and 5-star rows — for a product with no real customers.

**Why it reads AI:** Fake testimonials with alliterative names and synthetic avatars are a hollow-template tell — the generator fills the social-proof slot with plausible filler rather than real quotes.

**Detect:** llm-judge: 'Are the testimonials fabricated — too-neat alliterative names, vague company names (TechFlow, CloudSync), synthetic avatars, and quotes that fill a social-proof slot rather than coming from real customers?'

**Fix:** Remove fabricated proof until real testimonials exist. Replace with an honest early-access note, real logos you may show, or concrete product facts. Never ship invented people.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Three cards: 'This changed how our team works! — Sarah Sullivan, CEO @ TechFlow' / 'Sava Stone, CTO @ CloudSync' with stock-smiling AI avatars and 5 stars.

**After**

> A single honest line — 'In private beta with 40 teams; case studies coming soon' — or two real, attributed quotes with permission and actual photos.

### `false-precision-statistic`  ·  high · generic-llm · marketing-copy · llm-judge · family: residue

A specific-sounding number with no source: '73% of teams report improved collaboration', 'studies show a 3x increase'.

**Why it reads AI:** Precision is cheap to generate and expensive to verify. The model produces the shape of evidence because evidence-shaped claims are what its training rewarded.

**Detect:** Look for the citation. A statistic with a decimal point and no source is the strongest form.

**Fix:** Find the source, or cut the number and make the qualitative claim honestly.

**False positive when:** Real statistics are also specific. The tell is the missing source, not the number.

**Before**

> Studies show that 73% of distributed teams struggle with async communication.

**After**

> Every remote team I've worked on has had the same problem with async, and none of us solved it well.

### `h1-names-a-category-not-a-product`  ·  high · generic-llm · marketing-copy · llm-judge · family: form

The headline is a value proposition or a category description rather than a statement of what the thing is. The canonical form is a mad-lib: 'The AI-powered X for modern Y.'

**Why it reads AI:** A generator given a product name and a category has the category available and the mechanism not. The reader finishes the hero knowing which aisle the product is shelved in and nothing else.

**Detect:** Judge: after reading only the hero, can you name one thing the product does? A structural pre-filter is possible on the template shapes and on headlines containing no verb describing an action the software performs.

**Fix:** Say what it does, with a verb and an object. 'Turn Figma files into React components' beats any arrangement of platform, workspace, and modern teams. Test it by asking whether a competitor could use the same headline unchanged.

**False positive when:** Category-defining products genuinely name a category, and established brands can lead with positioning because the reader already knows the mechanism.

**Before**

> The AI-powered workspace for modern teams

**After**

> Turn Figma files into React components

### `h2-spam-full-sentence-headings`  ·  high · chatgpt · structure · structural · family: shape

A heading appears every one to two paragraphs, and the headings are full title-case sentences ('How To Structure Your Onboarding For Maximum Retention') rather than short labels. Heading density approaches paragraph density.

**Why it reads AI:** SEO/AEO scaffolding pushes the model to chunk everything under semantic headers. Humans write multi-paragraph sections under terse labels.

**Detect:** structural: compute the heading-to-paragraph ratio and heading length; flag a ratio near 1:2 combined with sentence-length, title-cased headings, or any heading whose section is a single paragraph.

**Fix:** Target a heading every 4-6 paragraphs. Make headings short noun phrases in sentence case. Delete any heading whose section is one paragraph.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> ## Why Choosing The Right CRM Matters For Your Growing Team
> A CRM keeps your data in one place.
> ## How To Evaluate CRM Pricing Tiers Effectively
> Look at per-seat costs.

**After**

> ## Choosing a CRM
> A CRM keeps customer data in one place, which matters more than the feature checklist most vendors push. Start with pricing: per-seat costs balloon once your team crosses ten people, so model the 18-month bill, not the sticker.

### `headline-then-bullets-disease`  ·  high · generic-llm · slide-deck · structural · family: shape

Every slide is a declarative claim followed by 3-5 bullets, with no connective narrative or prose. The deck becomes a stack of identically-shaped claim+list units; nothing argues, everything asserts and enumerates.

**Why it reads AI:** Humans build a talk around an arc with build-up and uneven emphasis. AI defaults to the average slide: a topic sentence plus a tidy list, repeated. The total absence of prose between bullets is the tell.

**Detect:** structural: measure the fraction of slides matching a single topic line plus a 3-5 item bullet list with no prose, and the absence of single-idea or chart-only slides; flag a deck that is near-uniformly claim+list.

**Fix:** Convert at least one in three slides to a single-idea statement, a chart with one annotation, or a narrative card. Let bullet counts vary. Add a 'so what' sentence instead of another bullet.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Slide: 'Our Q3 Strategy'
> - Expand into three new markets
> - Increase retention by 15%
> - Launch the mobile app
> - Strengthen the partner channel

**After**

> Slide: 'We bet everything on retention this quarter'
> Last year we chased new markets and leaked customers out the back. So Q3 is one number: 15% better retention. Markets wait until that holds.

### `hook-break-lesson-list-close`  ·  high · generic-llm · social-post · llm-judge · family: shape

The LinkedIn macro-frame, distinct from broetry: a standalone hook line, a blank line, a labelled transition ('Here's what I learned:', '3 things I'd do differently:'), a list of three, then an interrogative close. It survives re-flowing the paragraphs, which is what makes it a different tell from the line spacing.

**Why it reads AI:** It is the highest-engagement post structure in the training data, so it is what a model produces when asked for a LinkedIn post. It is also what a lot of humans produce, which is why it needs its base rate attached.

**Detect:** Judge the skeleton rather than the line breaks. The labelled transition plus a list of exactly three plus a question close is the shape.

**Fix:** Keep the story, drop the scaffold. Tell what happened and stop when it's told.

**False positive when:** This is a native LinkedIn convention that predates LLMs, and plenty of humans write it sincerely. Weight it by platform: LinkedIn long-form runs around 40% fully generated, so the prior is high there and nowhere else.

**Before**

> I got rejected 47 times.
> 
> Here's what I learned:
> 
> 1. Persistence matters
> 2. Feedback is a gift
> 3. Rejection isn't personal
> 
> What's your experience?

**After**

> I got rejected 47 times before Northwind said yes, and the only useful feedback came from the 31st, who told me my deck buried the number.

### `key-takeaways-box-everywhere`  ·  high · chatgpt · structure · structural · family: shape

A 'Key Takeaways,' 'TL;DR,' or 'In Summary' box bolted onto every section, not just the document top, often restating the heading and the paragraph just above it.

**Why it reads AI:** Answer-engine-optimization advice trains models to front-load standalone bullets after every heading, producing a document that summarizes itself at every level, which no human does mid-flow.

**Detect:** structural: count standalone summary/TL;DR/takeaways blocks per document and per H2; flag when they appear after most sections rather than once, especially with high n-gram overlap with the section above.

**Fix:** Keep at most one summary, at the top or bottom, never per-section. If a section needs a recap, it's too long; split or tighten it.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> ## Pricing
> We moved to usage-based billing in March...
> **Key Takeaways:**
> - We use usage-based billing
> - It started in March

**After**

> ## Pricing
> We moved to usage-based billing in March. Every plan now meters API calls instead of seats, which is why your invoice line items changed shape.

### `linkedin-broetry-one-line-runs`  ·  high · chatgpt · marketing-copy · structural · family: shape

A post built as a vertical stack of one-line paragraphs separated by blank lines, opening with a contrarian hook and building to a 'here's what it taught me' payoff. Each line is a fragment; no paragraph exceeds one sentence.

**Why it reads AI:** Humans cluster sentences into uneven blocks; the metronomic one-line-paragraph stack with a manufactured hook-and-lesson arc reads as engagement-bait template.

**Detect:** structural: measure the run length of consecutive single-sentence paragraphs and paragraph-length variance; broetry shows runs of 8+ one-line paragraphs and near-zero length variance.

**Thresholds** (read by `scripts/humanize_review.py`): `min_run` = 4, `max_words_per_line` = 14

**Fix:** Write it as 2-3 real paragraphs first. Keep line breaks only where a genuine beat lands. Drop the manufactured arc; tell what actually happened, including the part that doesn't generalize.

**False positive when:** Poetry, song lyrics, and deliberately staccato personal essays. Also: broetry predates LLMs by years — it is a human LinkedIn convention that models learned, so on LinkedIn specifically it is weak evidence.

**Before**

> I got rejected 40 times.
> 
> Then everything changed.
> 
> Here's what failure taught me about success.
> 
> Lesson 1: Never give up. 🧵

**After**

> I got rejected by 40 companies before the 41st said yes — and the 41st only happened because a friend forwarded my resume past the screener. The lesson isn't 'never give up.' It's that the application pile is a lottery you win by knowing someone.

### `magnitudes-without-a-baseline`  ·  high · generic-llm · marketing-copy · structural · family: form

'10x faster.' 'Cut costs by 40%.' A comparative claim with no comparand, no method and no source.

**Why it reads AI:** The figure does the rhetorical work of evidence while carrying none of the risk, which is exactly what a generator reaches for when it has no measurement to report. It is the visual-design sibling of the fabricated statistic.

**Detect:** Match multipliers and improvement frames attached to numbers, then check the surrounding block for a comparison target, a measurement method, a date or an outbound link. A bare percentage is deliberately NOT matched: a proportion is not a claim.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Give every number its denominator and its method, or delete it. 'Median build time fell from 4m12s to 1m50s across our own CI over March' beats '3x faster' and cannot be doubted the same way.

**False positive when:** Claims with the comparand and method already attached pass and should. Regulated industries often have approved comparative language with the substantiation held elsewhere and linked.

**Before**

> 10x faster. Save 40% on costs.

**After**

> Median build time fell from 4m12s to 1m50s, measured across our own CI over March.

### `markdown-leak-in-unrendered-medium`  ·  high · chatgpt · structure · structural · family: form

Markdown syntax pasted into a medium that does not render it — a LinkedIn post, an email body, a Slack message, a YouTube description — so the reader sees literal asterisks and hashes.

**Why it reads AI:** Nobody typing into that box would produce them. The syntax is a fossil of the interface the text was generated in, and it survives only because no one previewed the result.

**Detect:** Count **bold** spans and ATX headings in files whose extension does not render markdown.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Strip the syntax and carry the emphasis in the words. If the emphasis cannot survive that, it was decoration.

**False positive when:** Plain-text files destined for a markdown renderer, and anything in a repo where .txt files are processed. Check the destination before flagging.

**Evidence:** Widely reported by social-platform users; the literal-asterisk artifact is among the most-named giveaways in platform folklore.

**Before**

> **Key takeaway:** we shipped it. ## What's next

**After**

> The key takeaway is that we shipped it. Here's what's next.

### `mechanism-never-named`  ·  high · generic-llm · marketing-copy · llm-judge · family: form

The page describes outcomes and never says how the thing works. You finish it unable to explain the product to someone else.

**Why it reads AI:** Placeholder copy produces placeholder layout, and the causal arrow runs that way. A generator writing from a product name and a category has outcomes available to it and no mechanism, so it writes the half it has.

**Detect:** Judge: after reading the page, write one sentence explaining the mechanism. If you cannot, the page never gave you one.

**Fix:** Add the sentence that says what actually happens: what goes in, what the system does, what comes out. It is usually one sentence and it is usually the most valuable one on the page.

**False positive when:** Brand and campaign pages that deliberately withhold detail, and products whose mechanism is genuinely the category (a font shop sells fonts).

**Before**

> Empower your team to do more with less.

**After**

> We watch your bank feed and match each line to an invoice; the 2% we cannot match go to whoever owns that ledger.

### `mirror-back-research-opener`  ·  high · generic-llm · email · llm-judge · family: shape

An opener that personalizes by reciting the recipient's own public information back at them: 'I came across your profile and was truly impressed by your background', or a paraphrase of their homepage hero.

**Why it reads AI:** It signals the opposite of what it intends. Reading someone's homepage is not research, and the recipient knows what is on their own homepage.

**Detect:** Judge whether the opener contains one fact that is NOT on the recipient's public profile headline or homepage.

**Fix:** Lead with something you noticed that they would not expect you to have noticed.

**False positive when:** Referencing a specific piece of someone's public work is good outreach. The tell is reciting their own summary of themselves.

**Before**

> I noticed your company helps businesses scale their operations.

**After**

> Your changelog says you moved off Elasticsearch in March. How did the reindex go?

### `model-markup-residue`  ·  high · chatgpt · structure · structural · family: residue

Vendor scaffolding tokens leaking into shipped text: oaicite, contentReference, turn0search0, attributableIndex (ChatGPT); [cite_start] and (start_span) (Gemini); grok_render_citation_card_json (Grok); ppl-ai-file-upload (Perplexity); lenticular brackets in DeepSeek output.

**Why it reads AI:** These are the model's own internal citation and rendering markup. Nobody writes them; they survive a copy-paste that nobody proofread.

**Detect:** Literal token match against the closed vendor list. Essentially zero false positives outside a document about this very topic.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Grep and delete. Then check whether the citation each token was attached to points at anything real, because it frequently does not.

**False positive when:** Documentation about AI output artifacts (including this catalog) contains these strings deliberately. Wrap such passages in the ignore markers.

**Evidence:** Wikipedia:Signs of AI writing maintains the per-vendor token list.

**Before**

> The study found a 40% reduction :contentReference[oaicite:0]{index=0}.

**After**

> Kobak et al. found a 40% reduction.

### `promised-idea-never-delivered`  ·  high · generic-llm · structure · llm-judge · family: shape

The piece sets up an idea it never returns to. A question posed in the opening, a tension introduced, a 'we will come back to this' that never comes back.

**Why it reads AI:** Template completion. An opening that raises a question is a learned move; closing it requires holding the promise across the whole document, which nothing in the generation loop enforces.

**Detect:** Judge: list every promise the opening makes, then check each against the body. An unclosed loop is the finding.

**Fix:** Close the loop or cut the setup. Usually cutting is right, because the setup was rhetorical furniture rather than a real question. If it was a real question, answering it is probably the best part of the piece.

**False positive when:** Part one of a stated series, and pieces that explicitly defer to a linked follow-up.

**Before**

> The interesting part is what happens when the clock skews — more on that below. [no more on that below]

**After**

> The interesting part is what happens when the clock skews. [three paragraphs on clock skew]

### `substitutable-reply`  ·  high · generic-llm · social-post · llm-judge · family: shape

A comment that would fit unchanged under thousands of other posts: it restates the question, offers balanced general advice, and ends with encouragement.

**Why it reads AI:** The model answers the category, not the post. It is the social equivalent of specificity starvation, and it is what people actually mean when they say a comment feels like a bot.

**Detect:** Ask whether the reply contains one fact that could only have come from reading THIS post. If not, it is substitutable.

**Fix:** Quote the specific thing you are responding to, and say the thing only you would know.

**False positive when:** Plenty of humans write generic supportive comments, and on advice subreddits that is often the socially correct move.

**Before**

> That sounds really difficult, and it's completely valid to feel that way. Have you considered talking to a professional about it?

**After**

> The part about your manager copying HR on everything is the bit I'd document. Same thing happened to me and the paper trail is what saved it.

### `summary-restates-title-conclusion-restates-summary`  ·  high · generic-llm · structure · llm-judge · family: shape

An Executive Summary that paraphrases the title, a body that paraphrases the summary, and a Conclusion that paraphrases both, often opening with 'This document outlines...' / 'In this article, we will explore...'.

**Why it reads AI:** Models are trained to restate the thesis in summaries and conclusions without adding information, so the same sentence appears three times across layers.

**Detect:** llm-judge: 'Do the title, summary, and conclusion restate the same content across three layers without adding a finding, number, or implication — and does it open with a meta-announcing this-document-outlines frame?'

**Fix:** The summary should contain the single most important finding or number. The conclusion should add the implication or next decision. Delete 'This document outlines' openers.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Title: Q3 Marketing Performance
> Executive Summary: This document outlines our Q3 marketing performance.
> Conclusion: In conclusion, this report has covered our Q3 marketing performance.

**After**

> Executive Summary: Paid spend doubled but CAC stayed flat — the channel scaled, which it wasn't supposed to at this budget.
> Conclusion: The Q4 question is whether flat CAC survives once we exhaust the warm retargeting pool, and we don't yet know.

### `synthetic-executive-quote`  ·  high · generic-llm · marketing-copy · llm-judge · family: shape

A press-release quote attributed to a named executive that no executive said, containing no information: 'We're thrilled to partner with X to deliver best-in-class solutions to our customers.'

**Why it reads AI:** The quote slot is a template field, and the model fills it with the average of every quote it has seen. Putting a real person's name on it is the part that matters.

**Detect:** Judge whether the quote contains a fact, an opinion someone could disagree with, or a voice. Attributed quotes with none of the three are manufactured.

**Fix:** Get a real sentence from the real person, or drop the quote. A release without a quote is better than one with a fabricated one, and putting invented words in a named person's mouth is its own problem.

**False positive when:** PR quotes have been ghostwritten and approved for a century, and an approved quote is not fabricated. The line is whether the named person saw and agreed to it.

**Before**

> "We're thrilled to partner with Acme to deliver best-in-class solutions," said the CEO.

**After**

> "We bought them because we'd already rebuilt half of what they do, badly," said the CEO.

### `synthetic-review-shape`  ·  high · generic-llm · listing · llm-judge · family: shape

The generated review arc plus its content signature. Skeptic-conversion opener, three generic merits, recommendation close. It praises category virtues such as quality, value and convenience, and never names a use, a room, a defect, a comparison, or a moment.

**Why it reads AI:** Fake and generated reviews emphasize generic product merits rather than idiosyncratic experiences. A measured 3% of front-page Amazon reviews are generated, skewing toward five stars, and 93% of those carried a verified-purchase badge, so the badge does not save you.

**Detect:** Judge: does this review contain a single detail that could only come from owning the item? A corpus-level signal is stronger than the text: star-rating skew and burst timing at the product level.

**Fix:** One concrete artifact per review: what you did with it, where it sits, what went wrong, what you compared it to, how long you have had it. Drop the recommendation sentence, because the star rating already says it.

**False positive when:** 'I was skeptical' describes a genuinely common purchase experience, and most people are simply not good reviewers. Seeded and sampled reviews are legitimately labelled and legitimately glowing. Text alone on a single review is weak evidence.

**Before**

> I was skeptical at first, but this exceeded my expectations! The quality is excellent and the value is great. Highly recommend!

**After**

> Third one of these I've owned. The hinge on the previous two gave out around 14 months; this revision uses a metal pin. It does not fit a 15-inch laptop with a case on, despite the listing photo.

### `testimonial-with-no-traceable-source`  ·  high · generic-llm · marketing-copy · structural · family: form

A quote attributed to 'Sarah C., Product Manager' with a generated face. A first name, a job title, no company, no link.

**Why it reads AI:** Nothing in the attribution can be checked, which is the design rather than an oversight. The template has a testimonial slot and a testimonial needs a face, so a face is fetched from wherever faces come from.

**Detect:** Placeholder avatar hosts (pravatar, randomuser, ui-avatars, thispersondoesnotexist) are the cleanest signal, plus first-name-plus-initial attribution patterns. Near-zero false positive on the avatar hosts: no real customer has a portrait served from a random-face API.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Get a real name, role, company and a link, or take the section down. One checkable quote outperforms five unfalsifiable ones, and a page with no testimonials is more credible than a page with invented ones.

**False positive when:** Design-system documentation and component galleries use placeholder avatars correctly. Anonymised testimonials from regulated or security-sensitive customers are legitimate when the page says why the name is withheld.

**Before**

> <img src="https://i.pravatar.cc/100"> Sarah C., Product Manager

**After**

> <img src="/customers/priya.jpg"> Priya Raman, Staff SRE at Calder — <a href="/customers/calder">read the write-up</a>

### `tracking-param-residue`  ·  high · chatgpt · structure · structural · family: residue

URLs carrying utm_source=chatgpt.com, utm_source=perplexity, or a sibling attribution parameter, pasted straight out of a chat UI.

**Why it reads AI:** The chat product appends the parameter to links it surfaces. The person pasting never strips it because they never looked at the URL.

**Detect:** Regex over URLs for utm_source=(chatgpt|openai|perplexity|copilot|claude). A literal fingerprint, not a stylistic inference.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Strip query parameters from every URL before shipping. While you are in there, open each link and check it says what the sentence claims.

**False positive when:** A genuine analytics campaign could in principle use the same parameter value, but no real campaign names itself after a chatbot. Treat a hit as reliable.

**Evidence:** Wikipedia:Signs of AI writing lists utm_source parameters among citation artifacts.

**Before**

> See the report at https://example.org/report?utm_source=chatgpt.com

**After**

> See the report at https://example.org/report

### `transform-verb-marketing-formula`  ·  high · generic-llm · marketing-copy · llm-judge · family: shape

Copy leans on aspirational hollow verbs — Unlock, Elevate, Transform, Supercharge, Empower, Revolutionize, Effortlessly — attached to abstract nouns (your potential, your workflow, your business) with no concrete mechanism, often one imperative per sentence.

**Why it reads AI:** These verbs are the statistical center of mass of training-set marketing copy; they promise motion toward a good outcome while committing to nothing, which is what a model produces with no real product facts.

**Detect:** llm-judge: 'Could this exact headline sit on any other startup's page unchanged? Does it rely on aspirational verbs attached to abstract nouns with no specific, measurable outcome?'

**Fix:** Replace the verb+abstraction with a verb+concrete-outcome-with-a-number. Name the specific job. If you can't make it specific, you don't yet understand the benefit.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Unlock your team's potential. Supercharge productivity and effortlessly transform the way you work.

**After**

> Cut your weekly status meeting from 60 minutes to 10. Standups post themselves from your commits, so nobody narrates their week out loud.

### `unfilled-placeholder-residue`  ·  high · generic-llm · email · structural · family: residue

Template scaffolding shipped live. Two mechanically identical families: merge tags that never resolved ('Hi {{first_name}}', 'Hi FNAME', 'Dear Customer Name', 'Hi null,') and model bracket placeholders nobody replaced ('the [Job Title] position at [Company Name]', '[insert metric here]').

**Why it reads AI:** It is the one item in this catalog that is proof rather than inference: unreviewed generated or templated output reached a recipient. Nothing else here is that certain.

**Detect:** Regex for merge-tag and bracket-placeholder syntax. This should be a hard fail rather than a score.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Block send or publish on any placeholder pattern. Set fallbacks on every merge field, and grep the final artifact before it leaves.

**False positive when:** Documentation, template libraries, tutorials and code samples show unrendered merge tags on purpose, which is the point of them. Never fire inside fenced code, or in content whose subject IS templating. Some CRMs also render the braces in preview panes.

**Before**

> Hi {FirstName}, I'm reaching out because [Company Name] is doing interesting work in [industry].

**After**

> Hi Priya, I saw Northwind shipped the SOC 2 attestation last month.

### `unsolicited-faq-section`  ·  high · chatgpt · structure · llm-judge · family: shape

A document, email, or landing page ends with an 'FAQ' section no actual user asked, inventing well-formed questions that map one-to-one to points already made above.

**Why it reads AI:** Q&A blocks are recommended for answer-engine retrieval, so models append them by default. The questions read as reverse-engineered from the body, not from real confusion.

**Detect:** llm-judge: 'Are the FAQ questions reverse-engineered from the body (What is X? Why does X matter? How do I get started?) rather than drawn from real, recurring user confusion?'

**Fix:** Cut the FAQ unless you have logged real recurring questions. If kept, use the actual words users asked and answer only what the body didn't cover.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> ## Frequently Asked Questions
> **What is our analytics platform?** It is a tool for tracking metrics.
> **Why is analytics important?** It helps you make decisions.

**After**

> ## Questions we actually get
> **Does this double-count sessions across subdomains?** No. We key on the root domain, which is why your numbers dropped ~8% after the migration.

### `arrow-chain-as-explanation`  ·  medium · generic-llm · slide-deck · llm-judge · family: shape

Causal or process logic compressed into an arrow chain (Data -> AI -> Insights -> Revenue) that stands in for an actual explanation, often with '<- this is the key' annotations or a labeled 'money slide.'

**Why it reads AI:** Arrow chains let the model imply a mechanism without committing to one. The 'this is the key' framing mimics the gestures of a confident presenter without the reasoning that earns them.

**Detect:** llm-judge: 'Does an arrow chain imply a mechanism without explaining any link, paired with self-congratulatory this-is-the-key / money-slide labels rather than evidence for the non-obvious step?'

**Thresholds** (read by `scripts/humanize_review.py`): `min_arrows` = 2

**Fix:** Pick the one non-obvious link and explain why it holds, with evidence. Delete the self-congratulatory labels; if a slide is the key, the audience should feel it.

**False positive when:** Pipelines, state machines and build stages are genuinely arrow-shaped, and a parenthetical process gloss is ordinary shorthand. The detector skips fully-parenthesized lines and list items for this reason.

**Before**

> Data -> AI -> Insights -> Revenue
> <- this is the key
> The money slide.

**After**

> The non-obvious step is Data -> AI. Competitors have the same revenue model; what they don't have is 4 years of labeled support tickets. That corpus is why our model resolves tickets 30% faster, and that speed is the whole margin.

### `bullet-colonization-of-prose`  ·  medium · generic-llm · structure · structural · family: shape

Breaking flowing argument or narrative into headline-plus-bullet lists, including forcing a simple connected answer into a numbered listicle. Causal and temporal relationships get flattened into co-equal bullets.

**Why it reads AI:** RLHF rewarded scannable structure, so the model enumerates everything because lists are easy to generate and look organized, even when ideas are connected and need prose.

**Detect:** Bullet lines as a share of content lines, which is what the catalog always said; the earlier implementation used a bullets-to-paragraphs ratio instead and disagreed with its own rubric.

**Thresholds** (read by `scripts/humanize_review.py`): `min_bullets` = 10, `cue_share` = 0.45

**Fix:** Reserve bullets for genuinely parallel, order-independent items (steps, options, specs). Write reasoning, cause-and-effect, and narrative as paragraphs.

**False positive when:** Reference docs, changelogs, release notes and checklists are legitimately mostly bullets. Scope this to documents that are supposed to argue something.

**Before**

> Why the launch failed:
> - The timing was bad
> - This caused low signups
> - Which meant we cut the budget
> - So marketing stopped

**After**

> The launch failed mostly on timing: we shipped the week of a competitor's conference, signups came in low, and once the numbers looked bad leadership cut the budget, which ended marketing entirely.

### `bullet-restates-its-own-title`  ·  medium · generic-llm · marketing-copy · llm-judge · family: form

Each feature card has a two-word title and a body that is the title again as a sentence. 'Real-time sync — Keep everything in sync, in real time.'

**Why it reads AI:** The card has a body slot, so a body is generated, and the only guaranteed-relevant content for that slot is the title it sits under.

**Detect:** Content-word overlap between a card's title and its body, discounting stopwords. Flag when most of the title's content words reappear and the body adds no proper noun, numeral or unit.

**Fix:** Make the body say the thing the title cannot: the mechanism, the limit, the number. If you cannot, delete the body and let the title stand alone.

**False positive when:** A deliberately redundant summary line for scanning, and accessibility patterns where the body expands an abbreviated title.

**Before**

> **Real-time sync** — Keep everything in sync, in real time.

**After**

> **Real-time sync** — Changes land in about 200ms; we stream the WAL rather than polling.

### `checkmark-bullet-grid`  ·  medium · chatgpt · structure · structural · family: form

List items led by status glyphs — checkmarks, crosses, warning triangles, target and lightbulb emoji — turning every claim into a satisfied requirement.

**Why it reads AI:** It reads as a compliance table rather than as writing. The glyph asserts that each line has been verified, which is exactly the claim the document has not earned.

**Detect:** Count list lines whose first character is a status dingbat. Kept separate from emoji headings because a single checkmark is a much milder tell than an emoji H2.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Use a plain list, or a real table if the items genuinely compare along an axis.

**False positive when:** Migration checklists, test matrices and compatibility tables use these glyphs correctly and legibly. The tell is using them for claims, not for states.

**Evidence:** Observed across README and marketing-copy generation; sibling of emoji-section-headers.

**Before**

> ✅ Fast
> ✅ Secure
> ✅ Scalable

**After**

> It handles about 4,000 requests a second, runs in our SOC 2 boundary, and has survived two regional failovers.

### `credential-persona-opener`  ·  medium · generic-llm · social-post · llm-judge · family: shape

An opener claiming standing that the rest of the comment never uses: 'As someone who has worked in this field for fifteen years', followed by advice available on any search engine.

**Why it reads AI:** The frame is a rhetorical move the model has learned to perform. A person with fifteen years in a field leaks specifics without being asked.

**Detect:** Judge whether the claimed experience produces anything in the body that a non-expert could not have written.

**Fix:** Drop the credential and lead with the specific thing the credential would have taught you.

**False positive when:** Establishing standing is a real and useful convention, especially on technical subreddits where it tells readers how to weight the answer.

**Before**

> As someone who's worked in commercial insurance for over a decade, I'd say it's important to read your policy carefully.

**After**

> Check whether your policy has a 72-hour reporting window. Most commercial ones do and it's the single most common reason these get denied.

### `engagement-bait-close`  ·  medium · generic-llm · social-post · llm-judge · family: shape

The closing line that asks for interaction rather than ending the thought: 'What's your take?', 'Agree?', 'Drop a comment below', 'P.S. Follow me for more'.

**Why it reads AI:** It is a growth tactic learned as a writing convention. The model appends it because the corpus rewards it, regardless of whether a question is warranted.

**Detect:** Closed phrase bank over the final line, plus a judge call on whether the question is real.

**Fix:** End on the last real sentence. If you genuinely want an answer, ask a specific question only your readers could answer.

**False positive when:** Asking readers a genuine question is normal and good, and community managers do it professionally.

**Before**

> What's your take? Drop a comment below.

**After**

> If anyone has made the Postgres side of this work above 10k writes a second, I'd like to know how.

### `eyebrow-with-no-information`  ·  medium · generic-llm · marketing-copy · structural · family: form

The small uppercase label above a headline carrying no fact: INTRODUCING, FOR MODERN TEAMS, AI-POWERED, THE FUTURE OF WORK.

**Why it reads AI:** An eyebrow is an editorial device that presumes a hierarchy: a publication, a section, an issue. A landing page with one section has nothing for it to be above. The slot exists in the template, so the generator fills it, and the filling has to come from somewhere when no fact is available. It is among the most-cited visual giveaways in practitioner threads for exactly this reason.

**Detect:** Locate small uppercase or letterspaced elements; convict the ones containing no digit, no acronym or standard name, and no link. Capitalisation is deliberately NOT used as the signal, because 'For Modern Teams' is title-cased and says nothing.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2

**Fix:** Delete it and raise the headline. If the page reads identically you have proved it was decoration. If you keep one, make it carry the specific the headline cannot: SOC 2 TYPE II - FEB 2026, WORKS WITH POSTGRES 14+, OPEN SOURCE, AGPL-3.0. The rule of thumb is that an eyebrow must contain a proper noun, a number, a date or a licence. Then delete the eyebrow slot from the component itself, or the next generated section will fill it again.

**False positive when:** Editorial and documentation contexts where the eyebrow is a real taxonomy label (ENGINEERING, CHANGELOG, API REFERENCE, ISSUE 47) and navigates somewhere; conference pages carrying date and place; and brands whose whole system is editorial and where every eyebrow resolves to a real section. The question is not whether there is an eyebrow but whether it resolves to something a reader could navigate to or verify — which is why a linked eyebrow is never flagged.

**Before**

> <p class="uppercase tracking-widest">Introducing</p>
> <h1>The AI-powered workspace for modern teams</h1>

**After**

> <h1>Turn Figma files into React components</h1>

### `grok-forced-irreverence`  ·  medium · grok · marketing-copy · llm-judge · family: shape

Grok is prompt-tuned for an 'edgy/spicy' persona, producing try-hard irreverence: shoehorned snark, winking asides ('Buckle up, buttercup'), and contrarian 'I'm not like other AIs' posturing that doesn't fit the topic.

**Why it reads AI:** Real voice is specific and situational; Grok's is a uniform costume applied regardless of context. The constancy of the irreverence outs it as a tuned mask, not a personality.

**Detect:** llm-judge: 'Is a uniform edgy/snarky persona applied regardless of subject, with manufactured irreverence and unlike-other-AIs framing rather than wit specific to the topic?'

**Fix:** Cut the persona scaffolding. Let wit emerge from a genuinely sharp observation about the specific subject, used sparingly.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Oh, you want to know about compound interest? Buckle up, buttercup, because unlike those boring sanitized AIs, I'll give it to you straight: it's basically money making sweet love to time. Spicy, right?

**After**

> Compound interest is interest earning interest. Leave $1,000 at 7% alone and it doubles in about a decade without you lifting a finger.

### `heading-spam`  ·  medium · generic-llm · structure · structural · family: form

A heading every paragraph or two, labelling single paragraphs rather than organizing sections.

**Why it reads AI:** It is the outline the model was given, left in place. Scaffolding that was never taken down after the building went up.

**Detect:** Ratio of headings to paragraph-start lines.

**Thresholds** (read by `scripts/humanize_review.py`): `min_headings` = 5, `ratio` = 0.5

**Fix:** Cut headings that label a single paragraph. Let the prose carry the transitions.

**False positive when:** Reference documentation and API docs are legitimately heading-dense, because readers arrive by search and leave immediately. Scope to narrative prose.

**Evidence:** Wikipedia:Signs of AI writing, Excessive headings.

**Before**

> ## Why speed matters
> 
> Speed matters because users leave.
> 
> ## Why reliability matters
> 
> Reliability matters because users return.

**After**

> Speed matters because users leave; reliability matters because they come back. Both are the same argument about attention.

### `horizontal-rule-spam`  ·  medium · generic-llm · structure · structural · family: form

A thematic break inserted between every section of a document.

**Why it reads AI:** Markdown-shaped training: the model emits a document template rather than a document, and the rule is a boundary it does not trust the prose to signal.

**Detect:** Count standalone --- / *** / ___ lines outside code fences.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Delete them. If two sections need separating, the heading already does it.

**False positive when:** A single rule before a footer, an afterword, or a scene break in fiction is ordinary typography. Three or more across one document is the signal.

**Evidence:** Wikipedia:Signs of AI writing, Thematic breaks; Freeburg, arXiv:2603.27006, finds markdown structural features suppressible to zero under a prose-only instruction, so their presence is an uninstructed default.

**Before**

> ...end of section.
> 
> ---
> 
> ## Next section

**After**

> ...end of section.
> 
> ## Next section

### `kimi-linkedin-confident-slop`  ·  medium · kimi · marketing-copy · llm-judge · family: shape

Kimi K2 is RL-tuned to be confident and avoid self-qualification, producing punchy but hollow 'thought-leader' prose: short declarative power-sentences, manufactured insight, rhetorical fragments ('The result? Game-changing'), and assertion without evidence.

**Why it reads AI:** Anti-hedging training removes the qualifiers humans use when genuinely uncertain, so confidence becomes uniform and unearned, mimicking engagement-bait cadence rather than someone who knows the domain.

**Detect:** llm-judge: 'Is the passage uniformly confident with manufactured-insight framing (the-secret-nobody-tells-you, rhetorical fragment hooks) but no concrete number, example, or mechanism?'

**Fix:** Replace assertion with specifics: one concrete number, example, or mechanism beats three confident abstractions. Cut the rhetorical-fragment hooks.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Most people get productivity wrong. Here's the truth. It's not about doing more. It's about doing what matters. The result? You win back your life. Game-changing.

**After**

> I cut my task list to three items a day and finished more than when I tracked twenty, mostly because I stopped context-switching every forty minutes.

### `markdown-bold-title-case-scaffold`  ·  medium · chatgpt · structure · structural · family: shape

Structural over-formatting carried into contexts that don't call for it: bolded **key terms** mid-sentence, Title Case On Every Heading, and a recurring intro/numbered-points/'In conclusion' skeleton. Raw markdown (** and #) leaking into plain-text or wiki fields is a hard tell.

**Why it reads AI:** The bold-and-bullet scaffold is the visual signature of a chat response pasted into a document. Humans writing prose rarely bold individual terms or title-case every heading.

**Detect:** structural: count bold spans per 100 words (>2 in prose is suspicious), detect Title Case in >50% of headings, and flag literal markdown syntax where the medium renders differently (e.g. ** in a plain-text or wikitext field).

**Fix:** Strip mid-sentence bold; emphasis belongs in word choice. Use sentence case for headings. Remove 'In conclusion' wrap-ups and convert bold-lead bullet lists to prose unless genuinely a reference list.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> ## Key Benefits Of Our Approach
> - **Speed:** It is very fast.
> - **Reliability:** It rarely fails.
> In conclusion, our solution delivers **significant value**.

**After**

> ## What you get
> It's fast and it rarely falls over. That's the whole pitch.

### `markdown-scaffolding-in-casual-comment`  ·  medium · generic-llm · social-post · structural · family: shape

Bold headers, numbered sections and horizontal rules inside a threaded comment, where the surrounding replies are two sentences of lowercase.

**Why it reads AI:** The model formats every answer as a document. A person typing into a reply box does not reach for an H3.

**Detect:** Count markdown structural constructs in a comment and compare against the thread's other replies.

**Fix:** Write it as you would say it. One paragraph, no headers.

**False positive when:** Long technical answers on technical subreddits legitimately use structure, and some communities expect it. And the base rate matters enormously: Reddit replies measure around 1.7% generated against LinkedIn long-form at 40.5%, so the same formatting deserves very different weight in the two places.

**Before**

> **TL;DR:** yes.
> 
> ### Why
> 
> 1. **Cost** — it's cheaper
> 2. **Speed** — it's faster

**After**

> yeah, mostly cost. it's about a third the price and marginally faster, which surprised me

### `notability-padding`  ·  medium · generic-llm · marketing-copy · llm-judge · family: shape

Canned proof-of-importance: 'has been featured in local, regional, and national media outlets', 'garnered coverage in trade publications', 'maintains a strong digital presence'.

**Why it reads AI:** The model is satisfying an implied notability requirement rather than describing anything. Outside an encyclopedia it reads as an about-page protesting too much.

**Detect:** Judge whether any outlet, piece, or date is named. The pattern is performing the criteria for importance rather than reporting a fact.

**Fix:** Name the outlet and the piece, or cut it.

**False positive when:** A press page listing real, linked coverage is doing its job. The tell is the unnamed plural.

**Evidence:** Wikipedia:Signs of AI writing, Canned emphasis on notability.

**Before**

> Her work has been featured in numerous regional and national publications.

**After**

> The Star Tribune profiled her in 2022.

### `power-verb-metric-bullet`  ·  medium · generic-llm · resume · llm-judge · family: shape

Resume bullets built from a verb bank and an invented percentage: 'Spearheaded cross-functional initiatives resulting in a 40% increase in operational efficiency'.

**Why it reads AI:** Resume-writing advice is heavily represented in training data, so the model produces its distilled form. The percentages are generated because the corpus contains percentages, not because anyone measured anything.

**Detect:** Hit rate against the standard power-verb bank, joined with round-number percentages the candidate cannot source.

**Fix:** Name the actual thing and the actual number. If you don't have a number, describe what changed instead of inventing one.

**False positive when:** Real achievements have real metrics, and resume conventions genuinely favor this shape. Career coaches teach it. The tell is the unverifiable round number attached to an abstract noun.

**Before**

> Spearheaded cross-functional initiatives resulting in a 40% increase in team efficiency.

**After**

> Rewrote the nightly batch so it finished before standup instead of at 11am. Four teams stopped waiting on it.

### `problem-agitate-solve-by-template`  ·  medium · chatgpt · marketing-copy · llm-judge · family: shape

Landing copy mechanically executes Problem-Agitate-Solve: a rhetorical-question problem ('Tired of X?'), an agitation paragraph of stacked pain points, the product as savior, and a generic CTA ('Get Started Today').

**Why it reads AI:** PAS is the most-templated copy framework in the training set, so the model reproduces its skeleton, including the throwaway CTA, without the specificity that earns any beat.

**Detect:** llm-judge: 'Does the copy reproduce the PAS skeleton verbatim — Tired-of opener, pain pile-on, product-as-savior, throwaway Get-Started-Today CTA — without specificity in any beat?'

**Fix:** Keep the logic but break the visible scaffolding. Open with a specific scene, not 'Tired of...?'. Make the CTA describe the actual next action. Skip the agitation pile-on.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Tired of wasting time on manual reports?
> Frustrated by errors? Drowning in spreadsheets?
> Our platform changes everything.
> [Get Started Today]

**After**

> Last month your team rebuilt the same revenue report 14 times because the source numbers kept moving. This connects to the source once, so the report updates itself.
> [Connect your data — takes 2 minutes]

### `readme-boilerplate-shape`  ·  medium · chatgpt · structure · llm-judge · family: shape

A README with a fixed, project-agnostic skeleton: badge row, one-line tagline, then Features / Installation / Usage / Contributing / License in that order, every section generic and nothing specific to what the project does or why it exists.

**Why it reads AI:** The model emits the average README. Real projects front-load a quirky motivation, skip Contributing, or have idiosyncratic Usage; uniform template plus zero specifics is the tell.

**Detect:** llm-judge: 'Is this the modal open-source README template with zero project-specific motivation, examples, or quirks — interchangeable with any other repo's readme?'

**Fix:** Lead with the problem this project solves and one real example of output. Keep only sections you have content for. Delete a Contributing section that just says 'PRs welcome'.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> # Project
> ![badges]
> A powerful and flexible tool.
> ## Features
> - Fast
> - Easy to use
> ## Installation
> ## Usage
> ## Contributing
> ## License

**After**

> # pg-slowlog
> Finds the 10 queries eating your Postgres CPU and shows the missing index for each.
> ```
> $ pg-slowlog --since 1h
> ```
> ## Install / ## Caveats (it only reads pg_stat_statements)

### `rhetorical-question-hook`  ·  medium · chatgpt · marketing-copy · llm-judge · family: shape

An opening question the reader did not ask and cannot answer: 'Ever wonder why some teams ship faster than others?'

**Why it reads AI:** It is the safest possible opener: it commits to nothing and flatters the reader's curiosity. Models default to it because it never offends.

**Detect:** Judge whether the piece opens by asserting something or by asking permission to assert it.

**Fix:** Open with the claim the question was circling.

**False positive when:** A genuine question the piece then genuinely answers is a legitimate and old device.

**Before**

> Ever wonder why some teams ship faster than others?

**After**

> Teams that ship fast almost always have fewer people in the approval chain, not better engineers.

### `scripted-empathy-opener`  ·  medium · generic-llm · email · llm-judge · family: shape

Support and advice replies opening with acknowledgement boilerplate: 'I completely understand how frustrating this must be', 'I'm sorry you're going through this', before any engagement with the actual problem.

**Why it reads AI:** Alignment training rewards acknowledging feelings first, so the model performs the move whether or not it has understood the problem. Recipients read it as a script because it is one.

**Detect:** Judge whether the empathy line references anything specific to this person's situation.

**Fix:** Lead with the specific thing that went wrong for them. Demonstrated understanding reads as far more sympathetic than stated sympathy.

**False positive when:** Genuine acknowledgement is good support practice and many teams require it by policy. The tell is empathy that could precede any ticket.

**Before**

> I completely understand how frustrating this must be. Let me look into it for you.

**After**

> Your invoice ran twice on the 3rd because the retry fired after the first charge settled. I've refunded the duplicate.

### `signposting-without-structure`  ·  medium · generic-llm · structure · structural · family: shape

Meta-navigation substituted for structure: 'First we'll explore... Next we'll examine... Finally we'll conclude.' The outline is read aloud instead of being enacted.

**Why it reads AI:** The model was given an outline and emits it as prose, because announcing a structure is cheaper than building one. It costs the reader a paragraph before anything is said, and it promises a shape the piece often does not deliver.

**Detect:** Count sentences matching an ordinal plus a first-person-plural intention verb plus an exploration verb. A closed frame set, not a topic list.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 3

**Fix:** Delete the announcements and let headings and prose do the work. Where a transition is genuinely needed, make it carry information: say what changed or what the last section established, not that a new section is beginning.

**False positive when:** Tutorials and long reference documents legitimately tell the reader what the path looks like, and a single roadmap paragraph in a long piece is a kindness. Three or more is the signal.

**Before**

> First, we'll explore the architecture. Next, we will examine performance. Finally, we'll look at what comes next.

**After**

> The fix had two halves, and the second one is the interesting part.

### `subhead-restates-the-h1`  ·  medium · generic-llm · marketing-copy · llm-judge · family: form

The line under the headline says the headline again in different words, spending the most valuable position on the page on nothing.

**Why it reads AI:** The template has a subhead slot and the generator has one idea, so the idea gets said twice.

**Detect:** Judge: does the subhead add a fact the h1 lacks? If deleting it loses nothing, it was restatement.

**Fix:** Make the subhead carry what the headline could not: who it is for, what it costs, what it replaces, or the number that makes the claim credible.

**False positive when:** A subhead that deliberately expands a deliberately terse headline is doing its job, not restating.

**Before**

> H1: Ship faster with AI-powered workflows. Sub: Empower your team to do more with less.

**After**

> H1: Turn Figma files into React components. Sub: Ships typed props and variants; works with your existing design tokens.

### `subreddit-register-mismatch`  ·  medium · generic-llm · social-post · llm-judge · family: shape

Formal, structured, correctly punctuated prose posted into a venue that runs on fragments, in-jokes and lowercase.

**Why it reads AI:** Register leveling, localized. The model writes its one register regardless of where it is posting, and the mismatch is visible because the surrounding comments are right there.

**Detect:** Compare the comment's register against its five neighbours in the same thread.

**Fix:** Read the room, then write in it.

**False positive when:** Some people write formally everywhere, including in casual venues, and non-native speakers often write more formally than natives. This is the single most socially destructive check in this catalog to get wrong.

**Before**

> A three-paragraph structured answer with a bolded summary, posted in a shitposting thread.

**After**

> lol no. the connector melts at like 40 amps

### `synthetic-consensus`  ·  medium · generic-llm · social-post · llm-judge · family: shape

A comment asserting what 'most people' or 'the community' thinks, in a thread where that consensus is visibly not present.

**Why it reads AI:** The model reports the aggregate of its training rather than the state of the conversation in front of it. It cannot see the room.

**Detect:** Check the assertion against the thread it is in.

**Fix:** Cite the comment you are agreeing or disagreeing with, by what it said.

**False positive when:** Sometimes a consensus really is obvious, and long-standing community members can speak to norms accurately.

**Before**

> I think most people here would agree that the original approach was the better one.

**After**

> The top comment says the opposite, and I think it's wrong because...

### `tables-for-non-tabular-content`  ·  medium · chatgpt · structure · structural · family: shape

A two-column markdown table used for things that aren't comparative data: a single concept's pros against a one-item cons, a three-row Term/Definition gloss, or prose forced into 'Aspect | Description' cells.

**Why it reads AI:** Models learned that tables 'win' in AI readability guidance, so they reach for a grid even when the content has no second axis to compare. A one-column table betrays the reflex.

**Detect:** structural: flag tables with only one data column, or rows whose cells are full sentences, or an 'Aspect | Description' header where there is no second axis to compare across.

**Fix:** Use a table only when 2+ items are compared across 2+ shared attributes. For a term gloss use a definition list or inline bold; for one concept's tradeoffs use a short paragraph.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> | Aspect | Description |
> |---|---|
> | Speed | The system is fast |
> | Reliability | It rarely goes down |
> | Cost | It is affordable |

**After**

> The system is fast and rarely goes down, and it stays affordable because we run it on spot instances. The tradeoff: those spot instances are why the 2am batch job occasionally slips an hour.

### `unattributed-inspirational-quote-slide`  ·  medium · generic-llm · slide-deck · llm-judge · family: shape

A full-bleed slide carries a generic inspirational quote in large type, unattributed, misattributed to 'Anonymous,' or pinned to a famous name it doesn't belong to, used as filler gravitas unconnected to the argument.

**Why it reads AI:** Models reach for a motivational quote to manufacture an emotional beat and generic-ify the attribution. The quote rarely advances the argument, which is the tell.

**Detect:** llm-judge: 'Is the quote decorative gravitas — generic, hallucinated/missing attribution, and not advancing the specific next point?'

**Fix:** Cut the quote unless it's real, correctly attributed, and central. Better: replace it with a concrete artifact — a customer's actual words, a real data point.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> Slide (full bleed): "The only way to do great work is to love what you do." — Anonymous

**After**

> Slide (full bleed): "I almost cancelled in week two. The thing that kept me was your support team answering at 11pm." — actual churn-survey response, account #4471

### `agent-namespaced-branch`  ·  low · generic-llm · structure · structural · family: residue

Branch names prefixed with an agent namespace (claude/, codex/, copilot/, cursor/, ai/, bot/) or suffixed with a session hash or timestamp.

**Why it reads AI:** Tool defaults, not human naming. They survive into the merge commit and the PR URL, so they outlive the diff.

**Detect:** Regex on the branch name for the namespace prefixes and for a trailing hex or ISO-timestamp suffix.

**Fix:** Rename to what the branch does: kebab-case, explicit, brief.

**False positive when:** Teams that deliberately namespace agent branches for routing or cleanup are doing something sensible. Check the repo's branch list.

**Evidence:** libusb/hidapi AGENTS.md explicitly forbids agent-derived branch namespaces.

**Before**

> claude/fix-auth-20260914-a3f91c2

**After**

> fix-session-expiry

### `cta-names-the-click-not-the-outcome`  ·  low · generic-llm · marketing-copy · llm-judge · family: form

'Get Started', 'Learn More', 'Get Started Free' — buttons that describe the act of clicking rather than what happens next.

**Why it reads AI:** The most-represented button label in the training corpus, and the one that commits to nothing. A model that does not know what the next screen is cannot name it.

**Detect:** Judge: does the label say what the reader will have, or only that they will proceed?

**Fix:** Name the outcome and the cost: 'Start a 14-day trial, no card', 'See it run on your repo', 'Book 20 minutes'. If you cannot name the next screen, that is worth knowing before you ship the button.

**False positive when:** 'Get started' above a genuine multi-step onboarding is accurate, and established products can rely on a bare label the reader already understands.

**Before**

> Get Started Free

**After**

> Start a 14-day trial — no card

### `heading-level-skip`  ·  low · generic-llm · structure · structural · family: form

Heading levels jumped rather than nested — H1 straight to H3, or H1s used where H2s belong.

**Why it reads AI:** The outline was emitted, not read back. A person writing an outline notices the gap because they see the document as a shape.

**Detect:** Check monotonicity of heading levels in document order; flag jumps of two or more.

**Thresholds** (read by `scripts/humanize_review.py`): `min_headings` = 3

**Fix:** Renumber the headings contiguously.

**False positive when:** Some documentation generators legitimately emit skipped levels from templates. Check whether the file is generated before flagging it.

**Evidence:** Wikipedia:Signs of AI writing, Skipping heading levels.

**Before**

> # Overview
> ### Installation

**After**

> # Overview
> ## Installation

### `title-case-heading-uniformity`  ·  low · chatgpt · structure · structural · family: form

Every heading in the document set in Title Case, with no drift.

**Why it reads AI:** A house style nobody chose. Human writers drift between sentence case and title case within a document; generators do not drift.

**Detect:** Share of multi-word headings whose significant words are all capitalized.

**Thresholds** (read by `scripts/humanize_review.py`): `min_headings` = 4, `share` = 0.8

**Fix:** Pick sentence case and use it. It reads faster and dates less.

**False positive when:** Publications with an enforced Title Case style guide (many US magazines, most marketing sites) are following house style correctly. Check the property's other pages first.

**Evidence:** Wikipedia:WikiProject AI Cleanup notes heading-case habits among markdown-shaped formatting signs.

**Before**

> ## Getting Started With The New Dashboard

**After**

> ## Getting started with the new dashboard

### `title-echo`  ·  low · generic-llm · structure · llm-judge · family: shape

The document repeats its own title as its first heading, or opens by restating the title as a sentence.

**Why it reads AI:** Markdown-shaped training: the model emits a self-contained document that re-announces itself, because in its training the title and the body were separate contexts.

**Detect:** Compare the first heading, and the first sentence, against the document title.

**Fix:** Delete the echo and open on the first real sentence.

**False positive when:** Some publishing systems require an H1 matching the front-matter title, and generated docs sites do this legitimately.

**Evidence:** Wikipedia:Signs of AI writing, Title heading.

**Before**

> # Caching in Production
> 
> ## Caching in Production
> 
> Caching in production is an important topic.

**After**

> # Caching in Production
> 
> We cache three things, and two of them were mistakes.

<!-- humanize:ignore-end -->
