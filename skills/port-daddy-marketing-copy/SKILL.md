---
name: port-daddy-marketing-copy
description: "Voice and copy guide for portdaddy.dev and Port Daddy marketing surfaces. Use when writing or editing any user-facing copy on website-v2: landing, docs, hero, CTAs, sidebar labels, page intros, ADR summaries, blog posts, email, social. NOT for internal docs (ADR bodies, code comments, CHANGELOG)."
license: FSL-1.1-MIT
allowed-tools: Read,Bash,Grep,Glob,Edit,Write
metadata:
  category: Marketing
  tags: [marketing, copy, voice, website, portdaddy.dev, swiss-modern]
  pairs-with: [port-daddy, port-daddy-agent-skill, swiss-modern-website-design]
  provenance:
    kind: first-party
    owners: [port-daddy]
---

# Port Daddy Marketing Copy

You are writing for the developer who just landed on portdaddy.dev with a
real coordination problem. They have 90 seconds before they bounce. Every
sentence on the site has to earn its place by either (a) showing them their
problem solved or (b) getting out of the way so the next sentence can.

**This site does double duty: it sells the tool AND it is Erich's portfolio.**
An engineering manager evaluating him as a hire will read these pages. So the
copy carries two jobs at once — convert the developer, and impress the EM. The
EM is reading for taste, judgment, and rigor: does this person write with
precision, sequence an argument, admit what isn't built yet, and avoid filler?
Every page should read like it was written by the strongest engineer the EM has
interviewed this year. Suave, specific, unpadded, a little dangerous. Never
padded, never hedged, never AI-shaped (see § Anti-AI-tells — non-negotiable).

## The reader

Two readers, one page:

- **The developer** — senior engineers, indie devs, tech leads who run AI coding
  agents (Claude Code, Cursor, Codex, Aider, fleets of them); have lost work to a
  `git reset --hard` collision or been warned they will; skeptical of new tools,
  pragmatic about adopting ones that work; read code-as-doc and check `git log`
  before trusting a tagline.
- **The hiring manager** — reading the same words to judge the author. They notice
  an honest "not built yet," a precise ETA, a named trade-off, a sentence that
  couldn't have come from a model. Win the developer and you win the EM; the
  qualities that convert are the same qualities that impress.

Write for them. Not for Curiositech, not for the agent generating the page,
not for an investor deck.

## The five goals (in priority order)

1. **Make them want to install it.** Every page passes this test or it gets
   cut. If a paragraph doesn't move the reader closer to running
   `brew install curiositech/tap/port-daddy`, ask why it exists.
2. **Show the technology solving real problems with ease.** Not "Port Daddy
   coordinates agents" — show two agents, the collision, and the line of
   code that prevented it.
3. **Showcase the documentation as authoritative.** Link to the deep doc
   instead of paraphrasing it. Authoritative docs get cited; verbose
   landings get skimmed.
4. **Let the Swiss-modern design carry weight the copy doesn't have to.**
   Confidence in layout, type, and whitespace means the words can be fewer
   and quieter. Adjective-stuffing fights the design; trust the design.
5. **Serve future readers, not yourself.** Anything that's there for the
   author's comfort ("we believe...", "in this section we will...") is
   noise to the reader. Cut it.

## Voice

Technically competent. Persuasive without being supercilious. Excited about
ideas, especially the ways primitives compose. Direct.

- **Confident, not cocky.** The system works; say what it does.
- **Specific over abstract.** Numbers, names, file paths. "40+ commands"
  beats "comprehensive CLI." `lib/spawner.ts` beats "the spawn module."
- **Short over long.** Two crisp sentences beat one paragraph almost every
  time. If a sentence has more than one comma, ask if it can be two
  sentences.
- **Active over passive.** "Port Daddy claims the port" not "the port is
  claimed by Port Daddy."
- **Show the joinery.** When two ideas connect — sessions and salvage,
  semantic identity and DNS, fleet YAML and the Arbiter — say so. The
  intelligence shows in the seams.

## The First Rule

**Show, don't explain.**

The user said it: "the site explains what it's doing too much. It should
just do it."

If a page says "this section helps you understand X" — delete the meta
sentence and let the section do the work. If a hero says "Port Daddy is a
local coordination service for AI agents" — show the actual command and
its actual effect, and let the reader infer the category.

## Seven rules

