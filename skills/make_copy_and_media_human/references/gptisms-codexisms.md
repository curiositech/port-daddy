# GPT-isms and Codexisms

ChatGPT's service voice and README register, and the code-comment tells of Codex/Copilot-shaped generation.

_19 items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._

### `comment-narrates-next-line`  ·  high · codex · code-comments · structural

Inline comments that restate exactly what the following statement does in English: `// increment counter`, `# loop through items`, `// return the result`. The comment adds zero information beyond reading the line.

**Why it reads AI:** Codex/Copilot learned the comment-then-code pattern from tutorials and emits narration by default. Experienced devs comment the why, not the what.

**Detect:** structural: for each comment line, compare its tokens to the immediately following code line; flag when the comment is a verb-phrase paraphrase of the next statement. A high ratio of such comments per file is the signal.

**Fix:** Delete comments that paraphrase the code. Keep comments for non-obvious rationale, edge cases, units, or ticket links. Often a clearer name is the better fix.

**Before**

> // increment the retry counter
> retries += 1
> // check if we hit the max
> if retries > MAX: ...

**After**

> retries += 1
> if retries > MAX:  # give up; upstream 503s have been seen to last ~30s

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

### `placeholder-stub-residue`  ·  high · codex · code-comments · structural

Generated scaffolding left in place: placeholder identifiers (foo, bar, MyComponent, doSomething, example_function), `# TODO: implement` / `throw new Error('Not implemented')` bodies, and dummy return values never filled in.

**Why it reads AI:** These are literal artifacts of the model emitting a template it expected a human to finish. Placeholder names and unfilled stubs in committed code signal nobody wrote the logic.

**Detect:** structural: scan code for the placeholder identifier set, bodies consisting only of TODO/FIXME/NotImplemented/pass, and 'TODO: implement'. Flag if any ship in non-scaffold files. (Operates on code identifiers, not free-text prose.)

**Fix:** Name things after their real domain role; implement the body or delete the stub. If genuinely deferring, write a TODO with an owner, ticket link, and what's missing.

**Before**

> function MyComponent() {
>   // TODO: implement
>   return null;
> }

**After**

> function InvoiceRow({ invoice }) {
>   return <tr><td>{invoice.number}</td><td>{formatCents(invoice.totalCents)}</td></tr>;
> }

### `service-voice-bookends`  ·  high · chatgpt · prose · structural

Replies open with an eager exclamatory affirmation ('Certainly!', 'Great question!', 'Absolutely!') and close with a customer-service signoff ('I hope this helps!', 'Let me know if you have any questions!'). The substance is sandwiched between concierge phrases.

**Why it reads AI:** The relentless upbeat helpfulness is RLHF assistant-persona residue; humans answering a colleague don't preface with praise for the question or sign off like a support ticket.

**Detect:** structural: flag when the first sentence is a standalone exclamatory affirmation under 5 words ending in '!', and/or the final paragraph is a single sentence that is an offer of further help. Count of these positional bookends per document.

**Fix:** Delete the opener and closer. Start with the answer's first real claim; end on the last substantive point. If a handoff is genuinely needed, make it specific.

**Before**

> Great question! Configuring the cache is straightforward. [answer] I hope this helps! Let me know if you have any other questions.

**After**

> Cache config lives in two places, and the second one usually bites people: the per-route TTL silently overrides the global default.

### `swallow-exception-pass`  ·  high · codex · code-comments · structural

Error handling that catches broadly and discards: `try: ... except Exception: pass`, or catches only to print and continue with no rethrow, no context. Often paired with an over-apologetic comment.

**Why it reads AI:** Models produce defensively-shaped but functionally hollow error handling to make the snippet run. Swallowing every exception silently is flagged immediately by senior reviewers.

**Detect:** structural: AST/regex scan for bare or broad except whose body is only `pass`, a log/print, or `return None`; and JS `catch(e){ console.log(...) }` with no rethrow. Count per file.

**Fix:** Catch the specific exception you can handle; let the rest propagate. Log with context and rethrow, or convert to a domain error. Never `except Exception: pass`.

**Before**

> try:
>     data = fetch(url)
> except Exception as e:
>     print('Error:', e)  # something went wrong

**After**

> try:
>     data = fetch(url)
> except requests.Timeout:
>     raise UpstreamUnavailable(url) from None  # caller retries with backoff

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

### `dive-delve-openers`  ·  medium · chatgpt · prose · llm-judge

Sections and intros launch with movement-metaphor throat-clearing: 'Let's dive in,' 'Let's delve into,' 'When it comes to X,' 'In today's fast-paced world.' The opener announces that discussion is about to happen instead of discussing.

**Why it reads AI:** These are the statistically safest connective openers a model picks; they're so associated with ChatGPT they appear in academic-fraud studies of paper abstracts.

**Detect:** llm-judge: 'Does the paragraph or section open with a runway phrase (let's dive in, when it comes to, in today's world) that announces the topic rather than starting on the actual content?'

