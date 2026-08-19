# Section grammar

The per-section contract. For each section: what it is for, what it must contain, what it
must not contain, and the tell that it has gone wrong.

---

## 1. Title + one-line description — required

**For**: matching what the reader searched for, and stating the category.

**Must**: match the repository name and the package-manager name. The one-liner sits on its
own line directly under the title, under 120 characters, and matches the `description`
field in `package.json` / `Cargo.toml` / equivalent. If they disagree, the packager wins,
because that is what shows in search results.

**Must not**: contain a version number. `# Port Daddy (v3.28.2)` guarantees the title is
wrong between the release and the next README edit, and forces a version-sync gate to exist
for no reader benefit. Version belongs in a badge that reads from the registry.

**Tell it's wrong**: the one-liner is a category ("a tool for developers") rather than a
differentiator ("gives every AI agent its own port and refuses conflicting writes").

---

## 2. Badges — optional

**For**: proof, in the smallest possible space, that this is alive and installable.

**Must**: be 2–4 badges. Each must link to a live source: the CI run, the package page, the
license file, the docs site. Newline-delimited or on one line, but not a wrapping wall.

**Must not**: assert a metric that no service computes. A hardcoded `tests-7300 passing`
badge is a claim the project cannot substantiate and cannot keep current; it is worse than
absent because it demonstrates in the most prominent position on the page that the project
ships unverifiable numbers.

**Tell it's wrong**: more than five badges, or any badge whose number was typed by a human.

---

## 3. Hero media — strong yes

**For**: the ten-second gate. A stranger sees the thing working before reading a sentence.

**Must**: show *real output*. A terminal recording of the primary workflow beats a logo.
If the project has both, the recording goes here and the logo goes in the repo's social
preview image, where it actually does work.

**Must not**: be a broken link. Check the path resolves from the repository root, not from
wherever you were when you wrote it. A broken image at the top of a README is the single
most damaging defect available, because it renders as an error icon before any prose gets
to make a different impression.

**Tell it's wrong**: the media is decorative (a logo, an abstract illustration) rather than
demonstrative. Ask: does this image teach the reader what the tool does?

---

## 4. The pitch — required

**For**: converting "what is this" into "is this for me".

**Must**: be 3–6 sentences covering, in order — the problem in the reader's terms, the
approach in one clause, and who it is for. Name the reader. "If you run more than one
coding agent at once" is a better opening than "for developers".

**Must not**: enumerate features. The pitch says what *kind* of thing this is; the
capability tour says what it does. Mixing them means the reader gets neither.

**Tell it's wrong**: it contains a bulleted list, or it could be pasted into a competitor's
README with only the product name changed.

---

## 5. Quick start — required

**For**: the two-minute gate. One real success.

**Must**: be install, then the single smallest command that produces a visible result, then
that result. Copy-pasteable as a block with no placeholders the reader must fill in. If a
placeholder is unavoidable, make it obviously fake (`myapp`, not `<your-project-name>`).

**Must not**: branch. Three installation methods, four platforms, and an "or, if you prefer"
turn the two-minute gate into a decision problem. Pick the one that works for the most
readers, show it inline, and put the rest behind a `<details>` block.

**Tell it's wrong**: the reader must read a later section to make the quick start work.
That is a dependency inversion — resolve it by moving what they need up, or by picking an
example that does not need it.

---

## 6. How it works — required

**For**: the one idea that makes everything else make sense.

**Must**: state a single load-bearing concept and, ideally, draw it. Mermaid renders
natively on GitHub. Six to ten nodes. If the architecture genuinely does not fit in ten
nodes, the README shows the coarsened version and links to the full one.

**Must not**: be a component inventory. "The system has a daemon, a CLI, an MCP server, a
menu-bar app, and a console" tells the reader nothing about how to think. "One daemon owns
the truth; everything else is a projection that submits commands through one enforced door"
is the same information, ordered so the reader can predict behavior from it.

**Tell it's wrong**: after reading it, the reader still cannot guess what happens when two
things conflict.

---

## 7. Table of contents — conditional

**For**: navigation in a long file.

**Must**: appear only if the file exceeds ~150 rendered lines, and only *after* the pitch
and quick start. Link to every top-level section. Omit the title and the TOC itself.

**Must not**: be the first thing under the title. A reader who has not decided to stay does
not want a directory.

**Tell it's wrong**: it has more entries than the reader would ever click, or it is
maintained by hand and no longer matches the headings.

---

## 8. Core capabilities — required

**For**: the breadth tour. What class of problems this solves.

**Must**: be 5–9 groups, not 40 items. Each group gets a sentence and one real example with
output. Depth links out.

**Must not**: try to be complete. Completeness is the docs site's job and `--help`'s job.
A capability tour that lists every verb has stopped being a tour and become an index, and
an index in a README is guaranteed to fall behind the code that generates `--help`.

**Tell it's wrong**: it contains a table with more than about fifteen rows, or a bolded
run-on line of comma-separated command names.

---

## 9. Adopters — optional

**For**: social proof that is checkable.

**Must**: link to real repositories or products. State the inclusion bar if you accept PRs
to it (ink's is "100+ stars and showcases Ink beyond a basic list picker") — a stated bar
is what keeps the section from degrading into a link farm.

**Must not**: exist as an empty or aspirational section. Better absent than three entries
that are all the author's own projects.

---

## 10. Documentation map — required

**For**: telling the reader where the depth went, so the cuts above are not losses.

**Must**: link to the actual pages, grouped by intent — learning, doing, looking up,
understanding. Each link gets a phrase saying what the reader will find, not just a title.

**Must not**: link to directories. `docs/adr/` is not a destination; `docs/adr/0050-coast-guard.md`
is. Directory links tell the reader "go dig", which is what they came here to avoid.

**Tell it's wrong**: a link 404s, or points at a page whose title no longer matches.

---

## 11. Development & contributing — required

**For**: converting a reader into a contributor.

**Must**: state how to build, how to run the tests, and where to ask questions. State
whether PRs are accepted. Link `CONTRIBUTING.md` rather than duplicating it.

**Must not**: contain the full contribution policy. That is `CONTRIBUTING.md`'s job.

---

## 12. License — required, last

**Must**: name the license by its SPDX identifier and link the `LICENSE` file. Be the final
section of the document.

**Must not**: be summarized or paraphrased in a way that could be read as modifying it.
One sentence of plain-language gloss is fine; a paragraph of interpretation is a legal
hazard.
