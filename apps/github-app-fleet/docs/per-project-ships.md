# Per-project ships

The GitHub App ships no fleet roster of its own. Every installed
repository declares its own ships in `pd-fleet.yml` at the repository
root. The App reads that file at webhook dispatch time and renders each
ship's identity into the comment body.

This document is the reference for that contract: the ship block shape,
the validation rules, and three worked examples from different
properties.

---

## Ship block shape

```yaml
fleet:
  name: <project-slug>             # e.g. port-daddy, expungement-guide, jury_rig
  agents:
    <ship-key>:
      handle: <handle>             # lower-kebab-case; rendered as `pd-<handle>`
      role:   <one-line role>      # rendered into the header
      mark:   <unicode primitive>  # optional; geometric only, no emoji
      trigger: <event>             # e.g. pull_request.opened, push, issue_comment.created
      backend: <runtime>           # local | cloudflare | claude | gemini | ...
      model:   <model-id>          # optional, backend-specific
      enabled: true                # default true; set false to mute one ship
      prompt:  |
        <multi-line prompt>
```

The App reads only `handle`, `role`, `mark`, and `enabled` from each
ship block — those are the fields that affect what GitHub sees. The
remaining fields (`trigger`, `backend`, `model`, `prompt`, and any
runtime-specific fields) are consumed by `lib/fleet-engine.ts` and
related local-runtime modules; they do not change the App's behavior.

The `handle` value is the single source of truth for the rendered
identity. A `handle: upl-checker` becomes a `**[pd-upl-checker]**`
header tag, a `pd-ship:upl-checker` issue label, and a draft-PR title
prefix of `[pd-upl-checker]`. Renaming a ship after it has posted will
visually fragment a thread; treat handle changes the same as renaming a
GitHub user.

### Validation rules

- `handle` must match `[a-z][a-z0-9-]*[a-z0-9]`.
- `role` is rendered in italic next to the handle; one line, under ~80
  characters reads well in GitHub's PR view.
- `mark` is optional. When present it must be a single unicode primitive
  — `◆ ▲ ● ✚ ◇ ◐ ✦ ◯ ✕` and similar. Emoji are explicitly out.
- The same `handle` must not appear twice in one `pd-fleet.yml`.

The App falls back to a permissive parse: a malformed ship block is
skipped with a warning, not a webhook failure. The runtime that owns the
local fleet daemon enforces stricter rules.

---

## Example 1 — port-daddy

The seven ships that ship with port-daddy's own fleet. All of them are
diff/code-shaped; the body of every comment is a reviewer-style note.

```yaml
fleet:
  name: port-daddy
  agents:
    reviewer:
      handle: reviewer
      role: reads diffs like a careful colleague
      mark: ◆
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct
      prompt: |
        Read the diff. Surface the smallest specific risk you can
        defend on the page. Do not list everything that could go
        wrong; list the one thing that the author is most likely to
        regret. Cite file:line.

    redteam:
      handle: redteam
      role: assumes the worst; looks for sharp edges
      mark: ▲
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct

    qa:
      handle: qa
      role: runs tests in its head; flags missing coverage
      mark: ●
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct

    test-author:
      handle: test-author
      role: writes the test that was missing
      mark: ✚
      trigger: issue_comment.created    # reacts to 🚢 emoji on qa's posts
      backend: local
      model: qwen2.5-coder

    tautology:
      handle: tautology
      role: flags vacuous assertions and circular logic
      mark: ◇
      trigger: pull_request.synchronize
      backend: local
      model: llama-3.1-8b-instruct

    unspider:
      handle: unspider
      role: finds dead code paths the spider can no longer reach
      mark: ◐
      trigger: push    # branch-level; runs against main only
      backend: local
      model: llama-3.1-8b-instruct

    documentarian:
      handle: documentarian
      role: watches the drift between code and docs
      mark: ✦
      trigger: pull_request.opened
      backend: local
      model: qwen2.5-coder
```

These are port-daddy's own roster — they live here because the roster is
per-repository, not per-App.

---

## Example 2 — expungement-guide

Expungement-guide is a legal-content site. Code is incidental; the high
risks are legal. The ships are content-shaped.

The single highest-stakes ship is the **UPL checker**. Unauthorized
Practice of Law is the line between "information about how the law
works" (publishable by a non-attorney) and "advice on what a specific
person should do" (which only a licensed attorney can lawfully give in
that jurisdiction). The ship flags drafts that cross the line.

