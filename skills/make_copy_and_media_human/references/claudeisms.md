# Claudeisms — and the generic prose tells Claude amplifies

Tells most associated with Claude-family output, plus the cross-model prose tells that show up strongest in Claude registers. Severity is how loudly the tell announces machine authorship.

_19 items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._

### `as-an-ai-leakage`  ·  high · generic-llm · prose · structural

Less RLHF-polished open models leak identity/disclaimer phrases mid-answer: 'As an AI language model, I...,' 'I do not have personal opinions, but...,' 'trained by [vendor]...'. Sometimes the wrong vendor is named.

**Why it reads AI:** This is the most unambiguous AI signature there is. No human writes 'as an AI language model'; its presence is a near-100% tell, and a wrong vendor name additionally exposes training-data contamination.

**Detect:** structural: high-precision exact/regex signature match on the leakage family ('As an AI( language model)?', 'I (do not|don't) have (personal )?(opinions|feelings|beliefs)', 'trained by (OpenAI|Google|...)'). This is a deterministic generation-artifact signature, not a fuzzy content classifier.

**Fix:** Delete the disclaimer entirely and answer in the first person or impersonally. If an opinion is wanted, give a defensible take with reasons.

**Before**

> As an AI language model, I do not have personal opinions, but the best programming language for beginners is generally considered to be Python.

**After**

> For beginners, Python is the easiest entry point: readable syntax, huge ecosystem, forgiving error messages.

### `delve-excess-vocabulary`  ·  high · generic-llm · prose · structural

A cluster of inflated 'register' words LLMs over-produce relative to pre-2023 human baselines: delve, intricate, tapestry, testament, underscore, pivotal, realm, showcasing, boasts, garner, plus marketing-register verbs (leverage, utilize, robust, seamless) and frozen phrases ('rich tapestry of', 'stands as a testament').

**Why it reads AI:** These words were rare in everyday human writing before ChatGPT; their sudden co-occurrence at high density is one of the most statistically documented AI fingerprints. A 28x frequency ratio is not something a human produces by accident.

**Detect:** structural: measure excess-frequency ratio of documented marker words against a pre-2023 corpus baseline (Kobak et al, Science Advances 2025: 'delve' ratio r=28 in 2024 PubMed, ~+1500% rise). Flag text where 2+ markers exceed ~3x baseline density, not a flag-if-present keyword scan.

**Fix:** Replace with plain equivalents: 'delve into' to 'look at' or cut; 'intricate' to 'detailed' or delete; 'underscores' to 'shows'; 'leverage/utilize' to 'use'. Delete frozen phrase scaffolding outright.

**Before**

> This report delves into the intricate dynamics of the market, underscoring the pivotal role supply chains play in this rich tapestry of global trade.

**After**

> This report looks at how supply chains shape global trade.

### `em-dash-density`  ·  high · generic-llm · prose · structural

Overuse of em dashes as all-purpose connective tissue, plus the 'em-dash-as-kicker' move where a sentence dashes to a short punchy clause for drama. Often the only interruption punctuation used, never parentheses or commas.

**Why it reads AI:** Human em-dash use is bursty and rare; the model rate is high and metronomic, and it survives even 'humanize' instructions, exposing the fine-tuning signature. The dash-comma-dash rhythm is now a learned tell.

**Detect:** structural: count em dashes (U+2014) per 1000 words. 'The Last Fingerprint' measured GPT-4.1 at 10.62 and Claude Opus 9.09 vs a human mean of 3.23; flag prose above ~5/1000. Also flag when em dashes outnumber parenthetical commas+parens combined, or >30% are sentence-final kickers (dash within the last 6 words).

**Fix:** Cap em dashes at roughly one per 200-300 words. Convert others to a period, comma, colon, or parentheses. Delete the kicker clause or promote it to its own sentence. Don't merely swap in en dashes at the same rate.

**Before**

> We shipped it Friday — and everything broke. The fix was simple — once we found it — but finding it took the whole weekend — every hour of it.

**After**

