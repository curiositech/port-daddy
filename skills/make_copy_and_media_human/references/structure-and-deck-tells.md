# Structure, deck, and marketing-copy tells

Document-shape tells: how generated long-form docs, slides, posts, and emails are assembled, independent of any sentence.

_20 items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._

### `bold-label-colon-bullet`  ·  high · generic-llm · structure · structural

The most recognizable AI list shape: every bullet is '**Bold Label:** explanation sentence,' uniform across the whole list. On some models (Gemini) each bullet is also separated by a blank line, producing a tall double-spaced wall.

**Why it reads AI:** Real human lists vary item structure; the rigidly uniform 'bold term: gloss' across every bullet is the single most identifiable AI list fingerprint and is never typed by hand for casual answers.

**Detect:** structural: flag any list where >=60% of items match `^\s*[-*]\s*(\*\*|__).+?(\*\*|__):\s`; 3+ consecutive items in this exact shape is a strong signal. Additional signal: blank line between every bullet combined with the bold-colon template.

**Fix:** Vary the items. Drop the bold labels unless they're true scannable keys in a reference table. Let some items be a phrase and others a full sentence; collapse to prose where it's really reasoning.

**Before**

> - **Speed:** It is fast.
> - **Reliability:** It rarely fails.
> - **Scalability:** It grows with you.
> - **Security:** It keeps data safe.

**After**

> It's fast and almost never falls over. We've pushed it to 40k concurrent users without tuning anything, and the security review came back clean.

### `conclusion-recap-tag`  ·  high · generic-llm · structure · structural

A closing paragraph flagged with 'In conclusion,' 'In short,' 'Ultimately,' 'Overall,' or 'At the end of the day' that re-states the body without adding anything.

**Why it reads AI:** Five-paragraph-essay scaffolding makes the model ring a bell to announce the wrap-up and repeat itself, even in short pieces. Real writing ends when the argument is done.

**Detect:** structural: flag a final/penultimate paragraph whose n-gram overlap with the preceding body exceeds ~50% (high lexical recall of earlier topic sentences = pure recap), independent of the opener word.

**Fix:** End on the strongest concrete point or a forward-looking specific. If a reader could skip the last paragraph and lose nothing, cut it.

**Before**

> In conclusion, caching is a powerful tool that, when used correctly, can significantly improve performance and enhance user experience.

**After**

> The trap is stale reads after a write; if you can't tolerate them, skip the cache on that path rather than tuning a TTL you'll forget.

### `emoji-section-headers`  ·  high · chatgpt · structure · structural

Headings and list items prefixed with a decorative emoji mapped to topic: rocket Getting Started, sparkles Features, wrench Configuration, package Installation, bulb Tips. Especially common in READMEs and release notes.

**Why it reads AI:** The rocket-for-getting-started, sparkles-for-features mapping is a near-deterministic GPT habit; the specific emoji-to-section pairing is rarely how individual maintainers decorate docs.

**Detect:** structural: regex headings and bullet leads for a leading emoji codepoint (U+1F300-1FAFF, U+2600-27BF) plus VS16. Flag if >=2 headers carry a leading emoji, or the rocket/sparkles/wrench/package set appears as header decoration.

**Fix:** Remove emoji from headers; rely on heading hierarchy and whitespace for scanning. Reserve emoji for genuine human asides in prose.

**Before**

> ## 🚀 Getting Started
> ## ✨ Features
> ## 🔧 Configuration

**After**

> ## Getting Started
> ## Features
> ## Configuration

### `fabricated-testimonial-cards`  ·  high · generic-llm · marketing-copy · llm-judge

A testimonial section with placeholder quotes attributed to alliterative invented names ('Sarah Smith, CEO at TechFlow'), AI-generated or generic avatars, and 5-star rows — for a product with no real customers.

**Why it reads AI:** Fake testimonials with alliterative names and synthetic avatars are a hollow-template tell — the generator fills the social-proof slot with plausible filler rather than real quotes.

**Detect:** llm-judge: 'Are the testimonials fabricated — too-neat alliterative names, vague company names (TechFlow, CloudSync), synthetic avatars, and quotes that fill a social-proof slot rather than coming from real customers?'

**Fix:** Remove fabricated proof until real testimonials exist. Replace with an honest early-access note, real logos you may show, or concrete product facts. Never ship invented people.

**Before**

