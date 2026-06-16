# Attention Is The First Command

![Flat blueprint-style illustration of a post office. A clerk slides a letter into a wall of hundreds of pigeonholes labeled with agent names, while three closed frosted-glass doors marked "Claude Code," "Gemini CLI," and "Codex CLI" have unopened mail piling up in front of them. A banner reads: "Nobody was checking the mail."](/img/generated/attention-first-command/hero.png)

For a couple of months, Port Daddy has had a perfectly good mailbox.

Any agent can drop a note in any other agent's inbox. Any agent can publish to a channel and any subscriber can read. There are tuples for structured state, pheromones for ambient signal, locks for scarce things, and a coordination-inconsistency channel where the fleet airs its complaints when reality and the ledger disagree. The plumbing is real, the tests are green, the audit trail is durable.

Nobody was checking the mail.

The mailbox sat there full because each agent turn is a fresh process. Claude Code spawns, reads its prompt, does the thing, exits. Codex CLI is the same. Gemini, the same. Nothing inside the turn polls the daemon's inbox; nothing fetches from the channels the agent supposedly subscribes to. So senders wrote to a wall, and receivers — the agents we'd actually expected to receive — never even saw the wall.

<!-- sidenote: 1 -->
> A long-running daemon process could have done this trivially — sit there, poll, ring a bell. The problem is the *receiving* end of the protocol is not a daemon. It's a one-shot agent turn. The substrate's coordination model was designed for processes that hang around; the agents themselves are processes that don't.

This is the absurd shape of the problem: the post office is staffed, the carriers are correctly addressing letters, the recipients are *literally on the other side of the door*, and the door has no peephole. We needed a peephole. That is `pd attention`.

---

## What the verb does

One call. Returns everything new addressed at this agent across every coordination surface it cares about. Marks it seen on the way out.

```bash
$ pd attention
2 item(s) (now marked read)

  •   0s  channel coordination:inconsistency ← lookout
         {"kind":"stale_claim","claim":"lib/db.ts","held_by":"abandoned-2h-ago","minutes_stale":127}
  •   1s  inbox ← cartographer
         [coordination] Heads up: editing routes/symbols.ts:42-89 — coordinate before touching.

Counts: inbox=1  channels=1
Subscribed: coordination:inconsistency
```

It is, on purpose, the least clever verb I have written in a year. Inbox unread + per-channel cursor advance, sorted newest-first. `--peek` if you want to dry-run. `--subscribe <channel>` and `--unsubscribe <channel>` if you want to change which broadcast you're listening to. `--json` if you're a machine.

<!-- sidenote: 2 -->
> "Sorted newest-first" is a small choice that matters more than it sounds. The SessionStart hook pins this into the model's context. The model reads top-down, so the freshest signal lands earliest in the window — exactly where attention budget is highest. The reverse order would have been arbitrary.

The cleverness is not in the verb. The cleverness is in *who calls it and when*.

---

## The convention is the product

![A flat blueprint cutaway of a door with architectural dimension lines and a brass peephole at eye level. A freshly-installed plaque reads "SessionStart," and an envelope slides through a slot beneath it. An inset peephole view shows the post office mailroom — the clerk and the wall of pigeonholes — on the other side.](/img/generated/attention-first-command/peephole.png)

The verb is necessary. The verb is not sufficient. A verb you forget to run is a verb the senders are still writing to a wall.

So the second half of this slice is a convention, codified one place at a time:

- **`AGENTS.md` § Port Daddy First** now declares `pd attention` the *first* command of every session. Before `pd status`. Before `pd briefing`. Before the agent looks at git. Whatever else changed since you last had this terminal, somebody might have addressed you about it. Find out first.

- **`.claude/settings.json`** has a `SessionStart` hook that runs `pd attention --json` automatically. When Claude Code opens this repo, the output is pinned into the prompt context before the model gets the user's first message. No model decision required. No "the model has to remember to check the mailbox." The mailbox check is upstream of the conversation.

- **The JSON schema is documented and stable.** Any harness that can run a shell command at session start can adopt this. Cursor users: add `pd attention --json` to your equivalent hook. Aider users: same. There are no Anthropic-specific bits in the verb — it talks to a local daemon, returns plain JSON, and gets out of the way.

<!-- sidenote: 3 -->
> Hooks are the kind of feature that everyone agrees is useful and nobody markets. Claude Code has them; Cursor has workspace lifecycle events; even VS Code has `onDidStartTerminal`. Every harness has a place where "do this thing once before the user starts talking" can live. The mistake is to treat hooks as harness-specific and the convention as ours. The hook is the harness's; the convention is the *agent ecosystem's*.

This is the part I want adoption on. The verb is mine to maintain; the convention is everyone's to inherit. If two agent-coding tools agree that the first command of every session reads the local mailbox, the long-running pathology of broadcast-without-reception is just gone.

---

## Why this is not an MCP tool

![A flat blueprint split-pane diagram. Left, labeled "Tool the model must choose": a figure at a desk hesitates, reaching toward a "pd_attention" tile among "pd_status," "pd_claim," and "pd_session_start," a question mark over their head. Right, labeled "Delivered before the turn": the tiles are gone and a hand passes a "SessionStart" note through a window so it lands on the desk before the figure sits. The argument: on the left the model decides whether to check the mailbox; on the right the check is delivered upstream of the decision.](/img/generated/attention-first-command/mcp-vs-hook.png)

It would be the most natural thing in the world to expose `pd attention` as an MCP tool. The model would gain a `pd_attention()` function it could call mid-turn whenever it suspected somebody had sent it mail. Beautiful. Symmetric. Wrong.

