# Engineering-artifact tells — commits, PRs, reviews, code, tests, docs

What generated engineering work looks like in the artifacts maintainers actually read. The highest-precision checks in this file are all RELATIVE — drift from the repo's own log, idiom, or PR norm — because those need no word list, do not age as models change, and a contributor who read the surrounding code passes them automatically.

_36 items. Generated from catalog.json — edit there, then re-run `scripts/regenerate_references.py`. Do not hand-edit this file._

_Every item carries a **False positive when** line. Read it before you act on the item: these are cues for an editor, not evidence about an author._

<!-- humanize:ignore-start
     Everything below is a specimen catalog. It quotes the tells it documents,
     including literal machine residue, so reviewing it with humanize_review.py
     would flag the exhibits rather than the writing. -->

### `comment-narrates-next-line`  ·  high · codex · code-comments · structural · family: code

Inline comments that restate exactly what the following statement does in English: `// increment counter`, `# loop through items`, `// return the result`. The comment adds zero information beyond reading the line.

**Why it reads AI:** Codex/Copilot learned the comment-then-code pattern from tutorials and emits narration by default. Experienced devs comment the why, not the what.

**Detect:** structural: for each comment line, compare its tokens to the immediately following code line; flag when the comment is a verb-phrase paraphrase of the next statement. A high ratio of such comments per file is the signal.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2, `overlap` = 0.6

**Fix:** Delete comments that paraphrase the code. Keep comments for non-obvious rationale, edge cases, units, or ticket links. Often a clearer name is the better fix.

**False positive when:** Teaching code, tutorial repositories and beginner-facing examples narrate deliberately and correctly. Check what the file is for.

**Before**

> // increment the retry counter
> retries += 1
> // check if we hit the max
> if retries > MAX: ...

**After**

> retries += 1
> if retries > MAX:  # give up; upstream 503s have been seen to last ~30s

### `commit-body-restates-diff`  ·  high · generic-llm · commit-message · structural · family: code

A commit body enumerating, file by file, what the diff already shows, instead of explaining why the change exists.

**Why it reads AI:** The model has the diff in context and nothing else, so restating it is the only content it can safely produce. Humans write commit bodies precisely for the information that is NOT in the diff.

**Detect:** Compare the body's content lines against the changed file and symbol names from git show --stat. High one-to-one overlap plus no causal connective (because, so that, was breaking) is the flag. Also flag bodies whose bullets are '- **<filename>**: <restated change>'.

**Fix:** Delete the enumeration. Keep one paragraph: the problem, why this approach, what you rejected. If the body only restates the diff, use a one-line subject and no body.

**False positive when:** A long body is correct on a large or subtle change. The tell is restatement, not length.

**Evidence:** grain anti-slop linter rules VAGUE_COMMIT / NO_CONTEXT; astronomer-cosmos AGENTS.md ('explain what and why, not how').

**Before**

> This commit introduces a comprehensive authentication system.
> - **auth/login.py**: Added the login() function
> - **auth/models.py**: Added the User model

**After**

> Add password login
> 
> Sessions were cookie-only, so the mobile client had no way in. Issues a 24h JWT; refresh comes in a follow-up.

### `confident-wrong-security-finding`  ·  high · generic-llm · code-review · llm-judge · family: code

A security or correctness finding, stated with full confidence and correct-sounding vocabulary, that is wrong about this codebase.

**Why it reads AI:** Security vocabulary is highly patterned, so it generates fluently without any of the reasoning that would make it true. This has been costly enough that curl's maintainer publicly documented the burden of AI bug-bounty slop.

**Detect:** Judge: does the finding cite a specific line, a specific reachable input, and a specific consequence? Generated findings name a vulnerability CLASS and assert it applies.

**Fix:** Require a proof of reachability before filing: the input, the path, the observed effect. If you cannot produce one, do not file it.

**False positive when:** Real findings also sound confident. Judge the presence of a reachability proof, not the tone.

**Evidence:** Daniel Stenberg's public accounts of AI-generated curl bug-bounty reports.

**Before**

> This code is vulnerable to SQL injection via string concatenation.  (the line uses a parameterized query)

**After**

> (not filed — the query is parameterized at db/users.py:42)

### `convention-drift-in-commit-style`  ·  high · generic-llm · commit-message · structural · family: code

Conventional Commits appearing in a repo whose history does not use them — or a bare sentence subject in a repo that enforces them. The mismatch is the tell, never the format.

**Why it reads AI:** Conventional Commits dominate training data, so it is the model's default whatever the repo does. A human reads git log before their first commit; a model does not unless told.

**Detect:** Share of the last 200 subjects matching the conventional-commit prefix. If that share is under 15% and the new commit matches, flag; if over 85% and it does not, flag. Same test for capitalization, trailing period, and imperative-versus-past mood.

**Thresholds** (read by `scripts/humanize_review.py`): `history` = 200, `low_share` = 0.15, `high_share` = 0.85

**Fix:** Run git log --oneline -30 and match the house format exactly, including case and mood.

**False positive when:** Conventional Commits in a repo that uses Conventional Commits is correct and often hook-enforced. Only drift from the repo's own log is a tell — which is exactly why this check is near-zero false positive.