> Three cards: 'This changed how our team works! — Sarah Sullivan, CEO @ TechFlow' / 'Sava Stone, CTO @ CloudSync' with stock-smiling AI avatars and 5 stars.

**After**

> A single honest line — 'In private beta with 40 teams; case studies coming soon' — or two real, attributed quotes with permission and actual photos.

### `h2-spam-full-sentence-headings`  ·  high · chatgpt · structure · structural

A heading appears every one to two paragraphs, and the headings are full title-case sentences ('How To Structure Your Onboarding For Maximum Retention') rather than short labels. Heading density approaches paragraph density.

**Why it reads AI:** SEO/AEO scaffolding pushes the model to chunk everything under semantic headers. Humans write multi-paragraph sections under terse labels.

**Detect:** structural: compute the heading-to-paragraph ratio and heading length; flag a ratio near 1:2 combined with sentence-length, title-cased headings, or any heading whose section is a single paragraph.

**Fix:** Target a heading every 4-6 paragraphs. Make headings short noun phrases in sentence case. Delete any heading whose section is one paragraph.

**Before**

> ## Why Choosing The Right CRM Matters For Your Growing Team
> A CRM keeps your data in one place.
> ## How To Evaluate CRM Pricing Tiers Effectively
> Look at per-seat costs.

**After**

> ## Choosing a CRM
> A CRM keeps customer data in one place, which matters more than the feature checklist most vendors push. Start with pricing: per-seat costs balloon once your team crosses ten people, so model the 18-month bill, not the sticker.

### `headline-then-bullets-disease`  ·  high · generic-llm · slide-deck · structural

Every slide is a declarative claim followed by 3-5 bullets, with no connective narrative or prose. The deck becomes a stack of identically-shaped claim+list units; nothing argues, everything asserts and enumerates.

**Why it reads AI:** Humans build a talk around an arc with build-up and uneven emphasis. AI defaults to the average slide: a topic sentence plus a tidy list, repeated. The total absence of prose between bullets is the tell.

**Detect:** structural: measure the fraction of slides matching a single topic line plus a 3-5 item bullet list with no prose, and the absence of single-idea or chart-only slides; flag a deck that is near-uniformly claim+list.

**Fix:** Convert at least one in three slides to a single-idea statement, a chart with one annotation, or a narrative card. Let bullet counts vary. Add a 'so what' sentence instead of another bullet.

**Before**

> Slide: 'Our Q3 Strategy'
> - Expand into three new markets
> - Increase retention by 15%
> - Launch the mobile app
> - Strengthen the partner channel

**After**

> Slide: 'We bet everything on retention this quarter'
> Last year we chased new markets and leaked customers out the back. So Q3 is one number: 15% better retention. Markets wait until that holds.

### `key-takeaways-box-everywhere`  ·  high · chatgpt · structure · structural

A 'Key Takeaways,' 'TL;DR,' or 'In Summary' box bolted onto every section, not just the document top, often restating the heading and the paragraph just above it.

**Why it reads AI:** Answer-engine-optimization advice trains models to front-load standalone bullets after every heading, producing a document that summarizes itself at every level, which no human does mid-flow.

**Detect:** structural: count standalone summary/TL;DR/takeaways blocks per document and per H2; flag when they appear after most sections rather than once, especially with high n-gram overlap with the section above.

**Fix:** Keep at most one summary, at the top or bottom, never per-section. If a section needs a recap, it's too long; split or tighten it.

**Before**

> ## Pricing
> We moved to usage-based billing in March...
> **Key Takeaways:**
> - We use usage-based billing
> - It started in March

**After**

> ## Pricing
> We moved to usage-based billing in March. Every plan now meters API calls instead of seats, which is why your invoice line items changed shape.

### `linkedin-broetry-one-line-runs`  ·  high · chatgpt · marketing-copy · structural

A post built as a vertical stack of one-line paragraphs separated by blank lines, opening with a contrarian hook and building to a 'here's what it taught me' payoff. Each line is a fragment; no paragraph exceeds one sentence.

**Why it reads AI:** Humans cluster sentences into uneven blocks; the metronomic one-line-paragraph stack with a manufactured hook-and-lesson arc reads as engagement-bait template.

**Detect:** structural: measure the run length of consecutive single-sentence paragraphs and paragraph-length variance; broetry shows runs of 8+ one-line paragraphs and near-zero length variance.