The whole point of the verb is to remove the polling decision from the model. If the agent has to *decide* to check the inbox, the agent will forget — agents forget the same way humans forget, but more reliably, because every new turn starts amnesiac. The SessionStart hook fires the verb before the model's first token. The model never has the opportunity to skip.

<!-- sidenote: 4 -->
> This is the same logic as why your fire alarm is not "ask the smoke detector to consider whether it might be on fire." The model is competent at deciding things; the model is *also* capable of forgetting to decide. For safety-relevant signal — and coordination, in a multi-agent system, is squarely safety-relevant — you remove the decision and replace it with a schedule the harness controls.

Exposing this as an MCP tool would put the decision *back* on the model. That's the exact failure mode this whole slice is supposed to fix. So `attention` lives in `MCP_EXEMPT_FEATURES` with a comment about why, and the next reviewer who wants to re-litigate it has to argue with the comment.

This is, in general, how I think about the divide between MCP tools and shell verbs. **MCP tools should be things the model is choosing to do.** Shell verbs in hooks should be things the model shouldn't be choosing to do — that should happen on a schedule the harness controls. Attention is squarely in the second bucket.

---

## What the schema actually looks like

```ts
{
  success: true,
  agentId: string,
  items: [{
    source: 'inbox' | 'channel',
    id: string,            // 'inbox:<n>' | 'channel:<channel>:<n>'
    from: string | null,
    channel: string | null,
    type: string | null,
    content: unknown,
    contentType: string,
    receivedAt: number,    // ms epoch
  }],
  counts: {
    total: number,
    inbox: number,
    channels: number,
    inboxUnreadRemaining: number,  // pagination signal
  },
  subscriptions: string[],
  peek: boolean,
  generatedAt: number,
}
```

If you want to wire this into something — a VS Code extension that surfaces unread coordination signals, a dotfile script that runs at every shell prompt, a fancy Tauri menu-bar app that pings when the cartographer flags drift — the JSON is what you build against. If the verb's invocation surface is the convention, the schema is the API.

Two correctness bits I'll call out because the adversarial reviewer caught them:

1. **The inbox marks individual messages read, not all-at-once.** If you fetch with `--limit 5` and have 12 unread, the other 7 stay unread. The first cut used `markAllRead` for "simplicity" and silently consumed mail. The fix is one of those rare moments where the obvious cheap path is also the wrong path.

<!-- sidenote: 5 -->
> Caught by a unit test that I almost didn't write. The test asserts `counts.inboxUnreadRemaining` ≥ the count of messages beyond the limit. Without it, the bug would have been invisible — the verb would have returned the right number of items, the mark-read endpoint would have returned `{success:true}`, and a quiet 7 messages would have evaporated. Unit tests against the *contract* of a verb catch more than unit tests against its return value.

2. **The channel cursor advances inside a SQLite transaction per channel.** Two concurrent `pd attention` calls for the same agent — say, two harness instances opening at the same time — would otherwise both see cursor=N, both fetch the same messages, and both think they marked them seen. Now they don't.

3. **New subscriptions snapshot at the channel's current max id**, not zero. A new subscriber on a long-running channel sees future messages, not the archaeology. Old broadcasts are still queryable through `pd say` and friends; the attention surface is a *now-and-forward* lens.

---

## How to adopt it in something other than Claude Code

The hook story is simple enough to write out. Pseudo-code by harness:

- **Claude Code**: already shipped — `.claude/settings.json` has the SessionStart hook. Update `port-daddy` from the tap and restart your session.
- **Gemini CLI / Codex CLI**: whatever your harness calls a session-start hook, run `pd attention --json` and pin the JSON into your prompt context. The output is small (~1KB for a busy session), reliably under whatever your context budget is.
- **Cursor / Windsurf / your editor of choice**: if it can run a shell command at workspace-open, you can adopt this today. The JSON schema is stable.
- **No hook surface at all**: doctrine. Run `pd attention` manually. The convention works without automation; the automation just makes the convention free.

If you're an agent-coding-tool author reading this and your tool doesn't have a session-start hook, file an issue against yourself. The pattern is general — read the local coordination state at session boundaries — and the cost is one shell call.

---

## What's still missing

`pd attention` does not auto-fire at the end of `pd begin`, which means the SessionStart hook runs before any agent identity exists, errors, and the hook swallows the error to keep things quiet. That's filed and in the queue — `pd begin` should kick off an attention fetch on its success path so "begin and check" is one logical command.

The `--json` output does not yet have a `schemaVersion` field. If the schema ever changes shape, third-party integrators will break silently. Cheap to add, in the queue.

And of course, the harness ecosystem only has one hook wired today. If you adopt this in a non-Claude-Code harness and the experience is rough, the experience-of-rough is the work product — open an issue. The convention is only as durable as the second tool that follows it.

---

## The hallway, revisited

If you read this post backwards from the practical install instructions, it sounds like a small thing. One verb, one hook, one short JSON schema, three correctness fixes from a code review. Many days of bigger-feature work landed alongside it.

But the thing I want to remember is the post office scene. We had built a coordination substrate sophisticated enough to track structured tuples, run distributed locks, replay correlation engines, and serve fleet-health metrics — and the agents the substrate was *for* could not see their own mail. The fix wasn't more substrate. The fix was a hallway with a peephole, declared as doctrine, and an automatic call to look through it.

Run `pd attention` when you start. Or don't, and find out which message you wish you had read.

— Erich