**Evidence:** astronomer-cosmos AGENTS.md forbids the prefixes; flclash enforces them via commit-msg hook. Both are right for their repo.

**Before**

> (in a repo whose log is all 'Fix crash when profile is missing') feat(profiles): add per-profile override script support

**After**

> Add per-profile override scripts

### `dead-internal-cross-reference`  ·  high · generic-llm · docs · structural · family: residue

'See the section on X' where there is no section on X; a link to an anchor that does not exist; a reference to a page that was never written.

**Why it reads AI:** The model refers to the document it would have written. Nothing in the loop resolves the reference against the document that exists.

**Detect:** Pure name and link resolution: every internal anchor, every 'see the X section', every relative link. Zero judgment required, and it belongs in CI.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Resolve every internal reference mechanically and fix or delete each miss. This is the highest yield-per-effort check in the whole exposition family because it needs no taste at all.

**False positive when:** Documents generated into a larger site where anchors resolve at build time rather than in source. Resolve against the built output in that case.

**Before**

> See the configuration section below for details. [there is no configuration section]

**After**

> [section written, or the sentence deleted]

### `docs-search-indexes-nothing`  ·  high · generic-llm · docs · structural · family: defect · lane: docs

The docs site has a search box in the navbar and no index behind it — either no search plugin is configured at all, or the Algolia block still contains placeholder credentials.

**Why it reads AI:** Same family as decorative-site-search, and specific to docs because the theme ships the search UI whether or not you supply an index — so the generator gets a search box for free and never discovers it is hollow. Search is the primary navigation mode for docs; a hollow one is worse than none.

**Detect:** A docs site whose theme renders a search UI where none of docusaurus-search-local, docusaurus-lunr-search, theme-search-algolia (with real appId/apiKey/indexName), pagefind or typesense is configured; OR an algolia config containing YOUR_APP_ID, YOUR_SEARCH_API_KEY, YOUR_INDEX_NAME or an xxx placeholder. Rendered: search a string from the current page's h1 and get zero results.

**Fix:** Wire a local index — docusaurus-search-local or Pagefind: no external service, works offline, indexes at build. Apply for DocSearch only if you want hosted. Then search for a string you know exists and confirm.

**False positive when:** Search wired through a platform feature invisible to a repo scan — Mintlify, GitBook and ReadMe index server-side. Sites under about fifteen pages where the sidebar is the whole IA and search was deliberately removed. Search delegated to a parent-domain site search.

**Before**

> algolia: { appId: 'YOUR_APP_ID', apiKey: 'YOUR_SEARCH_API_KEY', indexName: 'YOUR_INDEX_NAME' }

**After**

> themes: [['@easyops-cn/docusaurus-search-local', { hashed: true, indexBlog: false }]]

### `fabricated-doc-claims`  ·  high · generic-llm · docs · llm-judge · family: code

Documentation describing an architecture the code does not have, platforms nobody tested, or features that are restatements of function names.

**Why it reads AI:** The model documents the system it would have built. Nothing in the generation loop checks the doc against the repo.

**Detect:** Judge each claim against the code. Feature bullets that are function names with spaces inserted are the reliable structural signal.

**Fix:** Delete every claim you have not personally verified. A short true README beats a long aspirational one.

**False positive when:** Roadmap sections clearly marked as planned. The tell is aspiration presented in the present tense.

**Evidence:** Widely reported in maintainer AI-contribution policies.

**Before**

> ## Features
> - Robust caching layer
> - Seamless cross-platform support (Windows, macOS, Linux, BSD)

**After**

> ## Features
> - In-memory cache with a 60s TTL
> - Tested on macOS 15 and Ubuntu 24.04. Windows is untested.

### `hallucinated-import-or-api`  ·  high · codex · code · structural · family: residue

Calls to functions, flags, endpoints or packages that do not exist — including imports of packages never published, which is the attack surface behind slopsquatting.

**Why it reads AI:** The model generates the API it expects to exist. Plausible names are exactly what it is good at.

**Detect:** Resolve every import against the lockfile and every called symbol against the installed package. Fully mechanical.

**Fix:** Run the resolver. Then check the package actually exists on the registry and is the one you meant — a hallucinated import name is a supply-chain hazard, not just a bug.

**False positive when:** Optional dependencies behind a try/except ImportError, and symbols added in a newer version than the lockfile pins.

**Evidence:** aicodeaudit ACA4xx rule class; published slopsquatting research.

**Before**

> from requests.utils import parse_retry_after

**After**

> from urllib3.util.retry import Retry

### `hollow-assertion`  ·  high · codex · code · structural · family: code

Assertions that cannot fail: assert True, assert result == result, assert x is not None as the only check, tests with no assertion at all.

**Why it reads AI:** Test-shaped output. The file satisfies a coverage target and proves nothing.

**Detect:** Mechanical pattern match on the assertion expression.

**Fix:** Assert the value you expect. If you do not know what to expect, you do not yet know what the function is for.

**False positive when:** A smoke test whose only job is 'this import does not explode' is legitimate, if it says so.

**Evidence:** slop_scan P-class hollow-assertion rules.

**Before**

> result = parse(payload)
> assert result is not None

**After**

> assert parse(payload).currency == 'EUR'