> We shipped it Friday and everything broke. The fix was simple once we found it, but finding it took the whole weekend.

### `escalating-compliment-sycophancy`  ·  high · claude · prose · llm-judge

The escalating-specificity compliment chain: 'you're the only PM who gets this, who actually reads the data, who pushes back, and who would fly to the warehouse at 2am to see it himself.' Each clause more hyper-specific than the last, ending on an unverifiable hyperbolic claim.

**Why it reads AI:** Humans rarely stack praise in this geometric, accelerating way; it reads as a model trying to please, often inventing biographical specifics for flattery.

**Detect:** llm-judge: 'Does the praise escalate in artificial specificity across stacked clauses, ending on an unverifiable biographical claim about the person?'

**Fix:** Cut the validation entirely; go straight to substance. If praise is warranted, give one specific true observation and stop. Never invent details for flattery.

**Before**

> You're absolutely right. Honestly, you're the only founder I've talked to who understands distribution, who reads their own churn cohorts, who answers support tickets personally, and who would rebuild onboarding overnight to fix it.

**After**

> Agreed. Your point about distribution is the part most founders skip, and your churn data backs it up.

### `negation-contrast-frame`  ·  high · generic-llm · prose · llm-judge

The negation-contrast family: 'It's not X, it's Y' / 'This isn't about X, it's about Y' and the parallel 'not only X but also Y' / 'not a mirror but a portal.' Mimics the shape of insight while usually setting up a strawman X just to knock it down.

**Why it reads AI:** It manufactures a reframe-reveal cadence that feels profound but frequently promises a revelation and delivers a synonym. Readers clock the formula because the X is rarely real.

**Detect:** llm-judge: 'Does this passage use a not-X-but-Y or not-only-but-also frame to inflate significance, where X is a position nobody actually held or merely a synonym of Y?'

**Fix:** State Y directly. Only keep the negation if X is a genuinely held belief you're correcting; then name who holds it and why they're wrong.

**Before**

> It's not just a database — it's a paradigm shift. This isn't only about speed, but also about reimagining how teams collaborate.

**After**

> It's a fast database that changes how teams collaborate.

### `significance-puffery-testament`  ·  high · generic-llm · prose · llm-judge

Unearned emphasis on importance and legacy: 'stands as a testament to,' 'plays a vital/pivotal role,' 'marks a significant milestone,' 'cementing its legacy,' 'a beacon of.' Wikipedia editors named promotional significance-inflation the single most consistent sign of AI text.

**Why it reads AI:** It reads like ad copy or a museum plaque written by someone who knows no facts. The 'everything is historic' tone inflates importance uniformly, which real subject-matter writers never do.

**Detect:** llm-judge: 'Does the sentence assert importance, legacy, or significance without citing a specific fact, source, or consequence?'

**Fix:** Delete the significance claim and state the concrete fact instead. Let the reader infer importance from numbers, dates, and outcomes.

**Before**

> The 1923 bridge stands as a testament to human ingenuity and plays a pivotal role in cementing the city's enduring legacy.

**After**

> The 1923 bridge carries 40,000 vehicles a day and was the longest steel span in the state when it opened.

### `staccato-fragment-triplet`  ·  high · generic-llm · prose · structural

A burst of ultra-short sentence fragments in sequence, usually three, used for false emphasis. Each is one to three words and ends in a period ('Tight. Controlled. Deliberate.'). Common in both prose gravitas and marketing copy ('Powerful. Intuitive. Built for scale.').

**Why it reads AI:** Humans use the occasional fragment for rhythm, but models deploy them in mechanical triplet bursts at a paragraph's emotional peak to simulate gravitas. The regularity is the tell, not the fragment itself.

**Detect:** structural: flag any run of 3+ consecutive period-terminated sentences each under 5 words; also flag when the ratio of sub-5-word sentences to total exceeds 0.15 in non-dialogue prose, or a paragraph's sentence-length variance spikes from adjacent fragments.

**Fix:** Keep at most one fragment per passage and earn it. Fold the rest into a full sentence with real content; add a concrete detail instead of chopping.