1. **Lead with the reader's situation, not the product.** A landing
   shouldn't open with "Port Daddy is..." — open with the problem the
   reader showed up with.
2. **One claim per sentence. One job per paragraph.** Stacking benefits
   ("fast, simple, and powerful") dilutes each one.
3. **Use the actual command name in the actual font.** `pd begin`, not
   "the begin command." Inline code is a credibility marker; it tells the
   reader this is real.
4. **Cite the doc, don't paraphrase it.** "See the [salvage
   reference](/docs/cli/salvage) for the full flag list" is better than
   re-explaining salvage at half-depth.
5. **Numbers and names are free credibility.** "317 dead agents in the
   queue" beats "many dead agents." `lib/fleet-engine.ts` beats "the fleet
   engine."
6. **Cut every sentence that starts with 'imagine,' 'simply,' 'just,' or
   'we believe.'** They signal that you're about to apologize for the
   product or wave at it instead of showing it.
7. **Read it aloud.** If you stumble, the reader will too.

## Banned phrases

These words and phrases should not appear in user-facing copy without a
specific defensible reason:

- "Powerful" / "robust" / "seamless" / "delightful" / "magical"
- "Imagine if..." / "Simply..." / "Just..."
- "We believe..." / "Our mission..." / "We think..."
- "In this section..." / "This page will explain..." / "Let's dive in..."
- "Loved by developers" / "Trusted by teams" (unless you can name them)
- "Transform your workflow" / "Supercharge your..." / "Unlock..."
- "Built different" / "Reimagined" / "Next-generation"
- "It's that simple" — it usually isn't, and saying so is condescending.
- Exclamation points outside of code blocks. The design carries emphasis;
  punctuation doesn't have to.

## Anti-AI-tells (the hiring-surface bar)

This site is a portfolio. An engineering manager will read it and form a view of
the person who built it. Copy that pattern-matches to a language model says *the
author didn't care enough to write it themselves* — the worst possible signal.
Every one of these is a tell a sharp reader clocks in under a second. None of
them ship.

**1. The decorative rule-of-three.** A trailing triad of nouns under a heading
(`claims · sessions · locks`), or the `"No X. No Y. Just Z."` cadence, or any
three-parallel-clause flourish there for rhythm instead of meaning. This is the
single most common tell. Two real specifics or five real specifics are fine; a
*decorative three* is the giveaway. If three things are genuinely what the reader
needs, keep them — but break the surrounding rhythm so the page doesn't
templatize. (Erich caught this one directly: "reads as AI trope.")

**2. The antithesis reflex.** "Not just a tool, but a platform." "It's not X,
it's Y." Delete on sight.

**3. More than one adjective on a noun.** "A powerful, comprehensive, seamless
CLI." Cut to one adjective or zero. A number or a file path does more work than
any adjective: "40 commands," not "comprehensive."

**4. Buzzword verbs:** delve, leverage, foster, ignite, empower, unleash, unlock,
underscore, streamline, harness, demystify, navigate, elevate, supercharge,
revolutionize, transform. Say the literal verb instead — claims, holds, refuses,
records, routes.

**5. Dead metaphors:** tapestry, landscape, beacon, realm, symphony, journey,
"navigate the complexities of," "the [X] landscape." `roadmap` only as the
literal product noun, never as metaphor.

**6. Transitional fluff:** furthermore, moreover, additionally, "it's worth
noting," "in conclusion," "at the end of the day," "the bottom line."

**7. Hedge-aspiration:** "aims to," "designed to," "seeks to." Sounds unsure.
State what it does.

**8. Vague-future mood words for time.** "horizon," "on the horizon," "soon,"
"in the future," "coming soon." **Give an ETA or a build-state, never a mood.**
Shipped / in progress / specified-not-built / Q3 2026. A reader evaluating you
trusts a date and distrusts a vibe. (Erich: "Give ETAs, not horizon.")

**9. Low burstiness.** Paragraphs shaped like perfect rectangles — every sentence
15–20 words, all subject-verb-object. Vary the length on purpose. A long
explanatory sentence, then a three-word punch. Six even sentences in a row is a
model writing; the unevenness is what reads as a person.

**Detection before commit:** grep the diff for the buzzword lists above and for
` · ` triads sitting under headings. Any decorative triad or buzzword on a
marketing surface is a defect, same as a contrast failure or a tiny font.

## The seven rewriting moves

When editing existing copy, these are the moves that produce the biggest
voice gains for the smallest effort.

