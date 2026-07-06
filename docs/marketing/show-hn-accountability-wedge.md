# Show HN — the accountability wedge

Launch asset for wedge 1 of the go-to-market plan
(`docs/strategy/2026-07-06-distribution-dogfood-and-go-to-market.md` §6, on the
`strategy/distribution-and-dogfood` branch, not yet shipped to main). <!-- cite-exempt -->
Channel playbook per `tech-launch-channels` (Tue–Thu, 6:00–8:00 AM ET, factual
title, first comment posted immediately, answer every reply for two hours).
Voice per `port-daddy-marketing-copy`; machine-accent pass per
`make_copy_and_media_human`.

Every claim below is checked against `README.md`, `lib/agent-harbor/`, and
ADR-0095 as of this commit. If the product changes, change this file — do not
let the post drift from the code.

---

## Title

```
Show HN: Port Daddy – see what your AI coding agents actually did
```

66 characters. Factual, no superlatives. The URL is https://portdaddy.dev/accountability.

Fallback title if a mod asks for more specificity:

```
Show HN: A local daemon that witnesses AI agent transcripts, cost, and git safety
```

## Submission text

> I run several AI coding agents at once (Claude Code, Codex, Aider). The
> tooling for launching them is good now. The tooling for knowing what they
> did is a blank terminal.
>
> Port Daddy is a local daemon plus a native macOS console that fixes the
> second half. When an agent runs under it you get:
>
> - The full transcript, hash-chained and verified by the daemon. An agent
>   can't edit its own history, because the daemon holds the chain, not the
>   agent.
> - Exact cost per run. Launches are fail-closed on telemetry: if the daemon
>   can't attach exact token counts and a persisted cost record to a run, the
>   run doesn't launch as "managed."
> - A compliance level (C0 Registered through C6 Resumable) that the daemon
>   proves with witnessed probes, including negative probes. An adapter that
>   forges a level fails the run loudly instead of shipping a badge.
> - A pre-tool git gate. `git reset --hard`, `push --force`, `clean -fd` and
>   friends are classified before they execute. Block-tier actions are denied
>   before the side effect, with a durable denial receipt and a concrete safe
>   alternative in the transcript. The deny path is proven by test fixtures
>   that snapshot a real scratch repo and check it's byte-identical after the
>   blocked call.
>
> The daemon is TypeScript/Bun, installed with Homebrew. The console is a
> GPU-native Rust app (gpui). The menu-bar app is SwiftUI. Everything is
> local-first: your transcripts and cost records are SQLite on your machine.
>
> Honest limits: macOS is the primary target (Linux works for the daemon and
> sandbox, no native console yet). The exact-cost gate currently passes only
> for the Claude SDK backend; other backends run as observed rather than
> managed until they reach telemetry parity. And the sandbox defends the
> cooperative case (runaway spend, leaked keys, accidental `rm`), not a
> deliberately malicious same-UID process — that caveat is printed in the
> receipt rather than buried in a doc.
>
> Install: `brew install curiositech/tap/port-daddy && pd setup`
> Site: https://portdaddy.dev/accountability

## First comment — how it started

Post this from the founder account within a minute of submitting.

> Hey HN, I'm Erich. Some background on why this exists.
>
> Last year I started running multiple coding agents in parallel on the same
> repo, and one of them ran `git reset --hard` while another had uncommitted
> work in the tree. I lost an afternoon's work and most of a weekend
> untangling what each agent thought it had done. There was no record. Eight
> terminal scrollbacks, no costs, no timeline, nothing I could replay.
>
> The first version was embarrassingly small: a port manager, so two dev
> servers would stop fighting over 3000. Then sessions with append-only
> notes, so a crashed agent left evidence instead of a mystery. Then file
> claims, budgets, sandboxed spawning, and eventually the piece I actually
> wanted from the start: a run record I could trust more than the agent's
> own summary of itself.
>
> That last part is the interesting engineering. Self-reported compliance is
> worthless — an agent will happily tell you it behaved. So the daemon
> witnesses everything: transcripts are hash-chained as they stream, the
> compliance probe runs one check per ladder level plus five required
> negative probes (forged level, forged heartbeat, direct-MCP bypass,
> disabling the hook after launch, observed-posing-as-controlled), and a
> fired attack that isn't caught fails the whole run. The git gate sits at
> the pre-tool hook, so a destructive command is classified and denied
> before it executes, not logged after.
>
> The discipline that kept it honest: Port Daddy is built by Port Daddy.
> Every agent working on this repo runs under the daemon it's building — the
> git hooks it ships gate its own commits, the sessions it records are the
> ones I salvage when a build agent dies, and a feature that doesn't survive
> being my daily driver doesn't ship. The repo is at 7,300+ tests and every
> PR gets an adversarial review verdict before merge.
>
> Things I'd genuinely like feedback on: whether daemon-witnessed probes are
> convincing to you as an audit primitive, and what you'd want in a work
> receipt before you'd trust an agent's output enough to review it faster.

## Engagement notes (do not post)

- Expected pushback and true answers:
  - "Same-UID sandboxing isn't security." Correct, and the receipt says so.
    The Coast Guard defends the cooperative case; the separate-UID broker
    (ADR-0087) is the answer for the adversarial case and isn't shipped.
  - "Why not just tee the terminal output?" A tee is unverified and
    unstructured. The chain matters when an agent summarizes its own work;
    tool calls, files touched, and denials are typed events, not grep fodder.
  - "Is this open source?" State the actual license (FSL-1.1-MIT) plainly and
    what it permits. Don't oversell it as OSS.
  - "Linux?" Daemon and CLI yes, Landlock/bubblewrap sandbox yes, native
    console not yet.
- Do not claim marketplace, mobile, remote harbors, or co-op editing. Those
  are later wedges (strategy §6) and not live.
- One launch. If it doesn't land, the re-post needs something substantially
  new and a 3–6 month gap.