### `how-it-works-that-says-what`  ·  high · generic-llm · docs · llm-judge · family: form

A 'How it works' section that describes what the system does rather than how or why, restating the feature list in longer sentences.

**Why it reads AI:** Template completion. The heading is a slot and the model fills it from what it has, which is the feature list. Mechanism requires knowing the implementation; capability can be inferred from the name.

**Detect:** Judge, or compute: the ratio of sentences stating a mechanism or a reason to sentences restating a capability. This is the single most-quoted complaint in the reader corpus.

**Fix:** Every sentence under that heading should answer how or why. If a sentence would survive unchanged under the heading 'Features', it belongs there instead or nowhere. Name the data path, the decision, the trade-off you took.

**False positive when:** Marketing pages where the section is deliberately non-technical, and products whose mechanism is genuinely proprietary — though in that case say so rather than filling the space.

**Before**

> ## How it works
> 
> Flowstate automatically syncs your data and keeps everything up to date in real time.

**After**

> ## How it works
> 
> We hold a logical replication slot on your primary and stream the WAL. That means we see a row change about 200ms after your database does, and it also means we cannot see anything that never hits the WAL, like a truncate.

### `idiom-drift-within-file`  ·  high · generic-llm · code · structural · family: code

A block of code whose idiom does not match the file around it: different naming convention, different error handling, different import style, different comment density.

**Why it reads AI:** The model writes its own idiom rather than the file's, because it optimizes the snippet rather than the codebase. A human who reads the surrounding code passes this automatically.

**Detect:** Compare the changed hunk's conventions against the rest of the file: naming case, quote style, type-annotation coverage, comment density, error-handling shape. Purely relative.

**Fix:** Read fifty lines above and below, then rewrite the hunk in that idiom.

**False positive when:** Deliberate modernization is real, and a file mid-migration is legitimately mixed. Check whether the drift is toward a documented target.

**Evidence:** One of the three highest-precision relative checks in the engineering survey; kubb's deslop skill frames the whole class as making the diff 'match the surrounding file and this repo's conventions'.

**Before**

> A snake_case file gaining a camelCase helper with full type hints and a docstring, where nothing else is annotated.

**After**

> The same helper, snake_case, unannotated, matching its neighbours.

### `mock-assertion-test`  ·  high · codex · code · structural · family: code

Tests that assert a mock was called rather than that behavior happened.

**Why it reads AI:** The model can see the implementation and mirrors it. The test then passes for any refactor that keeps the call and breaks the behavior — which is the exact inverse of what a test is for.

**Detect:** Count assertions that are assert_called / toHaveBeenCalled against assertions on returned values or observable state.

**Fix:** Assert the outcome. If the outcome is unobservable, the seam is in the wrong place.

**False positive when:** Verifying an interaction with a genuine external boundary (an email really was queued, a webhook really fired) is legitimate mock assertion.

**Evidence:** slop_scan and grain test-quality rules.

**Before**

> assert mock_send.assert_called_once_with(user.email)

**After**

> assert outbox[0].to == 'sam@example.com'

### `placeholder-stub-residue`  ·  high · codex · code-comments · structural · family: code

Generated scaffolding left in place: placeholder identifiers (foo, bar, MyComponent, doSomething, example_function), `# TODO: implement` / `throw new Error('Not implemented')` bodies, and dummy return values never filled in.

**Why it reads AI:** These are literal artifacts of the model emitting a template it expected a human to finish. Placeholder names and unfilled stubs in committed code signal nobody wrote the logic.

**Detect:** structural: scan code for the placeholder identifier set, bodies consisting only of TODO/FIXME/NotImplemented/pass, and 'TODO: implement'. Flag if any ship in non-scaffold files. (Operates on code identifiers, not free-text prose.)

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2

**Fix:** Name things after their real domain role; implement the body or delete the stub. If genuinely deferring, write a TODO with an owner, ticket link, and what's missing.

**False positive when:** Template repositories, scaffolding generators and example configs contain placeholders on purpose.

**Before**

> function MyComponent() {
>   // TODO: implement
>   return null;
> }

**After**

> function InvoiceRow({ invoice }) {
>   return <tr><td>{invoice.number}</td><td>{formatCents(invoice.totalCents)}</td></tr>;
> }

### `pr-scaffold-without-template`  ·  high · generic-llm · pr-description · structural · family: code

The Summary / Changes / Test Plan scaffold appearing in a repo with no pull-request template asking for it, often where the repo's other PRs are two sentences.

**Why it reads AI:** It is the default scaffold baked into agent PR-authoring prompts. It reads as ceremony imported from another repo, which is what it is.

**Detect:** Check for .github/pull_request_template.md. If absent, flag bodies carrying two or more of the canonical headings. Second signal: heading count against the median of the repo's last 20 merged PRs.

**Fix:** Read three recently merged PRs and match them. Most repos want what changed, why, and how you know it works — as prose.

**False positive when:** A repo WITH that template, obviously — and long descriptions on genuinely large changes. The check is against the repo's own norm.

**Evidence:** Aurelia's AI stance: 'Tell us what changed and how you know it works.' llama.cpp rejects fully-generated PR descriptions outright.

**Before**

> ## Summary / ## Changes (7 bullets) / ## Test plan / ## Related, in a repo whose merged PRs average 30 words.

