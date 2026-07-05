# Verb State Machine: Six Terminal States, Six Distinct Claims

Use this when you need to decide what terminal states a control verb needs, or whether two verbs are actually the same claim wearing different names.

## The core split: verbs are claims, not buttons

`redteam-agent-harbor-control-plane.md` #13 names the failure directly: "Interrupt, pause, kill, and steer are separate claims." A control panel that groups them near each other in the UI is fine. A control panel (or its daemon) that tracks them as one underlying state machine is not — because each verb means something different, and a body can support one while failing another.

| Verb | What "acknowledged" means | A backend that can support this but not another |
| --- | --- | --- |
| `interrupt` | A control command was delivered and the body acknowledged or failed it. | A hook-only Claude Code session can interrupt (stop the current tool call) but cannot `pause` (no mid-run halt primitive). |
| `pause` | No tools are executing after acknowledgement — a stronger claim than "interrupted," which only stops the current turn. | A local same-UID process can pause; a remote Cloudflare body with no persistent halt signal may only support `kill`. |
| `kill` | The body is terminated, but the soul/transcript remains linked and append-only. | Almost every backend can kill (it's the least demanding claim) — which is exactly why it must not stand in for the others. |
| `steer` | The next model turn receives the operator's message. | An observed-only import has no live process to steer at all. |
| `checkpoint` | A resumable snapshot of state was captured (not the same as pause). | A remote body without local disk access may not be able to checkpoint even though it can kill. |
| `fork` | A new run was seeded from a checkpoint and linked to its predecessor. | Only backends with `checkpoint` support can meaningfully support `fork`. |

The wrong mental model: "these are all flavors of stop." The right mental model: six independent claims that happen to share a six-state vocabulary.

## The six terminal states

Every verb's commands settle into a subset of:

1. **queued** — accepted by the daemon, not yet handed to the body.
2. **delivered** — the body's control channel received the command.
3. **acknowledged** — the body confirmed it acted (or confirmed it cannot).
4. **failed** — delivery or execution failed for a reason other than lack of support.
5. **expired** — no acknowledgement arrived within the command's timeout.
6. **unsupported** — the backend cannot perform this verb at all; this is not a failure, it's an honest capability boundary.

`delivered`, `acknowledged`, `failed`, and `expired` are required for every verb — a verb missing any of the four cannot tell "sent" apart from "actually happened" apart from "gave up." `unsupported` is required specifically for verb/backend pairs where the backend's `supportedVerbs` doesn't list that verb (see `authorization-sources.md` for how this interacts with authorization).

## Collapsing verbs is the most common failure

A generic `control` or `stop` claim that silently means "interrupt, or maybe pause, or maybe kill depending on backend" produces a UI that renders one spinner for three different runtime truths. The tell: a matrix cell for a core verb (`interrupt`/`pause`/`kill`/`steer`) reports `hasDistinctTerminalStates: false`, or one of those four verb names is simply absent from the contract because its behavior got folded into another verb.

Fixing it is not cosmetic renaming — it requires the backend adapter to actually track a separate delivery lifecycle per verb, because `kill`'s "acknowledged" (process is dead) and `pause`'s "acknowledged" (process is alive but idle) are different facts about the world.