**Fix:** Write it as 2-3 real paragraphs first. Keep line breaks only where a genuine beat lands. Drop the manufactured arc; tell what actually happened, including the part that doesn't generalize.

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

### `summary-restates-title-conclusion-restates-summary`  ·  high · generic-llm · structure · llm-judge

An Executive Summary that paraphrases the title, a body that paraphrases the summary, and a Conclusion that paraphrases both, often opening with 'This document outlines...' / 'In this article, we will explore...'.

**Why it reads AI:** Models are trained to restate the thesis in summaries and conclusions without adding information, so the same sentence appears three times across layers.

**Detect:** llm-judge: 'Do the title, summary, and conclusion restate the same content across three layers without adding a finding, number, or implication — and does it open with a meta-announcing this-document-outlines frame?'

**Fix:** The summary should contain the single most important finding or number. The conclusion should add the implication or next decision. Delete 'This document outlines' openers.

**Before**

> Title: Q3 Marketing Performance
> Executive Summary: This document outlines our Q3 marketing performance.
> Conclusion: In conclusion, this report has covered our Q3 marketing performance.

**After**

> Executive Summary: Paid spend doubled but CAC stayed flat — the channel scaled, which it wasn't supposed to at this budget.
> Conclusion: The Q4 question is whether flat CAC survives once we exhaust the warm retargeting pool, and we don't yet know.

### `transform-verb-marketing-formula`  ·  high · generic-llm · marketing-copy · llm-judge

Copy leans on aspirational hollow verbs — Unlock, Elevate, Transform, Supercharge, Empower, Revolutionize, Effortlessly — attached to abstract nouns (your potential, your workflow, your business) with no concrete mechanism, often one imperative per sentence.

**Why it reads AI:** These verbs are the statistical center of mass of training-set marketing copy; they promise motion toward a good outcome while committing to nothing, which is what a model produces with no real product facts.

**Detect:** llm-judge: 'Could this exact headline sit on any other startup's page unchanged? Does it rely on aspirational verbs attached to abstract nouns with no specific, measurable outcome?'

**Fix:** Replace the verb+abstraction with a verb+concrete-outcome-with-a-number. Name the specific job. If you can't make it specific, you don't yet understand the benefit.

**Before**

> Unlock your team's potential. Supercharge productivity and effortlessly transform the way you work.

**After**

> Cut your weekly status meeting from 60 minutes to 10. Standups post themselves from your commits, so nobody narrates their week out loud.

### `unsolicited-faq-section`  ·  high · chatgpt · structure · llm-judge

A document, email, or landing page ends with an 'FAQ' section no actual user asked, inventing well-formed questions that map one-to-one to points already made above.

**Why it reads AI:** Q&A blocks are recommended for answer-engine retrieval, so models append them by default. The questions read as reverse-engineered from the body, not from real confusion.

**Detect:** llm-judge: 'Are the FAQ questions reverse-engineered from the body (What is X? Why does X matter? How do I get started?) rather than drawn from real, recurring user confusion?'

**Fix:** Cut the FAQ unless you have logged real recurring questions. If kept, use the actual words users asked and answer only what the body didn't cover.

**Before**

> ## Frequently Asked Questions
> **What is our analytics platform?** It is a tool for tracking metrics.
> **Why is analytics important?** It helps you make decisions.

**After**

> ## Questions we actually get
> **Does this double-count sessions across subdomains?** No. We key on the root domain, which is why your numbers dropped ~8% after the migration.

### `arrow-chain-as-explanation`  ·  medium · generic-llm · slide-deck · llm-judge

Causal or process logic compressed into an arrow chain (Data -> AI -> Insights -> Revenue) that stands in for an actual explanation, often with '<- this is the key' annotations or a labeled 'money slide.'

**Why it reads AI:** Arrow chains let the model imply a mechanism without committing to one. The 'this is the key' framing mimics the gestures of a confident presenter without the reasoning that earns them.

**Detect:** llm-judge: 'Does an arrow chain imply a mechanism without explaining any link, paired with self-congratulatory this-is-the-key / money-slide labels rather than evidence for the non-obvious step?'

**Fix:** Pick the one non-obvious link and explain why it holds, with evidence. Delete the self-congratulatory labels; if a slide is the key, the audience should feel it.

**Before**

> Data -> AI -> Insights -> Revenue
> <- this is the key
> The money slide.

**After**