1. **Cut the meta sentence.** "This page covers concepts" → just show
   concepts. "Below is the install guide" → just show the install
   command.
2. **Replace category words with concrete examples.** "Coordination
   primitives" → "ports, sessions, locks, channels."
3. **Promote the verb.** "Port Daddy provides session management" →
   "`pd begin` opens a session. `pd done` closes it."
4. **Trade adjectives for numbers.** "Comprehensive CLI" → "40 commands."
   "Battle-tested" → "shipping to production daily since v3.0."
5. **Pull the deep link up.** If the paragraph references a feature,
   inline the link. Don't make the reader hunt.
6. **Convert questions into commands.** "Wondering how to start?" → "Run
   `pd setup`." Questions invite passivity; commands invite action.
7. **Test with the bounce question.** Ask: "Has this paragraph done
   anything to keep the reader on the page or moved them toward an
   install?" If no, cut.

## Before and after

These before/after pairs are calibrated against the actual `website-v2`
codebase. Use them as a forcing function when you're not sure if a
sentence is doing work.

### Hero copy

**Before:**
> Port Daddy is a local-first coordination service that helps AI coding
> agents work together without conflict. Get started in minutes.

**After:**
> Two agents try to edit the same file. The second one waits.
>
> ```
> brew install curiositech/tap/port-daddy && pd setup
> ```

### Section intro

**Before:**
> In this section, we'll walk through the lifecycle of an agent session
> from start to finish, covering the begin and done commands and the
> notes you should leave along the way.

**After:**
> An agent session has three steps: begin, note, done. Skip any one of
> them and Port Daddy can't recover the work later.

### Feature description

**Before:**
> Salvage is a powerful feature that allows you to recover work from
> agents that have terminated unexpectedly, ensuring no progress is
> lost.

**After:**
> When an agent dies mid-task, its session sits in the salvage queue
> with the notes it left behind. Run `pd salvage claim <id>` to pick up
> where it stopped.

### Sidebar label

**Before:**
> Reference pages — Jump straight to the exact interface. The newer
> docs families improve reading order. The existing CLI, SDK, MCP, and
> API pages still matter when you need exact interfaces and older
> reference pages preserved.

**After:**
> Reference — Jump straight to the exact interface. When you know what
> you want — a command, an SDK method, an MCP tool, or an HTTP
> endpoint.

