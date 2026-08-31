# Other model dialects — Gemini, Kimi, DeepSeek, Qwen, Llama, Grok — and cross-model translationese

Distinctive tics per model family, plus the affect-flatness tells that mark any machine register.

_13 items. Generated from catalog.json — edit there, then re-run scripts/regenerate_references.py._

### `as-an-ai-leakage`  ·  high · generic-llm · prose · structural

Less RLHF-polished open models leak identity/disclaimer phrases mid-answer: 'As an AI language model, I...,' 'I do not have personal opinions, but...,' 'trained by [vendor]...'. Sometimes the wrong vendor is named.

**Why it reads AI:** This is the most unambiguous AI signature there is. No human writes 'as an AI language model'; its presence is a near-100% tell, and a wrong vendor name additionally exposes training-data contamination.

**Detect:** structural: high-precision exact/regex signature match on the leakage family ('As an AI( language model)?', 'I (do not|don't) have (personal )?(opinions|feelings|beliefs)', 'trained by (OpenAI|Google|...)'). This is a deterministic generation-artifact signature, not a fuzzy content classifier.

**Fix:** Delete the disclaimer entirely and answer in the first person or impersonally. If an opinion is wanted, give a defensible take with reasons.

**Before**

> As an AI language model, I do not have personal opinions, but the best programming language for beginners is generally considered to be Python.

**After**

> For beginners, Python is the easiest entry point: readable syntax, huge ecosystem, forgiving error messages.

### `gemini-important-to-note-stack`  ·  high · gemini · prose · structural

Gemini compulsively front-loads or interleaves hedging meta-clauses: 'It's important to note that...,' 'It's worth remembering that...,' 'Keep in mind that...,' often two or three stacked across a short answer.

**Why it reads AI:** Humans rarely announce that they are about to say something important; they just say it. The stacked frame is a trained safety reflex that reads as institutional throat-clearing.