> The non-obvious step is Data -> AI. Competitors have the same revenue model; what they don't have is 4 years of labeled support tickets. That corpus is why our model resolves tickets 30% faster, and that speed is the whole margin.

### `bullet-colonization-of-prose`  ·  medium · generic-llm · structure · structural

Breaking flowing argument or narrative into headline-plus-bullet lists, including forcing a simple connected answer into a numbered listicle. Causal and temporal relationships get flattened into co-equal bullets.

**Why it reads AI:** RLHF rewarded scannable structure, so the model enumerates everything because lists are easy to generate and look organized, even when ideas are connected and need prose.

**Detect:** structural: flag documents where bullet/list lines exceed ~40-50% of total lines in argumentative or narrative sections, a short answer (<200 words) rendered as a numbered list, or headers immediately followed by a list with no connective prose, repeated 3+ times.

**Fix:** Reserve bullets for genuinely parallel, order-independent items (steps, options, specs). Write reasoning, cause-and-effect, and narrative as paragraphs.

**Before**

> Why the launch failed:
> - The timing was bad
> - This caused low signups
> - Which meant we cut the budget
> - So marketing stopped

**After**

> The launch failed mostly on timing: we shipped the week of a competitor's conference, signups came in low, and once the numbers looked bad leadership cut the budget, which ended marketing entirely.

### `grok-forced-irreverence`  ·  medium · groq · marketing-copy · llm-judge

Grok is prompt-tuned for an 'edgy/spicy' persona, producing try-hard irreverence: shoehorned snark, winking asides ('Buckle up, buttercup'), and contrarian 'I'm not like other AIs' posturing that doesn't fit the topic.

**Why it reads AI:** Real voice is specific and situational; Grok's is a uniform costume applied regardless of context. The constancy of the irreverence outs it as a tuned mask, not a personality.

**Detect:** llm-judge: 'Is a uniform edgy/snarky persona applied regardless of subject, with manufactured irreverence and unlike-other-AIs framing rather than wit specific to the topic?'

**Fix:** Cut the persona scaffolding. Let wit emerge from a genuinely sharp observation about the specific subject, used sparingly.

**Before**

> Oh, you want to know about compound interest? Buckle up, buttercup, because unlike those boring sanitized AIs, I'll give it to you straight: it's basically money making sweet love to time. Spicy, right?

**After**

> Compound interest is interest earning interest. Leave $1,000 at 7% alone and it doubles in about a decade without you lifting a finger.

### `kimi-linkedin-confident-slop`  ·  medium · kimi · marketing-copy · llm-judge

Kimi K2 is RL-tuned to be confident and avoid self-qualification, producing punchy but hollow 'thought-leader' prose: short declarative power-sentences, manufactured insight, rhetorical fragments ('The result? Game-changing'), and assertion without evidence.

**Why it reads AI:** Anti-hedging training removes the qualifiers humans use when genuinely uncertain, so confidence becomes uniform and unearned, mimicking engagement-bait cadence rather than someone who knows the domain.

**Detect:** llm-judge: 'Is the passage uniformly confident with manufactured-insight framing (the-secret-nobody-tells-you, rhetorical fragment hooks) but no concrete number, example, or mechanism?'

**Fix:** Replace assertion with specifics: one concrete number, example, or mechanism beats three confident abstractions. Cut the rhetorical-fragment hooks.

**Before**

> Most people get productivity wrong. Here's the truth. It's not about doing more. It's about doing what matters. The result? You win back your life. Game-changing.

**After**

> I cut my task list to three items a day and finished more than when I tracked twenty, mostly because I stopped context-switching every forty minutes.

### `markdown-bold-title-case-scaffold`  ·  medium · chatgpt · structure · structural

Structural over-formatting carried into contexts that don't call for it: bolded **key terms** mid-sentence, Title Case On Every Heading, and a recurring intro/numbered-points/'In conclusion' skeleton. Raw markdown (** and #) leaking into plain-text or wiki fields is a hard tell.

**Why it reads AI:** The bold-and-bullet scaffold is the visual signature of a chat response pasted into a document. Humans writing prose rarely bold individual terms or title-case every heading.

**Detect:** structural: count bold spans per 100 words (>2 in prose is suspicious), detect Title Case in >50% of headings, and flag literal markdown syntax where the medium renders differently (e.g. ** in a plain-text or wikitext field).

**Fix:** Strip mid-sentence bold; emphasis belongs in word choice. Use sentence case for headings. Remove 'In conclusion' wrap-ups and convert bold-lead bullet lists to prose unless genuinely a reference list.