(The "before" here is what was in the file before this PR; the "after"
shipped in PR #23.)

## Blog Post Writing

Blog posts are the highest-leverage surface on portdaddy.dev. A developer who
finds one through Google or a friend's Slack message probably hasn't heard of
Port Daddy — and that's fine, because the post is going to do the introducing.
Write for them warmly. They're not a conversion funnel. They're a smart engineer
who has already had a bad afternoon with a runaway agent, and they're looking
for someone who gets it.

### Voice for blog posts

Blog posts are where Erich's voice comes through most clearly. Not the shouty
version — the generous, technically-excited, occasionally-digressive version
that shows up when he's explaining something he genuinely loves. Here is what
that sounds like, operationalized:

**High-low collisions.** A precise vocabulary word next to a very grounded
one. "The canonical clock vector" and "the agent just quietly ate your file"
belong in the same paragraph. Don't smooth the register into corporate evenness.
The mismatch is not an error — it's the signal that a person wrote this.

**Cathedral build, then punchline.** Don't open with the product. Open with
the situation in the world that made the product necessary. Six floors of
context — the shape of the problem, a small story, maybe an analogy — then
the product drops in near the bottom and lands clean. Section headers should
work this way too: build the frame, then name the thing.

**Em-dashes, parentheticals, asides.** These are not noise to clean up; they
are the clarity. They're how the reader knows a person wrote this rather than
a content calendar. Use them. *(Generic copywriting cuts the asides for
"flow." The asides are the flow.)*

**Wild analogies.** Every teaching page gets at least one. Pull from physics,
linguistics, biology, history, kitchen chemistry — wherever the analogy lands
cleaner than another paragraph of explanation. The reader doesn't have to
recognize the source; the analogy's *energy* is what carries.

**Lists with personality.** Every bullet is a tiny short story, or it's better
dissolved into prose. Bad: "Session recovery for crashed agents." Better: "When
an agent dies mid-task — and it will — `pd salvage` is the record it left
on its way down."

**Be warm.** The reader came here with a real problem. Meet them there, not
at the product pitch. Assume they're clever. Assume they've already tried the
obvious fix and it didn't work. The voice is collegial: *you* and *I* working
through something together, not a product brief addressing a target persona.

**Self-deprecation as ballast.** The post can acknowledge that multi-agent
coordination is genuinely hard, that the tooling is young, that the author
has also lost a Saturday to this exact problem. Confidence and warmth in the
same sentence. Don't perform invulnerability.

### The zero-knowledge contract

Assume your reader:
- Has never run `pd` or seen the daemon before.
- Does not know what "sessions," "claims," "salvage," or "harbors" mean.
- Is running AI coding agents right now and has probably lost work at least once.
- Will follow Port Daddy jargon happily — but only after you've introduced the
  pain it names.

Rule: every Port Daddy concept must be earned. Introduce the problem, then
introduce the primitive that solves it. Never lead with the primitive.

**Before:**
> Port Daddy sessions give agents a durable identity so salvage can recover them.

**After:**
> When an agent dies mid-task, the work it was doing evaporates. Port Daddy
> keeps a session open for every running agent — a named, timestamped record
> of what it was doing and what it left behind. When the agent crashes,
> `pd salvage claim <id>` picks up that record.

### Required elements in every blog post

A Port Daddy blog post that ships without all five of these is not done:

1. **At least two Mermaid diagrams.** Flowcharts showing the problem state →
   Port Daddy intervention → resolved state. Sequence diagrams for multi-agent
   coordination flows. Architecture diagrams for system relationships.
   Diagrams are not decoration — they carry load that prose cannot. Use the
   `mermaid` language fence in the markdown:
   ````
   ```mermaid
   sequenceDiagram
     AgentA->>PD: pd claim src/auth.ts
     AgentB->>PD: pd claim src/auth.ts
     PD-->>AgentB: 409 Conflict — already claimed by AgentA
   ```
   ````

2. **At least one code example per major concept.** Real commands, real flags,
   real output. Not "run the claim command" — show `pd claim src/auth.ts` and
   what the terminal says back. The inline code fence is a credibility marker;
   use it for every command, flag, and file path mentioned.

3. **At least two "Did You Know?" callouts** for non-obvious facts, surprising
   edge cases, or counterintuitive behaviors. Format as a blockquote with a
   lead label:
   ```
   > **Did you know?** `pd salvage` doesn't just find crashed agents — it
   > finds *any* session whose TTL expired without a `pd done` call. That
   > includes agents you forgot about from last Tuesday.
   ```

4. **At least three cross-links** to the docs or other posts. Every concept
   that has a dedicated doc page gets a link on first mention. Every claim
   about Port Daddy behavior that the reader might want to verify gets a link.
   "See [the salvage reference](/docs/cli/salvage)" beats re-explaining salvage
   at half-depth.

5. **A concrete install or try-it CTA** at or near the bottom. Not a banner —
   a sentence in the flow:
   > If you're not running Port Daddy yet, `brew install curiositech/tap/port-daddy`
   > takes under a minute. The [quickstart](/docs/quickstart) has you coordinated
   > in ten.

### Post structure

The reader has 90 seconds before they decide whether this post is worth their
time. Use that time well:

1. **The hook (first two paragraphs):** Lead with the concrete pain. Name a
   real scenario — agents colliding, work lost, a Saturday untangling a merge.
   No "in this post I'll cover" — open with the situation, not the syllabus.

2. **The problem frame (3–6 paragraphs + diagram):** Show the failure mode in
   detail. A Mermaid sequence or flowchart showing what goes wrong and why
   belongs here. The reader should see themselves in the failure.

3. **The mechanism (body):** Introduce Port Daddy's primitive. Define the term
   once, show the command, show the output. Interleave "Did You Know?"
   callouts for non-obvious behavior. Every jargon term gets a doc link.

4. **Depth examples:** At least one worked example with real commands and
   realistic output. If the post covers a multi-step workflow, a Mermaid
   sequence diagram goes here.

5. **Why it's built this way:** One short section explaining the design
   decision — why Port Daddy chose this primitive over a simpler one. This
   section is what makes senior engineers trust the product.

6. **Try it / CTA:** Close with a concrete next step. A command to run, a
   tutorial to follow, or a link to the relevant doc section.

### Tone for blog posts: what to avoid

The site copy rules still apply. On top of them, these specific failures show
up most in blog posts:

- **Don't assert excitement — show the thing.** "This is interesting because..."
  is a banned construction. Show the interesting thing and let the reader
  feel the click themselves.
- **Don't use royal "we."** "I" is fine when writing as the product builder.
  "We" means the author and the reader thinking together, not a company.
- **Don't make headers neutral.** "The Salvage System" is a label. "Salvage
  is a queue, not a graveyard" is an argument. Headers should take a position.
- **Don't smooth the voice for legibility.** The em-dashes, parentheticals,
  and asides are not decoration. If you find yourself cutting them for "clarity,"
  you're making the post worse.
- **Don't lecture.** The reader is not a junior dev. They are probably smarter
  than most people who've used Port Daddy. Respect that.

### Figures and callout taxonomy

| Element | Use when | Markdown pattern |
|---|---|---|
| Mermaid flowchart | Problem state vs. resolved state | ` ```mermaid\nflowchart TD\n...` |
| Mermaid sequence | Multi-agent coordination | ` ```mermaid\nsequenceDiagram\n...` |
| Code block | Any command, config, or output | ` ```bash\npd claim src/...\n` |
| Did You Know? | Surprising behavior, non-obvious edge case | `> **Did you know?** ...` |
| Inline link | Every Port Daddy noun that has a doc page | `[salvage](/docs/cli/salvage)` |
| Numbered list | Sequential steps in a workflow | Standard markdown |
| Table | Comparing options, flags, or behaviors side-by-side | Standard markdown |

Avoid: hero-image-only posts (every post needs at least one diagram inside
the body, not just a cover image), posts with no code blocks, posts where
the word "Port Daddy" only appears in the setup section and nowhere in the
worked examples.

## Where to apply this skill

Apply when editing or generating copy in:

- `website-v2/src/components/landing/*` — hero, CTAs, sections
- `website-v2/src/components/site/*` — sidebar labels, header copy
- `website-v2/src/pages/**/*.tsx` — page intros, section bodies
- `website-v2/src/data/publicSite.ts`, `product.ts`, `siteMetadata.ts`
- `website-v2/src/docs-content/*.ts` — docs content modules
- `website-v2/src/data/docs-routes.ts` — `summary` and `intro` strings
- Blog posts under `website-v2/src/data/blog*.ts`
- Whitepaper landing copy
- `README.md` user-facing sections
- Email, social, launch copy, screenshots' alt text

Do **not** apply to:

- ADR bodies (`docs/adr/*.md`) — keep internal voice
- Code comments and JSDoc
- Test descriptions
- Internal coordination notes (`docs/recovery/*`, `.cartographer/*`)
- CHANGELOG entries (those follow a separate convention)
- Skill files (these have their own voice)

## How to know you're done

Run this checklist before committing copy changes:

1. **Does the page open with the reader's problem or with a meta sentence?**
   If meta, rewrite.
2. **Does any paragraph reference a feature without linking to its doc?**
   If yes, add the link.
3. **Are there any banned phrases?** Search for them; cut or rewrite.
4. **Are there any sentences with more than one comma?** Try splitting.
5. **Are there any adjectives that don't pull weight?** Replace with a
   number, a name, or nothing.
6. **Read it aloud. Did you stumble? Did anything sound like a press
   release?** Rewrite the stumble.
7. **Bounce test: would a senior engineer reading this paragraph in 10
   seconds either install Port Daddy or click through to a deeper page?**
   If neither, the paragraph isn't earning its space.

If all seven pass, commit.

## When the design and copy disagree

The Swiss-modern design treats whitespace as a primary element. If your
copy is fighting for space, the design is signaling that the copy is
saying too much. Trust the layout: cut.

Conversely, if a section feels visually empty, don't fill it with
ornamental copy. Either let the whitespace stand or add a real piece of
content (a code block, a deep link, a number). Ornamental copy is the
single most common failure mode on portdaddy.dev today.

## A final note on excitement

The voice is excited about new ideas — that's a real instruction, not a
hedge. But excitement comes through specificity, not exclamation. The
sentence "sessions, salvage, and the merge queue all hang off the same
identity" is more exciting than "Port Daddy has an amazing identity
system!" because the first sentence shows you something you didn't know
and the second one demands you take a feeling on faith.

When you find a real connection — a primitive that turns out to compose
with another in a non-obvious way — that's where the voice lights up.
Show the connection. Let the reader feel the click.