```yaml
fleet:
  name: expungement-guide
  agents:
    upl-checker:
      handle: upl-checker
      role: catches Unauthorized Practice of Law in drafts
      mark: ⚖
      trigger: pull_request.opened
      backend: claude
      model: claude-3-5-sonnet-latest
      prompt: |
        Read the diff. Flag any text that crosses from information
        into advice. Specifically:

        - Imperative second-person directed at a specific situation
          ("you should file a 5K motion next week") is advice.
        - Conditional third-person describing how the law operates
          ("a 5K motion is typically filed within X days of release")
          is information.
        - "We recommend …" and "your best option is …" are advice
          regardless of phrasing.
        - "An attorney in your jurisdiction can …" with a referral
          path is information; a specific attorney recommendation is
          advice.

        For each crossing, quote the line and propose a rewrite that
        keeps the content lawful in the strictest US state.

        If a draft is clean, post one line: "UPL clean." Do not
        elaborate when there is nothing to flag.

    citation-checker:
      handle: citation-checker
      role: validates state-specific legal citations
      mark: §
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct
      prompt: |
        For every state-specific statute reference in the diff,
        verify that the citation format matches that state's
        Bluebook style. Flag citations that reference a section
        that does not exist as of the rules database snapshot
        date. Do not propose new citations — only verify what is
        written.

    plain-language:
      handle: plain-language
      role: flags legalese; targets reading level grade 8
      mark: ✎
      trigger: pull_request.opened
      backend: local
      model: qwen2.5-coder
      prompt: |
        Compute Flesch-Kincaid grade for each new paragraph.
        Flag paragraphs above grade 10. For each flagged
        paragraph, identify the specific legalese phrase or
        nested clause that drives the score and propose a
        plain-language rewrite. Quote both versions.

    accessibility:
      handle: accessibility
      role: alt text, heading hierarchy, color contrast
      mark: ⊕
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct
```

The UPL checker is the load-bearing ship for this property. The site's
public posture is "non-attorney information"; a single comment from
`pd-upl-checker` flagging a draft as crossing the line is more valuable
to the site owner than any number of code-review ships.

---

## Example 3 — jury_rig

Jury-rig is a skill-distribution site. The dossier for each skill needs
hero illustrations, inline diagrams, and clean SKILL.md frontmatter. The
ships generate media as much as they review prose.

```yaml
fleet:
  name: jury_rig
  agents:
    skill-media:
      handle: skill-media
      role: generates hero illustrations for skill dossiers
      mark: ❖
      trigger: pull_request.opened
      backend: gemini
      model: gemini-3-pro-image-preview
      prompt: |
        For every new or modified `skills/*/SKILL.md`, generate a
        16:9 hero illustration matching the property's brand
        (flat editorial illustration, cobalt + sage + cream
        palette). Save to
        `public/img/skills/<skill-id>/hero.png`. Post a draft PR
        with the new file. Do not modify the SKILL.md itself.

    mermaid-author:
      handle: mermaid-author
      role: drafts mermaid diagrams referenced in dossier copy
      mark: ⌬
      trigger: pull_request.opened
      backend: local
      model: qwen2.5-coder
      prompt: |
        For every "(diagram: ...)" placeholder in modified
        SKILL.md files, draft a mermaid diagram that the
        surrounding prose describes. Post the rendered SVG as a
        review-thread comment so the author can iterate.

    skill-grammar:
      handle: skill-grammar
      role: lints SKILL.md frontmatter and required sections
      mark: §
      trigger: pull_request.opened
      backend: local
      model: llama-3.1-8b-instruct
      prompt: |
        Verify every modified SKILL.md against the property's
        schema:
          - frontmatter: name, version, summary, archetype
          - required sections: ## Use when, ## Inputs, ## Outputs,
            ## Examples, ## References
        Flag missing or empty sections by name. Do not propose
        content — only flag the structural defect.
```

The `skill-media` ship is the one that does not look like a code
reviewer. It is a media-generation ship that opens draft PRs against the
installed repository to land its output. From the App's perspective it
is the same shape as any other ship — a `pd-<handle>` identity, a
header tag, a body of evidence — but its operation is `draft-pr`
instead of `pr-comment`.

This is the case the closed-enum design failed: a fleet that produces
art alongside prose. The App does not need to know that
`gemini-3-pro-image-preview` is the backend; it only needs to know that
`pd-skill-media` is the identity to render.

---

## Adding a new ship

1. Pick a handle. `[a-z][a-z0-9-]*[a-z0-9]`. Two-to-four syllables read
   well in PR headers.
2. Write a one-line role. The role should make the ship's job legible
   to a contributor who has never read this document — "watches the
   drift between code and docs" is better than "documentarian agent."
3. Pick a mark, or skip it. The marks are visual hashing; they help
   long threads stay legible but they are not load-bearing.
4. Decide the trigger. Webhook events the App receives are listed in
   `manifest.json > default_events`. Sub-events (e.g.
   `pull_request.opened` vs `pull_request.synchronize`) are filtered in
   the receiver, not the manifest.
5. Land the ship block via PR to the installed repository. The next
   matching event posts as `pd-<handle>`.

The App does not require restart or reinstall to learn a new ship. The
file is re-read on every webhook.

---

## Reading the configuration from the runtime

The App receiver fetches the installed repo's `pd-fleet.yml` via the
`contents:read` permission, parses the `fleet.agents` map, and resolves
each `handle` to a `ShipMeta` value before calling `postAs`. A
reference implementation lives in the App receiver source; the relevant
contract from this scaffolding's perspective is:

```ts
import { postAs, type ShipMeta } from './lib/post-as'

const ship: ShipMeta = {
  handle: 'upl-checker',
  role: 'catches Unauthorized Practice of Law in drafts',
  mark: '⚖',
}

await postAs(ship, {
  kind: 'pr-comment',
  payload: {
    owner: 'curiositech',
    repo: 'expungement-guide',
    pull_number: 142,
    body: 'Line 87 reads "you should file a 5K motion next week" — that crosses the UPL line. Suggested rewrite: "A 5K motion is typically filed within X days of release."',
  },
})
```

`postAs` does not validate that the handle exists in any registry — it
only validates the handle's syntax. The runtime that maps webhook
events to ships is responsible for resolving the meta from
`pd-fleet.yml`.