**Detect:** structural: compute the density of the discourse-hedge meta-clause frame ('it's [adj] to [verb] that' plus 'keep/bear in mind') per 150 words as a stylometric feature; flag >~1 per 150 words or 2+ in an answer under 400 words.

**Fix:** Delete the meta-clause and state the fact directly. If a caveat is critical, fold it into the sentence as a clause.

**Before**

> It's important to note that compound interest grows faster than simple interest. It's also worth remembering that the rate matters. Keep in mind that time horizon is a major factor.

**After**

> Compound interest outpaces simple interest, and the gap widens with both the rate and the time horizon.

### `gemini-safety-caveat-boilerplate`  ·  high · gemini · prose · llm-judge

On any topic adjacent to health, law, finance, or relationships, Gemini appends defensive boilerplate ('consult a qualified professional,' 'this is not medical/legal/financial advice,' 'individual results may vary') even when the user asked a purely factual question.

**Why it reads AI:** Reflexive liability boilerplate stapled to ordinary answers is a corporate-safety artifact. A knowledgeable human gives a caveat when it's actually warranted, not as a ritual signature.

**Detect:** llm-judge: 'Does the response append an unsolicited professional-consultation or not-X-advice disclaimer to an ordinary informational answer?'

**Fix:** Remove unsolicited disclaimers. If a genuine risk warrants a caveat, make it specific and singular.

**Before**

> Magnesium can help with sleep. However, it's important to consult a qualified healthcare professional before starting any supplement, as individual results may vary and this is not medical advice.

**After**

> Magnesium glycinate around 200-400mg before bed helps many people sleep; it can loosen stool at higher doses, so ramp up slowly.

### `llama-repetition-loop`  ·  high · llama · prose · structural

Llama-family models loop: restating the same point in slightly reworded sentences, recycling a transition ('In conclusion'), or circling a list back to its first item. Documented as higher repetition than Mixtral or OLMo.

**Why it reads AI:** Near-verbatim restatement is a decoding artifact (high-probability paths loop). Humans editing their own text delete the redundancy; the model doesn't.

**Detect:** structural: compute sentence-level n-gram overlap / cosine similarity between adjacent and near-adjacent sentences; flag when multiple pairs exceed ~0.8 similarity, or the same closing transition appears more than once.

**Fix:** Deduplicate: keep one statement of each idea, cut recycled transitions, end once. If length is needed, add evidence or examples, not paraphrases.

**Before**

> Exercise is good for your health. Staying active benefits your wellbeing. In short, being physically active is good for your health and overall wellbeing.

**After**

> Exercise lowers resting heart rate, improves insulin sensitivity, and lifts mood within weeks of starting.

### `zero-typo-zero-contraction-affect-flatness`  ·  high · generic-llm · prose · structural

Mechanically perfect text with zero typos, zero contractions, no fragments, no genuine opinion, and flat or inflated-formal affect even where emotion is expected.

**Why it reads AI:** Humans contract, hedge with personality, occasionally err, and feel unevenly. Flawless, contraction-free, opinion-free, affect-flat prose is the uncanny-valley default of aligned models.

**Detect:** structural: combine near-zero contraction rate, zero orthographic noise, absence of first-person stance markers, and low sentiment variance across an emotionally varied topic. The conjunction signals machine authorship more than any single feature.

**Fix:** Add contractions, allow one informal aside or fragment, take an actual position with a reason, and let affect modulate. Imperfection is credibility.

**Before**

> I am very excited about this opportunity. It is a wonderful chance to grow. I do not have any concerns. The team is great and I am sure it will be successful.

**After**

> Honestly I'm thrilled about this, with one nagging worry: the timeline's tight and we've under-scoped tighter ones before. The team's strong though, so I think we pull it off.

### `deepseek-qwen-overformal-register`  ·  medium · deepseek · prose · structural

DeepSeek and Qwen default to a stiff, examination-essay register in English: elevated connectives, zero contractions, and an earnest formality mismatched to casual prompts. Tone reads as a translated academic abstract.

**Why it reads AI:** The uniformly elevated register with no tonal variance reads as machine-translated formal Chinese academic prose. Native casual English mixes registers and uses contractions.

**Detect:** structural: combine near-zero contraction rate, high frequency of formal sentence-initial connectives (>1 per 120 words), and high Latinate-formality lexical density. The conjunction of all three on an informal prompt is the signal.

**Fix:** Drop a register: use contractions, swap 'Moreover/Furthermore' for 'and/also' or a new sentence, and let some sentences be short and plain. Match the formality the user used.

**Before**

> Moreover, it is imperative to acknowledge that regular exercise confers substantial benefits. Furthermore, one must endeavor to maintain consistency to attain optimal results.

**After**

> Exercise pays off, but only if you keep at it. Consistency beats intensity here.

### `gemini-question-restatement`  ·  medium · gemini · prose · llm-judge

Gemini opens by restating the user's question as a thesis before answering: 'The question of whether X is Y is a nuanced one' or 'Understanding how to Z requires looking at several factors.'

**Why it reads AI:** Restating the prompt is a comprehension-display behavior from instruction tuning. Human writers assume shared context and start with substance.

**Detect:** llm-judge: 'Does the opening sentence echo or restate the prompt as a thesis before any substantive claim?'

**Fix:** Cut the restatement and lead with the answer's first real claim. The reader knows what they asked.

**Before**

> The question of whether remote work improves productivity is a multifaceted one that depends on several factors. To understand this, we must consider...

**After**

> Remote work raises productivity for focused individual tasks and lowers it for fast-iteration collaboration. The split is the whole story.

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

### `low-burstiness-uniform-rhythm`  ·  medium · generic-llm · prose · structural

Sentences and paragraphs of near-identical length and cadence throughout, producing a metronomic evenness with no short punchy sentences against sprawling ones. The prosodic flatness humans call 'AI cadence.'

**Why it reads AI:** Human writing is bursty, mixing a three-word sentence against a forty-word one; LLMs smooth this out, and the low variance is one of the more reliable statistical detectors when combined with other signals.

**Detect:** structural: compute sentence-length and paragraph-length coefficient of variation; flag CV well under the human baseline of ~0.5, or paragraph word-counts clustered in a narrow band. Caveat (Pangram): burstiness alone false-flags the Declaration of Independence and ESL writing, so use only as a supporting signal.

**Fix:** Deliberately vary length: drop a three-word sentence, then run a long stacked one, then snap back. Let one paragraph be a single line and the next be six. Read aloud and break the metronome.

**Before**

> The system processes requests quickly. It handles errors gracefully and retries failed calls. The queue manages backpressure when load increases. Monitoring alerts the team to issues.

**After**

> The system is fast. When a call fails it retries, backs off, and if the queue starts backing up under real load it sheds the lowest-priority work first rather than tipping over, which took three rewrites to get right. Monitoring catches the rest.

### `qwen-deepseek-chinglish-calque`  ·  medium · qwen · prose · llm-judge

Qwen and DeepSeek occasionally surface calques and idiom mistranslations from Chinese: 'more and more X' for 'increasingly,' 'play an important role,' odd article use ('the China'), and stray untranslated tokens. Grammatical but subtly non-native.

**Why it reads AI:** Calque idioms and article slips are L1-Chinese transfer patterns. A native English writer wouldn't produce 'more and more people pay attention to' as default register; clustered, they expose a Chinese-trained model.

**Detect:** llm-judge: 'Does the text show clustered L1-Chinese transfer patterns — more-and-more for increasingly, plays-an-important-role, article slips, or stray non-English tokens — that read as non-native?'

**Fix:** Replace calques with natural English ('increasingly' not 'more and more'; 'is central to' not 'plays an important role'), fix article usage, and read aloud for cadence.

**Before**

> More and more people pay attention to the environment protection. Technology plays an important role and brings more and more convenience to our daily life.

**After**

> People increasingly care about the environment, and technology keeps making daily life more convenient.

### `tense-and-perspective-drift`  ·  medium · generic-llm · prose · structural

In longer outputs, models drift unmotivated between tenses (past to present and back within one narrative) and between perspectives ('you' to 'one' to 'we' to 'the user') without intent.

**Why it reads AI:** Humans maintain tense and address consistency almost unconsciously; models track it only locally, so long outputs accumulate drift a careful reader registers as 'something's off.'

**Detect:** structural: parse main-verb tense and second-person/impersonal pronoun choice across paragraphs; flag unmotivated tense switches within a single narrative thread and pronoun-of-address changes not justified by a register shift.

**Fix:** Pick one tense and one mode of address up front and enforce it on a full read-through. Switch only with deliberate purpose.

**Before**

> You open the terminal and ran the script. One sees an error, and we should then check the logs. The user fixes the path and it works now.

**After**

> You open the terminal and run the script. You see an error, so you check the logs, fix the path, and run it again. This time it works.

### `kimi-longform-collapse`  ·  low · kimi · prose · structural

Kimi K2 holds voice well under ~300 words but degrades past ~3000: structure loosens, the assertive register flattens into repetition, and it loses the thread it opened with.

**Why it reads AI:** The quality cliff at length is a generation artifact (context drift, repetition pressure). A human writer's last third is usually their tightest after revision; the model's is its weakest, inverting the normal signal.

**Detect:** structural: measure coherence decay across the document — declining type-token ratio and rising inter-paragraph similarity in the final third versus the first third; flag a sharp degradation gradient after ~3k words.

**Fix:** For long pieces, generate in bounded sections with a fixed outline and a maintained through-line, then hand-edit the back half where coherence drops.

**Before**

> [A 4,000-word essay whose final third re-explains intro points in vaguer terms and trails into generic summary.]

**After**

> [The same essay cut to 1,500 words with each section earning its place and a conclusion that synthesizes rather than recycles.]
