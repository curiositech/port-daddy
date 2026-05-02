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

## The reader

Senior engineers, indie devs, and tech leads who:

- Run AI coding agents (Claude Code, Cursor, Codex, Aider, fleets of them).
- Already lost work to a `git reset --hard` collision, or have been told it
  could happen.
- Are skeptical of new tools but pragmatic about adopting ones that work.
- Read code-as-doc. They will check `git log` before they trust a tagline.

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