**Fix:** Cut the runway. Open on the actual content or a concrete specific.

**Before**

> Let's dive into the world of authentication. When it comes to securing your API, there are several key factors to consider.

**After**

> API auth fails in two ways that matter: stolen tokens and replayed requests. Short-lived tokens fix the first; nonces fix the second.

### `docstring-restates-signature`  ·  medium · codex · code-comments · llm-judge

Docstrings that re-enumerate the signature with no added meaning: 'This function takes a and b and returns the result.' Args/Returns sections that just retype parameter names and types already visible in the declaration.

**Why it reads AI:** The model fills the docstring slot because the template demands one, paraphrasing the signature rather than documenting behavior. Humans omit a docstring before writing a contentless one.

**Detect:** llm-judge: 'Does the docstring only paraphrase the signature, omitting units, valid ranges, failure modes, side effects, or examples?'

**Fix:** Document what the signature can't say: units, ranges, what raises, side effects, an example. If there's nothing beyond the signature, delete the docstring.

**Before**

> def divide(a: float, b: float) -> float:
>     """Divide a by b and return the result.
>     Args: a: the first number; b: the second number
>     Returns: the result"""

**After**

> def divide(a: float, b: float) -> float:
>     """Raises ZeroDivisionError when b == 0; callers must guard. Result is not rounded."""

### `email-pleasantry-boilerplate`  ·  medium · chatgpt · prose · llm-judge

Emails open with 'I hope this email finds you well' / 'Just circling back' and over-structure a simple request with bolded deadlines and numbered sub-asks.

**Why it reads AI:** These openers are the blandest possible phrasings a model optimizes toward; the mismatch between a trivial request and an elaborately scaffolded format is the giveaway.

**Detect:** llm-judge: 'Does the email use the blandest inoffensive openers and over-scaffold a trivial request with bolded action items, mismatching format to the size of the ask?'

**Fix:** Open with the actual reason for writing. Cut 'hope this finds you well.' Match structure to size: a one-line ask gets one line.

**Before**

> Hi Sarah,
> I hope this email finds you well! I wanted to circle back regarding the report.
> **Action Items:**
> 1. Please review the document
> 2. **Deadline: Friday**

**After**

> Hi Sarah,
> Can you look over the report by Friday? Mainly want your eyes on the revenue section before it goes to the board.

### `hedged-disclaimer-ending`  ·  medium · chatgpt · prose · llm-judge

Closes with a defensive caveat hedging that the answer might not fit: 'Note that you may need to adjust this based on your specific setup,' 'requirements may vary,' 'this is a general example and should be adapted.'

**Why it reads AI:** The model disclaims to avoid being wrong, producing a liability-shield sentence with no information. Humans either name the specific thing to adjust or trust the reader to adapt.

**Detect:** llm-judge: 'Does the piece end with a generic non-informative caveat telling the reader to adapt it, rather than naming the specific variable that actually changes between setups?'

**Fix:** Replace the generic hedge with the one concrete variable that changes between setups, or delete it.

**Before**

> This should work for most cases. Note that you may need to adjust the configuration based on your specific environment and requirements.

**After**

> This assumes Redis on the default port; if yours is TLS-only, add rediss:// and the CA path — nothing else changes.

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

### `over-apologetic-error-explanation`  ·  medium · chatgpt · prose · llm-judge

When explaining a bug or correction, the response over-apologizes: 'I apologize for the confusion,' 'You're absolutely right, my mistake,' 'Apologies for any inconvenience' — repeated and disproportionate to the issue.

**Why it reads AI:** Assistant-tuning over-weights deference, producing ritual apology. Humans correct course with a brief acknowledgement and move on.

**Detect:** llm-judge: 'Is the apology-to-substance ratio high — ritual contrition that precedes or replaces the actual correction?'

**Fix:** Acknowledge once, briefly and specifically, then spend the words on the fix.

**Before**

> I sincerely apologize for the confusion and any inconvenience caused. You're absolutely right, and I apologize for my mistake. Let me correct that.

**After**

> You're right — the loop should stop at len-1, not len. Fixed bound below.

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

### `trailing-example-usage-block`  ·  medium · codex · code-comments · structural

A library module ends with a tacked-on demonstration: an `if __name__ == '__main__':` block or a `// Example usage:` comment with sample calls that print a canned result, added reflexively even when the module is imported elsewhere.

**Why it reads AI:** Codex appends a runnable demo because training examples (tutorials, gists) ended that way. In a real codebase the example belongs in tests or docs.

**Detect:** structural: flag a trailing `if __name__ == '__main__'` or example-usage block in a file that is clearly a library module (exports symbols, imported by others), especially when it just prints or calls functions with literal args.

**Fix:** Move example usage into the test suite or README. A library module should expose its API and stop. Keep `__main__` only for genuine CLI entry points.

**Before**

> # ... module code ...
> # Example usage:
> if __name__ == '__main__':
>     print(add(2, 3))  # 5

**After**

> # (module ends after its definitions; an example lives in tests/test_add.py)
