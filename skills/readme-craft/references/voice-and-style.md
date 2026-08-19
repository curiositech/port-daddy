# Voice and style

## The Diátaxis mapping

Diátaxis splits documentation along two axes — action versus cognition, and acquisition
versus application — yielding four modes. The framework's central claim is that mixing
modes in one document produces material that serves none of the four needs well.

| Mode | Serves | Belongs in a README? |
|---|---|---|
| **Tutorial** — learning-oriented | Someone new, learning by doing | **One**, and only one: the quick start |
| **How-to guide** — task-oriented | Someone with a specific goal | No. Link out to `docs/how-to/` |
| **Reference** — information-oriented | Someone looking something up | No. Link out to `docs/` and `--help` |
| **Explanation** — understanding-oriented | Someone building a mental model | **One paragraph plus a diagram**: "how it works" |

A README is therefore *one tutorial, one explanation, and a map*. That is the whole
allowance. Every additional how-to and every reference table is the document trying to be a
docs site, and it will lose that fight while degrading at its actual job.

The practical consequence: when someone asks "shouldn't the README document X?", the
answer is almost always "the README should *link* to where X is documented." The exception
is X that a reader needs in the first two minutes.

## Style rules

Adapted from the Google developer documentation style guide, restricted to the rules that
matter most for a README.

**Voice and person**
- Second person. "You claim a port." Not "we" and not "the user".
- Active voice. Name who performs the action. "The daemon refuses the write" beats "the
  write is refused."
- Present tense. "Returns the port" — not "will return the port."
- Conversational but not frivolous. Contractions are fine. Jokes are fine if they are
  short and do not carry meaning that the reader needs.

**Sentence construction**
- Conditions before instructions. "To use a remote daemon, set `PORT_DADDY_URL`." The
  reader who is not in that condition stops reading at the comma.
- One idea per sentence. If a sentence has two clauses joined by "and" that could each
  stand alone, split it.
- Serial commas.

**Formatting**
- Sentence case for all headings.
- Code font for anything typed: commands, flags, filenames, environment variables, field
  names. Bold for UI elements.
- Numbered lists for sequences. Bulleted lists for everything else.
- Descriptive link text. Never "click here", never a bare URL, never "see the docs". A
  link reading `[the delegation modes guide]` tells a reader scanning links what they will
  get; one reading `[here]` tells them nothing and forces a round trip.

**Global audience**
- Avoid idiom that does not translate, culture-specific references, and humor that depends
  on a shared context.
- Unambiguous dates: `2026-08-18`, never `08/18/26`.

## The adjective blocklist

Each of these is a claim with no verification path. Replace with a number, a benchmark, a
comparison, or delete.

| Banned | Replace with |
|---|---|
| blazing fast, lightning fast, high performance | a measured number and how to reproduce it |
| powerful, robust, comprehensive | the specific capability that prompted the adjective |
| seamless, effortless, magical | the number of steps it actually takes |
| simple, easy, just | delete — it is a judgment about the reader, and it is wrong for whoever is struggling |
| enterprise-grade, production-ready, battle-tested | the deployment or the test count, linked |
| modern, next-generation, cutting-edge | the year, or the specific thing it does that the previous generation did not |
| flexible, extensible | the extension point, named |

`just` deserves its own note. "Just run `pd setup`" reads as reassurance to the author and
as an accusation to any reader for whom it did not work. Delete it every time.

## Prohibited constructions

**Revision-history narration.** No "previously", no "this used to be called", no "as of
v3.28", no "we recently changed". A README is read by people who have never seen a previous
version. Every version-scoped statement is a future inaccuracy with a built-in timer, and
in aggregate they turn the front door into a changelog.

The one exception is a deliberate migration notice for a rename that will strand existing
users — and that belongs in a clearly delimited "Upgrading" block or in `CHANGELOG.md`,
not woven into prose.

**Apologetic hedging.** "This is still early", "documentation is a work in progress",
"expect rough edges". Either the thing works and you say what it does, or it does not and
that belongs in a stated limitations section with specifics. Blanket hedging costs
credibility and gives the reader nothing actionable.

**Emoji as a bullet system.** One emoji per heading across twenty headings is noise: it
defeats scanning, it renders inconsistently across platforms, and screen readers announce
each one by name. Two or three deliberate emoji that carry the project's voice are fine —
in the title, in a callout, at the sign-off. Decorating every heading is the tell of a
document that nobody edited after generating.

**Undifferentiated bold.** If three words per sentence are bold, none of them are
emphasized. Bold marks the term a scanning reader must not miss, at most once or twice per
paragraph.