**Before**

> The migration worked. Tight. Controlled. Deliberate. Nothing left to chance.

**After**

> The migration worked on the first try, which surprised everyone given how little we'd tested it.

### `zero-typo-zero-contraction-affect-flatness`  ·  high · generic-llm · prose · structural

Mechanically perfect text with zero typos, zero contractions, no fragments, no genuine opinion, and flat or inflated-formal affect even where emotion is expected.

**Why it reads AI:** Humans contract, hedge with personality, occasionally err, and feel unevenly. Flawless, contraction-free, opinion-free, affect-flat prose is the uncanny-valley default of aligned models.

**Detect:** structural: combine near-zero contraction rate, zero orthographic noise, absence of first-person stance markers, and low sentiment variance across an emotionally varied topic. The conjunction signals machine authorship more than any single feature.

**Fix:** Add contractions, allow one informal aside or fragment, take an actual position with a reason, and let affect modulate. Imperfection is credibility.

**Before**

> I am very excited about this opportunity. It is a wonderful chance to grow. I do not have any concerns. The team is great and I am sure it will be successful.

**After**

> Honestly I'm thrilled about this, with one nagging worry: the timeline's tight and we've under-scoped tighter ones before. The team's strong though, so I think we pull it off.

### `apologetic-over-qualification`  ·  medium · claude · prose · llm-judge

Reflexive softening and self-undercutting: 'I could be wrong, but...,' 'This is just my take,' 'It's a bit more nuanced than that,' 'There's no one-size-fits-all answer,' wrapped around claims that don't need the disclaimer.

**Why it reads AI:** Safety-tuned caution surfaces as ritual humility and 'it depends' non-answers that a human expert would replace with a decision.

**Detect:** llm-judge: 'Does the passage repeatedly disclaim its own authority or insist the topic is complex/nuanced without adding specifics, in place of a committed call?'

**Fix:** Make the call. Replace 'it depends' with the actual dependency ('use Postgres unless you need sub-millisecond reads, then Redis'). Drop disclaimers unless you genuinely hold low confidence, then quantify it.

**Before**

> I could be wrong, and this is just my opinion, but it's a bit more nuanced than that, and honestly there's no one-size-fits-all answer here.

**After**

> Use Postgres. The only case where I'd switch is sub-millisecond key lookups at high volume, and you're nowhere near that.

### `hedging-stack`  ·  medium · claude · prose · llm-judge

Layered qualifiers that cancel each other so the sentence asserts nothing: 'While X, it's worth noting Y, though of course Z,' with ritual concessions ('that said,' 'no solution is perfect') stacked around every claim.

**Why it reads AI:** The model hedges to avoid committing, producing fluent text that says nothing. The repeated cautious scaffolding is distinctly machine-cautious.

**Detect:** llm-judge: 'Does the passage balance every assertion with a counter-assertion or stack multiple hedges that cancel out, so it conveys no committed claim?'

**Fix:** Pick the claim you believe and state it. Keep at most one genuine caveat, made specific ('this breaks above 10k rows') rather than ritual.

**Before**

> While the approach is promising, it's worth noting that results may vary, though of course context matters, and no solution is perfect.

**After**

> This approach works well under about 10,000 rows. Past that the join gets slow and you'll want to paginate.

### `heres-the-thing-pivot`  ·  medium · claude · prose · llm-judge

The faux-conversational pivot that signals a reveal: 'Here's the thing.' 'Here's the kicker.' 'But here's what's interesting.' Used to manufacture a turn even when no real twist follows.

**Why it reads AI:** It imitates a podcaster's beat-drop to fake intimacy and tension. The promised payoff is usually ordinary, so the announced turn reads as a tic.

**Detect:** llm-judge: 'Does the text use a podcaster-style here's-the-thing/kicker/catch pivot to promise a reveal whose payoff is mundane, with a setup-to-payoff ratio that reads as performance?'

**Fix:** Delete the pivot phrase and just say the thing. A genuine surprise carries the turn without announcing it.

**Before**