**After**

> Sessions expired at 24h regardless of remember_me. Reads the flag now and sets 30d. Verified by logging in with the box ticked and checking the cookie's Max-Age.

### `review-restates-the-diff`  ·  high · generic-llm · code-review · llm-judge · family: code

A review comment that describes back what the diff does, or praises it, without taking a position on whether it is right.

**Why it reads AI:** The model has the diff and no stake. Restating is the only safe output. 'LGTM! Great work!' on a 600-line change is the pure form.

**Detect:** Judge: does this comment contain a claim the author could disagree with? If not, it is not review.

**Fix:** Delete it. A review comment should name a risk, a question, or a required change.

**False positive when:** A short genuine approval after a real read is fine, and some teams require an explicit LGTM to unblock the queue. The tell is approval plus summary plus nothing else.

**Evidence:** Maintainer commentary across HN threads on AI review bots; grain THANKS_OPENER rule.

**Before**

> LGTM! Great work on this refactor — the new structure is much cleaner.

**After**

> This drops the retry on 429. Was that deliberate? The upstream rate-limits us at 50rps.

### `swallow-exception-pass`  ·  high · codex · code-comments · structural · family: code

Error handling that catches broadly and discards: `try: ... except Exception: pass`, or catches only to print and continue with no rethrow, no context. Often paired with an over-apologetic comment.

**Why it reads AI:** Models produce defensively-shaped but functionally hollow error handling to make the snippet run. Swallowing every exception silently is flagged immediately by senior reviewers.

**Detect:** structural: AST/regex scan for bare or broad except whose body is only `pass`, a log/print, or `return None`; and JS `catch(e){ console.log(...) }` with no rethrow. Count per file.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Catch the specific exception you can handle; let the rest propagate. Log with context and rethrow, or convert to a domain error. Never `except Exception: pass`.

**False positive when:** A deliberately ignored exception with a comment saying why (a best-effort cleanup, an optional import probe) is correct. The tell is the bare, unexplained one.

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

### `unverified-test-plan`  ·  high · generic-llm · pr-description · llm-judge · family: code

A Test Plan of ticked checkboxes where nothing was run, or where the 'tests' restate the change rather than record an execution.

**Why it reads AI:** The model cannot run anything, so it writes the SHAPE of verification. A ticked box is an affirmative claim a maintainer will act on, which is why this is the tell that actually burns trust.

**Detect:** Structural pre-filter: ticked boxes under a Test heading with no CI run, no pasted command output, no attached artifact. Then judge: does each ticked line name a command, an environment, and an observed result?

**Fix:** Only tick what you ran. Paste the command and its output. If you could not run it, say so explicitly — that direction of honesty is itself strong evidence a person wrote it.

**False positive when:** A thorough test plan naming real commands, versions and what could NOT be verified is the opposite of a tell. Never flag a plan for being long.

**Evidence:** Maintainer complaints across llama.cpp, curl and RPCS3 threads; the honest counter-example is codex-authored PR phodal/routa#158.

**Before**

> - [x] All 25 existing tests pass
> - [x] Backward compatibility maintained

**After**

> Ran `pytest tests/auth -q`: 25 passed in 3.1s. Did NOT run the e2e suite — no Docker in this environment.

### `agent-attribution-trailer`  ·  medium · generic-llm · commit-message · structural · family: residue

Agent signature footers left in commits and PR bodies: 'Generated with <tool>', 'Co-Authored-By: <agent>', 'Assisted-by:', 'Codex Task'.

**Why it reads AI:** It is a literal signature. It also injects a non-person into git shortlog and the repository's contributor graph.

**Detect:** Literal-string grep. Zero false positives on detection — but this is a POLICY question, not a quality one, so detect and ask rather than strip.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Check the repo first: grep -ri 'co-authored-by|generated with|assisted-by' AGENTS.md CLAUDE.md CONTRIBUTING.md .github/. Strip if unmentioned or banned; keep if mandated. Removing an honest disclosure line can violate a project's policy — roughly forty projects in the public contribution-policy survey REQUIRE disclosure.

**False positive when:** Repos that mandate the trailer. This entry exists to make you look it up, not to make you delete it.

**Evidence:** matecat CLAUDE.md bans all AI references; libusb/hidapi AGENTS.md mandates an Assisted-by line; astronomer-cosmos wants visible credit. The correct behavior is repo-dependent.

**Before**

> Co-Authored-By: <agent> <noreply@example.com>

**After**

