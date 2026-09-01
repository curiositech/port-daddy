# Voice References

This repository file is the portable, reviewed source for the voice rules used
by the skill. Re-read it before every drafting session. It also includes
operator-approved example paragraphs that demonstrate the register applied to
formal-methods exposition.

## The seven tells

> **1. High-low collisions in the same breath.** SAT-prep word next to basement-hole word. *autochthonous* and "the weird scary basement hole closet" in the same paragraph. The fancy word and the homely word are both critical — together they signal "I am a person who reads, who notices, who isn't going to perform a register at you." Do not smooth into corporate evenness. If the right word is *syncretic*, use *syncretic*. If the right word is *gross*, use *gross*.
>
> **2. Cathedral build, then punchline.** Long-form Erich never arrives at the ask directly. Six floors of context — constraints, history, delicious tangents, analogies — then a clean line near the bottom that delivers. For site copy: open with the connective tissue, not the feature list. Tell me what you saw in the world that made the product necessary, then drop the product into the story.
>
> **3. The em-dash, the parenthetical, the aside-as-genre.** The asides are not noise to clean up — they ARE the clarity. They're how a reader can tell a human wrote this. Em-dashes in clusters. Parentheticals that carry the actual wit. Sentence fragments. Punchy. *(Generic copywriters cut these for "clarity." They are the clarity.)*
>
> **4. Wild analogies between disparate things.** Dog leashes via braid groups + Lord Kelvin's vortex atoms + DNA supercoiling. ASOIAF entropy via Borges' Garden of Forking Paths. Win 3.1 cooperative multitasking ↔ multi-agent orchestration. The reader doesn't have to recognize the analogy — the analogy's *energy* is what carries. On any teaching page, this gear should be engaged.
>
> **5. Lists with personality, never bullets-as-spec.** Each item a tiny short story. Generic: "Goal-tracking with reminders." Erich: "A nag — but with a good reason and a soft voice." If a bullet has no voice it's better as prose.
>
> **6. Word-as-affection.** Precise diction is how Erich loves a thing. "1×12 pine boards, collar ties." "Browse rows, oversize rows, short boxes." Calling a thing by its real name is the move. The taxonomy is the love.
>
> **7. Self-deprecation as ballast.** Maximalist demand wrapped in maximalist compliment, then a "hello" dropped on the end like walking into a room. Confident and warm in the same sentence. Wound and pride in the same sentence. The site can hold both. Don't scrub the warmth or the wobble.

## Banned phrases (carry over from marketing-copy, plus expository-specific)

From `port-daddy-marketing-copy/SKILL.md`:

- "Powerful" / "robust" / "seamless" / "delightful" / "magical"
- "Imagine if..." / "Simply..." / "Just..."
- "We believe..." / "Our mission..." / "We think..."
- "In this section..." / "This page will explain..." / "Let's dive in..."
- "Loved by developers" / "Trusted by teams" (unless you can name them)
- "Transform your workflow" / "Supercharge your..." / "Unlock..."
- "Built different" / "Reimagined" / "Next-generation"
- "It's that simple"

Expository-specific additions:

- **"As is well known"** — the reader doesn't know. Cut.
- **"Clearly"** / **"obviously"** / **"trivially"** — every time these appear, they signal that the author skipped a step the reader needed. Either supply the step or remove the adverb.
- **"It is left as an exercise"** — fine in a textbook, condescending in expository writing. If it matters, walk through it.
- **"As shown above"** / **"as we will see"** — meta-noise. Just show it.
- **"In some sense"** — vague throat-clearing. Either say *in what sense* or cut.
- **"Naively"** as a technical adjective — borderline. *"The naive expected-value calculation"* (from the paper) is fine because *naive* is a critical word in mechanism design. *"Naively one might think..."* as a rhetorical device is not.

## Voice-applied-to-verifiers: operator-approved example paragraphs

These are short paragraphs that demonstrate the register applied to specific formal-methods topics. Use them as a calibration set — when you draft a new paragraph on the same topic, ask whether it would sit comfortably next to these.

### On ProVerif's threat model

> ProVerif's adversary is named, after the paper that introduced it: Dolev-Yao, 1981. The adversary controls the network — every message you send, the adversary reads, can replay, can compose with other messages it has seen, can rewrite. The adversary cannot break the cryptography itself: signatures are unforgeable, encryptions are opaque without the key, hashes are collision-free. Inside that model — and the model is the critical word — if ProVerif proves the secret stays secret, the secret stays secret against *every* adversary the model permits. It is not a guarantee about the universe; it is a guarantee about the bouncer's idea of an adversary.

### On TLA+ as daydream

> TLA+ asks you to write down what your system *means*, not what it does. You describe the state of the world (variables), the initial conditions (`Init`), and the steps the world is allowed to take (`Next`). Then you write down what you wish were always true (`Inv`) or what you wish would eventually happen (`Liveness`). The model checker — TLC for explicit-state, Apalache for the symbolic backend that handles parameterized models — walks every interleaving of every step from every initial state, holding `Inv` and `Liveness` up against each one, and tells you whether they hold. When they don't, the checker hands you the shortest trace that breaks them. The trace is gold. It is the bug, named and dated.

### On Kani as the gnat inside Rust

> Kani lives inside a Rust crate the way a parasite lives inside a host: invisibly, but with leverage. You write `#[kani::proof]` over a function, mark inputs as `kani::any()` (meaning *any possible byte string of this type*), and Kani hands the whole thing to a SAT solver — specifically, CBMC under the hood — which looks for a concrete input that violates an assertion. If it finds one, you get the bytes. You can save those bytes to a fuzz corpus and you've turned a formal counterexample into a regression test. (This is the trick: symbolic execution and concrete fuzzing want to share inputs. Kani makes them.) Kani is bounded — it unrolls loops up to a depth you specify, and below that depth its proofs are real. Above it, you have a budget question, not a proof question.

### On Pareto dominance, applied

> *Pareto-dominates* is one of those phrases that gets used loosely in tech and precisely in economics. The precise version, the one the paper means: regime A Pareto-dominates regime B if every participant is at least as well off in A as in B, and at least one participant is strictly better off in A. Nobody loses; somebody wins. This is a high bar. Most policy changes that improve aggregate welfare are not Pareto improvements, because somebody pays. The Youle claim is *not* that the auction is welfare-maximizing in the utilitarian sense; it's the stronger and weirder claim that no agent ends up worse off than they would have under the committee-chosen bond price. That stronger claim is why empirical confirmation, not just a closed-form proof, matters: Pareto dominance is fragile, and the simulation is the place where the fragility shows.

## Where to grow this file

Add new operator-approved paragraphs here as the expository corpus grows. Each new entry should:

- Be ≤ 200 words.
- Cover one specific topic (one verifier, one mechanism, one theorem).
- Demonstrate at least four of the seven tells.
- Carry a header naming the topic.

If a paragraph is added that the operator later edits, replace the version here with the edited form. This file is the calibration set; it has to stay current.