> We optimized the query. Here's the kicker: it was the index all along.

**After**

> We optimized the query for a week before realizing the index was missing.

### `let-me-be-clear-throat-clearing`  ·  medium · claude · prose · llm-judge

Meta-announcements of candor before saying anything: 'Let me be clear.' 'I'll be honest with you.' 'To be completely transparent.' 'Make no mistake.' Performs frankness rather than being frank.

**Why it reads AI:** The phrase advertises a forthcoming truth instead of delivering it — a hedge dressed as boldness used as a confidence-signaling transition.

**Detect:** llm-judge: 'Does the text announce that it is about to be direct/honest/clear instead of simply delivering the blunt statement?'

**Fix:** Delete the preamble and state the blunt thing immediately. The directness should live in the claim, not in an announcement about it.

**Before**

> Let me be clear: the project is behind. And let me be honest, we won't make the deadline.

**After**

> The project is three weeks behind. We will not make the deadline.

### `low-burstiness-uniform-rhythm`  ·  medium · generic-llm · prose · structural

Sentences and paragraphs of near-identical length and cadence throughout, producing a metronomic evenness with no short punchy sentences against sprawling ones. The prosodic flatness humans call 'AI cadence.'

**Why it reads AI:** Human writing is bursty, mixing a three-word sentence against a forty-word one; LLMs smooth this out, and the low variance is one of the more reliable statistical detectors when combined with other signals.

**Detect:** structural: compute sentence-length and paragraph-length coefficient of variation; flag CV well under the human baseline of ~0.5, or paragraph word-counts clustered in a narrow band. Caveat (Pangram): burstiness alone false-flags the Declaration of Independence and ESL writing, so use only as a supporting signal.

**Fix:** Deliberately vary length: drop a three-word sentence, then run a long stacked one, then snap back. Let one paragraph be a single line and the next be six. Read aloud and break the metronome.

**Before**

> The system processes requests quickly. It handles errors gracefully and retries failed calls. The queue manages backpressure when load increases. Monitoring alerts the team to issues.

**After**

> The system is fast. When a call fails it retries, backs off, and if the queue starts backing up under real load it sheds the lowest-priority work first rather than tipping over, which took three rewrites to get right. Monitoring catches the rest.

### `parallel-overload-uniform-bullets`  ·  medium · generic-llm · prose · structural

Every bullet in a list has identical grammatical shape and near-identical length — all start with an imperative verb, all run 6-9 words, all end without punctuation. Reads like a generated template.

**Why it reads AI:** AI lists cluster tightly in length and opening POS; human lists are lumpy, with one three-word bullet next to a clause with an exception.

**Detect:** structural: compute word-count variance and opening-part-of-speech uniformity across list items; flag low length variance combined with the same leading POS for every item.

**Fix:** Let items differ in length and shape. Some bullets are one word; some carry a caveat. Vary the opening word. If every bullet is the same template, you're padding to hit a count.

**Before**

> - Improve customer satisfaction across all channels
> - Increase operational efficiency through automation
> - Enhance product quality with better testing
> - Expand market reach into new regions

**After**

> - Stop the churn (we lost 200 accounts last quarter to one bug)
> - Automate the refund flow — it's the #1 support ticket
> - Ship to Canada
> - Quality: figure out why test coverage keeps dropping

### `rule-of-three-tricolon`  ·  medium · generic-llm · prose · structural

Compulsive triplets: three adjectives, three nouns, three parallel clauses or list items, used far beyond what the content warrants ('fast, reliable, and scalable'; 'plan, build, ship').

**Why it reads AI:** The tricolon is a real device, but models default to three for everything, including cases where the true count is two or five. The uniform landing on three signals a template, not a thought.

**Detect:** structural: count comma-separated parallel triples ('X, Y, and Z' adjective/noun runs joined by and/or) per 200 words and measure list-length variance. More than ~1 per 120 words, 3+ in a paragraph, or near-constant landing on three regardless of topic, flags.

**Fix:** Let the real number of items dictate the count. Use two when there are two, four when there are four. Reserve the deliberate tricolon for one genuine rhetorical peak.