> (removed, or replaced with the repo's mandated form, e.g. Assisted-by: <tool>:<model>)

### `code-sample-not-runnable`  ·  medium · generic-llm · docs · structural · family: defect · lane: docs

Code blocks the reader cannot use: no language tag, elisions like "// ... rest of your code", unexplained <YOUR_API_KEY>, shell blocks with a leading $ on every line that the copy button then copies, and no complete example anywhere.

**Why it reads AI:** The model writes illustrative fragments because fragments are what documentation prose looks like in the corpus; it never pastes one into a terminal. The $-prefix case is a specific, nasty one — it LOOKS like a terminal transcript and silently breaks paste.

**Detect:** Across .md and .mdx: fenced blocks with an empty info string as a share of all blocks; blocks containing /\.\.\.|\/\/ ?(rest of|your code here|implementation|etc)/; shell blocks where most lines start with $; placeholders /<(YOUR|MY)_[A-Z_]+>|YOUR_API_KEY|xxxx+/ with no adjacent instruction on where to obtain the value; and no block in the page set that is a complete runnable file.

**Thresholds** (read by `scripts/humanize_review.py`): `min_blocks` = 4, `untagged_share` = 0.5, `dollar_share` = 0.8

**Fix:** Tag every fence with a language. Strip $ prompts from copyable shell blocks. Ship at least one complete, copy-paste-and-run example per page, and run it in CI so it cannot rot.

**False positive when:** Conceptual documentation where a fragment is the point. Output blocks — a terminal transcript deliberately showing prompt and response — which correctly include $ and are not meant to be copied. Blocks tagged text or console on purpose.

**Before**

> ```\n$ npm install foo\n$ foo init --key <YOUR_API_KEY>\n```

**After**

> ```bash\nnpm install foo\nfoo init --key "$FOO_API_KEY"\n```  — plus a line saying where FOO_API_KEY comes from

### `commit-subject-scale-adjective`  ·  medium · generic-llm · commit-message · structural · family: code

A commit subject reaching for scale words the diff does not earn: comprehensive, robust, enhanced, complete, production-ready, streamlined, optimal.

**Why it reads AI:** Models self-grade inside the artifact. 'Comprehensive' is a confidence assertion rather than a description, and it appears at a rate no human log matches.

**Detect:** Closed scale-adjective set matched against git log --format=%s, joined with diff size. One of these words on a diff under ~50 lines is near-certain. Subjects over 72 characters are a second signal.

**Thresholds** (read by `scripts/humanize_review.py`): `max_diff_lines` = 50

**Fix:** Cut every adjective. Verb, object, imperative, under 50 characters.

**False positive when:** A genuinely comprehensive change can say so. Check the diff size before believing the adjective — that join is the whole detector.

**Evidence:** grain VAGUE_COMMIT; NetExec AI policy on generated verbosity.

**Before**

> feat(retry): implement comprehensive and robust retry mechanism for enhanced reliability

**After**

> Retry failed uploads with backoff

### `docs-generator-defaults-unmodified`  ·  medium · generic-llm · docs · structural · family: residue · lane: docs

The docs site is a create-docusaurus, Mintlify or Nextra starter with the content swapped and nothing else: scaffold primary colour, scaffold logo and favicon, scaffold footer columns, scaffold sidebar labels, and the generator's own name still in the footer.

**Why it reads AI:** "Set up a docs site" resolves to running the scaffolder, and the scaffolder's output is already a complete, good-looking site — so the loop terminates. The tell is not ugliness; it is that the site is indistinguishable from the starter, which the Docusaurus team themselves called out: "the sample sites above use different colors, but still look quite the same".

**Detect:** Docusaurus: src/css/custom.css still carrying the scaffold green --ifm-color-primary: #2e8555 and its six generated shades; static/img/logo.svg or favicon.ico byte-identical to the template; docusaurus.config footer.links still Docs/Community/More with Stack Overflow, Discord and X entries; tagline still "Dinosaurs are cool"; docs/intro.md still present. Mintlify: starter colors.primary and the starter Quickstart/Development nav intact. Flag at min_markers co-occurring markers.

**Thresholds** (read by `scripts/humanize_review.py`): `min_markers` = 3

**Fix:** Change four things at minimum: the primary colour token set, the logo and favicon, the footer link groups, and the landing page. Delete every scaffold page — intro.md, tutorial-basics/, the blog with Welcome and MDX Blog Post.

**False positive when:** A day-one docs site where shipping content matters more than theming — real and defensible. Teams deliberately standardising on an unmodified theme to cut maintenance. Internal docs where branding is pointless. One marker alone is never enough.

**Before**

> --ifm-color-primary:#2e8555; + the Docusaurus dinosaur logo + footer Stack Overflow / Discord / X

**After**

> brand token set, real logo and favicon, footer linking to the repo, status page, changelog and support

### `docstring-restates-signature`  ·  medium · codex · code-comments · llm-judge · family: code

Docstrings that re-enumerate the signature with no added meaning: 'This function takes a and b and returns the result.' Args/Returns sections that just retype parameter names and types already visible in the declaration.

**Why it reads AI:** The model fills the docstring slot because the template demands one, paraphrasing the signature rather than documenting behavior. Humans omit a docstring before writing a contentless one.

**Detect:** llm-judge: 'Does the docstring only paraphrase the signature, omitting units, valid ranges, failure modes, side effects, or examples?'

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Document what the signature can't say: units, ranges, what raises, side effects, an example. If there's nothing beyond the signature, delete the docstring.

**False positive when:** Codebases with a documented-everything policy and doc-generation tooling require a docstring on every public symbol, and a thin one is better than none.

**Before**

> def divide(a: float, b: float) -> float:
>     """Divide a by b and return the result.
>     Args: a: the first number; b: the second number
>     Returns: the result"""

**After**

> def divide(a: float, b: float) -> float:
>     """Raises ZeroDivisionError when b == 0; callers must guard. Result is not rounded."""

### `every-page-opens-with-in-this-guide`  ·  medium · generic-llm · docs · structural · family: form · lane: docs

Page after page opens with the same throat-clearing: "In this guide, we will…", "By the end of this article, you'll…", "Let's dive in." The reader scrolls past a paragraph of table-of-contents-in-prose on every page.

**Why it reads AI:** A human writing twenty pages varies the opening, because writing the same sentence twenty times is unbearable. A generator writing twenty pages independently produces the highest-probability opening twenty times.

**Detect:** Share of docs pages whose first body sentence (after the H1 and frontmatter) matches /^(in this (guide|article|tutorial|section|post|chapter)|this (guide|article|tutorial|document) (will|covers|explains|walks)|by the end of this|let'?s (dive|get started|take a look)|we'?ll (walk|cover|explore|take a look))/i. Flag at page_share of pages, or min_consecutive consecutive pages. The uniformity is the signal; one instance is not.

**Thresholds** (read by `scripts/humanize_review.py`): `page_share` = 0.3, `min_consecutive` = 3

**Fix:** Delete the opening paragraph and start with the first real sentence. If the page needs orientation, state the outcome in one line and let the H1 and the sidebar TOC do the structural work.

**False positive when:** Long-form tutorials where one framing paragraph genuinely orients the reader — the tell is repetition across pages, never a single instance. House styles mandating a "What you'll learn" block, which should then be a structured component rather than prose. Translated docs where the construction is idiomatic in the source language.

**Before**

> In this guide, we will walk through the process of configuring authentication. By the end of this article, you'll have a working setup. Let's dive in.

**After**

> Configure SSO with Okta in about ten minutes. You need admin access to both accounts.

### `hardcoded-locale-formats`  ·  medium · generic-llm · code · structural · family: defect · lane: i18n

Dates, currency and numbers written for one locale and one currency in code: '$' + n.toFixed(2), MM/DD/YYYY, comma thousands separators, two decimal places assumed for every currency.

**Why it reads AI:** toFixed(2) is the single commonest price-rendering idiom in the training data. It is not wrong so much as monolingual: JPY has zero decimals, KWD has three, Germany writes 1.234,56 € with the symbol trailing.

**Detect:** Any of: a currency symbol adjacent to .toFixed(2); toLocaleDateString('en-US') or toLocaleString('en-US'); a literal 'MM/DD/YYYY' format string; the hand-rolled thousands regex /\B(?=(\d{3})+(?!\d))/g — combined with the ABSENCE of Intl.NumberFormat, Intl.DateTimeFormat and Intl.RelativeTimeFormat anywhere in the build. Also: <time> elements with no datetime attribute.

**Fix:** new Intl.NumberFormat(locale, {style:'currency', currency}).format(amount) and new Intl.DateTimeFormat(locale, {dateStyle:'medium'}).format(d). Take locale from the user's stored preference, not from navigator.language alone. Store money as integer minor units; never float.

**False positive when:** Single-locale, single-currency products where the format is a deliberate decision. Internal tools with one office. Fixed-format outputs required by a downstream system — an export written to a spec, an invoice line a tax authority defines. ISO-8601 dates are locale-neutral by design and are never this finding.

**Before**

> <span>${(price/100).toFixed(2)}</span>

**After**

> <span>{new Intl.NumberFormat(locale,{style:'currency',currency}).format(price/100)}</span>

### `sentence-assembled-from-fragments`  ·  medium · generic-llm · code · structural · family: defect · lane: i18n

A user-facing sentence built by concatenating translated pieces — t('you_have') + count + t('items_in_cart') — so translators receive word-order-locked fragments they cannot reorder, and no language with grammatical gender, case or non-binary plurals can be rendered correctly.

**Why it reads AI:** Fragment assembly reads perfectly in English, which is the only language the generator renders. It is invisible until a translator opens the string file and finds three words with no sentence around them.

**Detect:** A translation call in a concatenation (t('…') followed by +, or + followed by t(); two separate t() calls interpolated into one JSX sentence); key names ending _part1, _part2, _prefix, _suffix, _start, _end; plurals handled by a ternary on === 1 rather than an ICU plural rule or Intl.PluralRules.

**Fix:** One message per sentence, with named placeholders and ICU plurals. Give translators context comments.

**False positive when:** Concatenating a translated label with a non-linguistic token (an order ID, a filename, a code) is fine. Log messages and developer-facing strings are not translated. Design systems that compose a value with a separately-translated unit symbol.

**Before**

> t('you_have') + ' ' + n + ' ' + (n===1 ? t('item') : t('items'))

**After**

> t('cart.count', { count: n })  →  "{count, plural, one {# item} other {# items}}"

### `sidebar-nested-past-three-levels`  ·  medium · generic-llm · docs · structural · family: shape · lane: docs

A left sidebar with four or more levels of collapsible nesting, so finding a page requires guessing three parent categories correctly, and the whole tree is collapsed on arrival.

**Why it reads AI:** Deep nesting is what you get when a category is created for every noun rather than for a reader's task. Generators mirror the source-file tree, which is organised for authors.

**Detect:** Parse the sidebar config — Docusaurus sidebars.js category nesting, Mintlify navigation groups, Nextra _meta.json, MkDocs nav — and flag maximum depth at or beyond max_depth. Corroborating: most leaf pages sitting at depth three or deeper.

**Thresholds** (read by `scripts/humanize_review.py`): `max_depth` = 4

**Fix:** Three levels maximum: section → group → page. Flatten by merging categories with fewer than three children. Expand the current section by default. Make the top level answer "what am I trying to do", not "what module is this".

**False positive when:** Very large reference corpora — cloud provider APIs, standards documents — where depth reflects the domain and search carries the load. Auto-generated SDK references mirroring namespaces, navigated by search rather than browsing.

**Before**

> API → Reference → Resources → Users → Methods → createUser

**After**

> API reference → Users → createUser

### `stale-training-api`  ·  medium · codex · code · llm-judge · family: code

Code written against an API version that was current in the training data and has since changed — deprecated call signatures, removed flags, superseded client libraries.

**Why it reads AI:** The model's knowledge has a date. It writes the most-represented version, which is the most-documented one, which is rarely the newest.

**Detect:** Judge against the installed version's changelog. Deprecation warnings at runtime are the cheapest structural signal.

**Fix:** Check the installed version's docs, not the first search result. Pin the version in the file's header comment if the API is volatile.

**False positive when:** Deliberately pinned old versions, and compatibility shims that support both.

**Evidence:** aicodeaudit ACA3xx stale-training-data API rule class.

**Before**

> openai.ChatCompletion.create(...)

**After**

> client.chat.completions.create(...)

### `trailing-example-usage-block`  ·  medium · codex · code-comments · structural · family: code

A library module ends with a tacked-on demonstration: an `if __name__ == '__main__':` block or a `// Example usage:` comment with sample calls that print a canned result, added reflexively even when the module is imported elsewhere.

**Why it reads AI:** Codex appends a runnable demo because training examples (tutorials, gists) ended that way. In a real codebase the example belongs in tests or docs.

**Detect:** structural: flag a trailing `if __name__ == '__main__'` or example-usage block in a file that is clearly a library module (exports symbols, imported by others), especially when it just prints or calls functions with literal args.

**Fix:** Move example usage into the test suite or README. A library module should expose its API and stop. Keep `__main__` only for genuine CLI entry points.

**False positive when:** Not yet characterized. Treat as a cue to look, never as evidence of authorship.

**Before**

> # ... module code ...
> # Example usage:
> if __name__ == '__main__':
>     print(add(2, 3))  # 5

**After**

> # (module ends after its definitions; an example lives in tests/test_add.py)

### `try-catch-just-in-case`  ·  medium · codex · code · structural · family: code

Defensive exception handling wrapped around code that cannot meaningfully fail, or that should fail loudly.

**Why it reads AI:** The model cannot run the code, so it hedges. The result converts a crash you could debug into a silence you cannot.

**Detect:** Count broad handlers (except Exception, catch (e)) per file; three or more in one file is the documented working threshold. Join with whether the wrapped call touches a real boundary.

**Thresholds** (read by `scripts/humanize_review.py`): `per_file` = 3

**Fix:** Validate at boundaries, trust types internally. Handle the exception you can actually name.

**False positive when:** Network, IPC, subprocess, file I/O and user-input parsing all need handling. The rule is 'no try/catch just in case', not 'no try/catch'.

**Evidence:** slop_scan P1 threshold (>=3 except Exception per file); Paseo's contributor rules.

**Before**

> try:
>     total = a + b
> except Exception:
>     total = 0

**After**

> total = a + b

### `unwired-badge-row`  ·  medium · generic-llm · docs · structural · family: code

A README badge row advertising CI, coverage, npm version or a license that is not wired up, points at a different repo, or renders broken.

**Why it reads AI:** Badges are the most-represented README ornament in training data, so they generate whether or not the services exist.

**Detect:** Resolve each badge URL and each link target. Mechanical.

**Fix:** Delete any badge whose service you have not configured. A broken badge is worse than no badge.

**False positive when:** Badges for services that are configured but temporarily failing. Check the target, not the color.

**Before**

> ![build](https://img.shields.io/github/actions/workflow/status/other-org/other-repo/ci.yml)

**After**

> (removed until CI exists)

### `verbosity-disproportionate-to-diff`  ·  medium · generic-llm · pr-description · structural · family: code

A PR description whose length bears no relation to the size or subtlety of the change.

**Why it reads AI:** Generated prose has no cost function for length, so it defaults to thorough. Human effort tracks stakes.

**Detect:** Ratio of description words to changed lines, against the repo's own median. A ratio, never a length cap.

**Fix:** Cut to what a reviewer needs in order to start reading the diff.

**False positive when:** 900 words on a 4,000-line migration is proportionate. This is a ratio check and breaks immediately if used as a word limit.

**Evidence:** Identified in the engineering-lane survey as one of three highest-precision relative checks.

**Before**

> 900 words on a 4-line config change.

**After**

> Bumps the pool size from 5 to 20. We were queueing at 12 concurrent requests.

### `api-reference-restates-the-type`  ·  low · generic-llm · docs · llm-judge · family: shape · lane: docs

Generated reference where every description is the identifier re-spelled in English: "userId: string — The user ID." No units, no ranges, no defaults, no errors, no relationship to any other field.

**Why it reads AI:** Mixed, and worth stating plainly: this is the oldest failure in technical writing, now cheaper to mass-produce. TypeDoc, JSDoc and godoc have emitted this shape for twenty years; a model asked to document a set of types produces it at scale and at speed. Read it as UNREVIEWED-at-volume rather than distinctively machine-written.

**Detect:** Judge primarily. Static heuristic: for each documented parameter, split the identifier on camel and snake boundaries and compare with the description; flag when token overlap is at or above overlap after stopword removal, or the description matches /^(The|A|An) <identifier words>\.?$/i, or is five tokens or fewer. Flag a PAGE when most of its entries qualify.

**Thresholds** (read by `scripts/humanize_review.py`): `overlap` = 0.8, `page_share` = 0.6

**Fix:** For each parameter add at least one thing the signature does not contain: unit, range, default, what happens when it is omitted, what it interacts with, or an example value. If you cannot add anything, delete the description — an empty one is more honest than a tautological one.

**False positive when:** Genuinely self-describing fields in a large uniform schema, where boilerplate would add noise. Reference pages that exist to be searched and are paired with real prose guides elsewhere — reference is MEANT to be terse. Machine-readable specs consumed by tooling rather than read.

**Before**

> timeout: number — "The timeout."

**After**

> timeout: number — "Milliseconds to wait for a response before aborting. Default 30000. Values under 1000 are clamped. Aborting raises TimeoutError, which is retryable."

### `decorative-section-divider`  ·  low · codex · code-comments · structural · family: code

ASCII-art banner comments partitioning a source file into labelled sections.

**Why it reads AI:** The generated outline made visible. The model organizes a file the way it organizes a document, with signposting rather than structure.

**Detect:** Count comment lines made of runs of =, *, ~ or - , with or without a centered label.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 2

**Fix:** Check the surrounding files first. If they have no banners, delete these; if a file needs sectioning this badly, it needs splitting.

**False positive when:** Many long-standing C and Python codebases use banner comments as house style. This is only a tell as drift from the repo's own convention, which is why it is low severity.

**Evidence:** Rule OBVIOUS_HEADER in the grain anti-slop linter; corroborated by maintainer style guides.

**Before**

> # ============ HELPER FUNCTIONS ============

**After**

> (no banner; the helpers live in their own module)

### `emoji-in-code`  ·  low · codex · code-comments · structural · family: code

Emoji in source files — log strings, comments, commit-adjacent scaffolding.

**Why it reads AI:** Generated code decorates its own output. A human adds an emoji to a log line when the team already does; a generator adds one because the training data did.

**Detect:** Emoji codepoints on non-docstring source lines.

**Thresholds** (read by `scripts/humanize_review.py`): `min_count` = 1

**Fix:** Check the repo's own convention first. If there isn't one, remove them — they break alignment in terminals and grep output.

**False positive when:** Repos that mandate emoji in conventional-commit types or log levels are following their own documented spec. Flag only on introduction into a file or repo without the convention.

**Evidence:** Rule set of the grain anti-slop linter; several repos' commit specs mandate the opposite.

**Before**

> print("✅ Migration complete!")

**After**

> print("migration complete: 412 rows, 2.1s")

### `no-version-selector`  ·  low · generic-llm · docs · structural · family: shape · lane: docs

Documentation for software that has shipped breaking changes, with only the current version published and no way to read the docs for the version the reader is actually running.

**Why it reads AI:** UNREVIEWED, and genuinely contested. Versioning is an ongoing maintenance commitment and experienced maintainers argue both sides — which is why this is low. The narrow, uncontested case is: breaking changes shipped, old majors still supported, no way to read their docs.

**Detect:** The project's published latest version is 2.0.0 or higher (or the repo has two or more major tags), and the docs build has no versioning: no versions.json or versioned_docs/, no mike config, no version dropdown in the navbar config, no /v1/ route.

**Fix:** Cut a version snapshot at each major. If you will not, say so prominently, keep a changelog with migration notes, and make sure every page states which version it describes.

**False positive when:** Projects with strong backward compatibility where one tree is honestly correct — Redis's maintainer makes exactly this argument. Hosted SaaS with no user-visible versions. Pre-1.0 projects. Products where a changelog plus per-page "since v2.3" annotations do the job.

**Before**

> one docs tree; the reader is on v1 and every example is v3

**After**

> a version dropdown — v3 (current) / v2 / v1 — or a banner naming the version these docs describe

### `single-impl-abstraction`  ·  low · codex · code · structural · family: code

An interface, abstract base class or strategy pattern with exactly one implementation and no named second one coming.

**Why it reads AI:** Generated code performs architecture. The abstraction is a pattern the model has seen rather than a seam the problem has.

**Detect:** Count concrete subclasses or implementors per declared interface.

**Fix:** Inline it. Add the interface when the second implementation exists.

**False positive when:** A plugin interface with one bundled implementation plus a real external one is justified, and test doubles count as a second implementor. This is a warning in every linter that ships it, for exactly that reason.

**Evidence:** grain SINGLE_IMPL_ABC (severity: warn).

**Before**

> class StorageBackend(ABC): ...  # one subclass: LocalStorage

**After**

> class LocalStorage: ...

<!-- humanize:ignore-end -->