**Before**

> ## Key Benefits Of Our Approach
> - **Speed:** It is very fast.
> - **Reliability:** It rarely fails.
> In conclusion, our solution delivers **significant value**.

**After**

> ## What you get
> It's fast and it rarely falls over. That's the whole pitch.

### `problem-agitate-solve-by-template`  ·  medium · chatgpt · marketing-copy · llm-judge

Landing copy mechanically executes Problem-Agitate-Solve: a rhetorical-question problem ('Tired of X?'), an agitation paragraph of stacked pain points, the product as savior, and a generic CTA ('Get Started Today').

**Why it reads AI:** PAS is the most-templated copy framework in the training set, so the model reproduces its skeleton, including the throwaway CTA, without the specificity that earns any beat.

**Detect:** llm-judge: 'Does the copy reproduce the PAS skeleton verbatim — Tired-of opener, pain pile-on, product-as-savior, throwaway Get-Started-Today CTA — without specificity in any beat?'

**Fix:** Keep the logic but break the visible scaffolding. Open with a specific scene, not 'Tired of...?'. Make the CTA describe the actual next action. Skip the agitation pile-on.

**Before**

> Tired of wasting time on manual reports?
> Frustrated by errors? Drowning in spreadsheets?
> Our platform changes everything.
> [Get Started Today]

**After**

> Last month your team rebuilt the same revenue report 14 times because the source numbers kept moving. This connects to the source once, so the report updates itself.
> [Connect your data — takes 2 minutes]

### `readme-boilerplate-shape`  ·  medium · chatgpt · structure · llm-judge

A README with a fixed, project-agnostic skeleton: badge row, one-line tagline, then Features / Installation / Usage / Contributing / License in that order, every section generic and nothing specific to what the project does or why it exists.

**Why it reads AI:** The model emits the average README. Real projects front-load a quirky motivation, skip Contributing, or have idiosyncratic Usage; uniform template plus zero specifics is the tell.

**Detect:** llm-judge: 'Is this the modal open-source README template with zero project-specific motivation, examples, or quirks — interchangeable with any other repo's readme?'

**Fix:** Lead with the problem this project solves and one real example of output. Keep only sections you have content for. Delete a Contributing section that just says 'PRs welcome'.

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

### `tables-for-non-tabular-content`  ·  medium · chatgpt · structure · structural

A two-column markdown table used for things that aren't comparative data: a single concept's pros against a one-item cons, a three-row Term/Definition gloss, or prose forced into 'Aspect | Description' cells.

**Why it reads AI:** Models learned that tables 'win' in AI readability guidance, so they reach for a grid even when the content has no second axis to compare. A one-column table betrays the reflex.

**Detect:** structural: flag tables with only one data column, or rows whose cells are full sentences, or an 'Aspect | Description' header where there is no second axis to compare across.

**Fix:** Use a table only when 2+ items are compared across 2+ shared attributes. For a term gloss use a definition list or inline bold; for one concept's tradeoffs use a short paragraph.

**Before**

> | Aspect | Description |
> |---|---|
> | Speed | The system is fast |
> | Reliability | It rarely goes down |
> | Cost | It is affordable |

**After**

> The system is fast and rarely goes down, and it stays affordable because we run it on spot instances. The tradeoff: those spot instances are why the 2am batch job occasionally slips an hour.

### `unattributed-inspirational-quote-slide`  ·  medium · generic-llm · slide-deck · llm-judge

A full-bleed slide carries a generic inspirational quote in large type, unattributed, misattributed to 'Anonymous,' or pinned to a famous name it doesn't belong to, used as filler gravitas unconnected to the argument.

**Why it reads AI:** Models reach for a motivational quote to manufacture an emotional beat and generic-ify the attribution. The quote rarely advances the argument, which is the tell.

**Detect:** llm-judge: 'Is the quote decorative gravitas — generic, hallucinated/missing attribution, and not advancing the specific next point?'

**Fix:** Cut the quote unless it's real, correctly attributed, and critical. Better: replace it with a concrete artifact — a customer's actual words, a real data point.

**Before**

> Slide (full bleed): "The only way to do great work is to love what you do." — Anonymous

**After**

> Slide (full bleed): "I almost cancelled in week two. The thing that kept me was your support team answering at 11pm." — actual churn-survey response, account #4471