**Before**

> Our platform is fast, flexible, and powerful, helping teams plan, execute, and deliver with clarity, confidence, and speed.

**After**

> The platform is fast, and flexible enough that teams stop fighting it. Mostly they just ship sooner.

### `sycophantic-affirmation-opener`  ·  medium · claude · prose · llm-judge

Reflexive unconditional praise or agreement openers: 'You're absolutely right!', 'Great question!', 'Absolutely! Here's...', often echoing the request back. The 'You're absolutely right' tic was filed as a bug against Claude Code and appears even when the user is wrong.

**Why it reads AI:** The eager, unconditional praise has no information content and often contradicts what follows ('You're absolutely right!' then a correction). It's a documented RLHF sycophancy artifact now read as obsequious filler.

**Detect:** llm-judge: 'Does the text open with unconditional affirmation or praise of the interlocutor before engaging the substance, including when the praise is unearned or contradicts what follows?'

**Fix:** Delete the opener and start with the substance. Agreement should be earned and specific; if the user is wrong, say so plainly.

**Before**

> You're absolutely right! That's a great question. I'd be happy to help you think through this. Here's what I found...

**After**

> Here's what I found...

### `tense-and-perspective-drift`  ·  medium · generic-llm · prose · structural

In longer outputs, models drift unmotivated between tenses (past to present and back within one narrative) and between perspectives ('you' to 'one' to 'we' to 'the user') without intent.

**Why it reads AI:** Humans maintain tense and address consistency almost unconsciously; models track it only locally, so long outputs accumulate drift a careful reader registers as 'something's off.'

**Detect:** structural: parse main-verb tense and second-person/impersonal pronoun choice across paragraphs; flag unmotivated tense switches within a single narrative thread and pronoun-of-address changes not justified by a register shift.

**Fix:** Pick one tense and one mode of address up front and enforce it on a full read-through. Switch only with deliberate purpose.

**Before**

> You open the terminal and ran the script. One sees an error, and we should then check the logs. The user fixes the path and it works now.

**After**

> You open the terminal and run the script. You see an error, so you check the logs, fix the path, and run it again. This time it works.

### `unattributed-floating-quote`  ·  medium · claude · prose · structural

An italicized or block-quoted line dropped in as if it were a quotation or someone's words, but no one said it and it isn't a pull quote from the piece. Aphoristic filler standing alone on its own line.

**Why it reads AI:** It borrows the visual authority of a quotation without any source, creating fake profundity. Human editors attribute quotes or write the line as plain prose.

**Detect:** structural: flag italic/blockquote lines that have no attribution, do not appear verbatim elsewhere as a cited source, and sit isolated as a standalone paragraph.

**Fix:** Attribute it to a real source, cut it, or rewrite it as a normal sentence in your own voice. Don't dress your own assertion as an anonymous epigraph.

**Before**

> The team shipped the feature.
> 
> *Sometimes the bravest thing you can build is the thing you can't yet see.*
> 
> And that changed everything.

**After**

> The team shipped the feature even though no one could prove it would matter, which was the bravest call of the quarter.

### `false-range-spectrum-framing`  ·  low · generic-llm · prose · llm-judge

The sweeping 'from X to Y' / 'whether you're a beginner or an expert' construction used to imply comprehensiveness ('from startups to enterprises,' 'from healthcare to finance').

**Why it reads AI:** The construction gestures at universal coverage cheaply, usually in intros and conclusions; the chosen endpoints add no real information.

**Detect:** llm-judge: 'Does the text use a from-X-to-Y or whether-you're-A-or-B range to imply broad coverage, where the endpoints are arbitrary and scope nothing specific?'

**Fix:** Name the specific audience or domain you actually mean, or cut the range. Breadth claims should come with at least one concrete example.

**Before**

> From startups to enterprises, from healthcare to finance, whether you're a beginner or an expert, this tool transforms how you work.

**After**

> This tool is built for two-to-ten-person data teams who are tired of maintaining Airflow themselves.
