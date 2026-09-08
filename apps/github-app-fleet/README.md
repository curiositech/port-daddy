# Port Daddy Fleet — GitHub App

Port Daddy Fleet is a GitHub App that lets a Port Daddy installation post
findings to a repository: PR comments, review threads, issues, and draft
pull requests. It is the bridge between the local fleet daemon and the
shared surface where reviewers, contributors, and CI already look.

The App has one GitHub identity (`port-daddy-fleet[bot]`). The fleet itself
is **per-repository**. Each installed repo declares which agents (ships)
should run, on which events, with which behavior, in its own
[`pd-fleet.yml`](../../pd-fleet.yml). The App reads that file at dispatch
time and posts as the requested ship by rendering a header tag
(`**[pd-<ship>]**`) into the comment body.

The roster is open. Three worked examples:

- **port-daddy** runs `reviewer`, `redteam`, `qa`, `test-author`,
  `tautology`, `unspider`, and `documentarian`.
- **expungement-guide** runs `upl-checker` (catches Unauthorized Practice
  of Law in drafts), `citation-checker` (validates state-specific
  citations), `plain-language` (Flesch-Kincaid + legalese), and
  `accessibility`.
- **jury_rig** runs `skill-media` (generates hero illustrations for skill
  dossiers), `mermaid-author` (draws diagrams referenced in copy), and
  `skill-grammar` (lints SKILL.md frontmatter and required sections).

See [`docs/per-project-ships.md`](docs/per-project-ships.md) for the
schema, fragment examples, and how to introduce a new ship.

---

## Why one App and an open ship roster

The unit of install on GitHub is the App, not the agent. Seven Apps is
seven private keys, seven webhook receivers, seven installations to grant
and revoke. Operators do not do that.

One App with a body-rendered identity gets all the differentiation that
matters — readers can scan a thread and tell `pd-reviewer` apart from
`pd-redteam` at a glance, can mute one ship without uninstalling, and can
introduce new ships per repository without registering anything with
GitHub.

A repository's ship roster lives in its own `pd-fleet.yml`. A legal
content site needs Unauthorized Practice of Law checks. A media-heavy
documentation site needs an illustration generator. Neither belongs in a
GitHub App's source tree; both belong in the installed repo's own config.

---

## How dispatch works

```
GitHub webhook
      │
      ▼
App receiver (Cloudflare Worker) — verifies HMAC, normalizes to an envelope
      │  POST <DAEMON_FORWARD_URL>  (Authorization: Bearer <token>)
      ▼
Daemon route  POST /webhooks/github  (routes/github-webhook.ts)
      │  authenticates the forwarder, then publishes to the messaging bus:
      │    github:webhook:<event>            (e.g. github:webhook:pull_request)
      │    github:webhook:<event>:<action>   (e.g. …:pull_request:opened)
      │    github:<owner>/<repo>:<event>
      ▼
Fleet engine (lib/fleet-engine.ts) — every agent whose `trigger:` resolves
      │  to a published channel fires (messaging.subscribe)
      ▼
postAs(shipMeta, operation)  ──►  GitHub API as port-daddy-fleet[bot]
                                  with **[pd-<ship>]** header
```

A ship subscribes to GitHub events by declaring an unscoped (`global:`)
channel in its `pd-fleet.yml`:

```yaml
fleet:
  agents:
    reviewer:
      trigger: global:github:webhook:pull_request   # any PR event
      # trigger: global:github:webhook:pull_request:opened   # only "opened"
      # trigger: global:github:curiositech/port-daddy:pull_request  # repo-keyed
```

The `global:` prefix is required: the fleet channel resolver project-scopes
bare channel names, but the inbound route publishes the literal,
unscoped channels above, so the trigger must opt out of scoping to match.

> **Follow-up (not yet built):** routing is currently fan-out — every
> project's fleet that subscribes to `global:github:webhook:pull_request`
> fires on *every* installed repo's PR events. Per-project isolation (so
> only the installed repo's fleet fires) needs a repo→projectDir registry
> the daemon does not have yet. Until then, prefer the repo-keyed channel
> (`global:github:<owner>/<repo>:<event>`) when a fleet should react to
> exactly one repository.

`postAs` is the only entry point for the output side. Its signature
accepts a `ShipMeta` value the caller has resolved (handle, role, optional
mark) — there is no closed list of ships in the App code. See
[`lib/post-as.ts`](lib/post-as.ts) for the type.

---

## Install on your repository

The App is not yet registered on github.com. Once it is, the flow is:

1. Visit `https://github.com/apps/port-daddy-fleet`. (Placeholder slug;
   the operator updates this after registration.)
2. Click **Install**, then pick the repositories you want the fleet to
   reach.
3. GitHub redirects to
   `https://portdaddy.dev/github/app/installed?installation_id=...`. Copy
   the `installation_id` from the URL.
4. Set three secrets in the runtime that posts on the App's behalf
   (Cloudflare Workers env, your secret manager, or `.env.local` in dev):

   ```bash
   GITHUB_APP_ID=...                  # numeric, visible on the App settings page
   GITHUB_APP_PRIVATE_KEY=...         # PEM, raw or base64-encoded
   GITHUB_APP_INSTALLATION_ID=...     # per-repo, from step 3
   ```

5. Add a `pd-fleet.yml` to the installed repository at the path the
   runtime is configured to read (default: repository root). See
   [`docs/per-project-ships.md`](docs/per-project-ships.md) for the
   schema.

6. Verify auth from the runtime:

   ```ts
   import { getOctokitForInstallation } from 'apps/github-app-fleet/lib/auth'
   const oct = await getOctokitForInstallation()
   const me = await oct.apps.getAuthenticated()
   console.log(me.data.slug) // -> port-daddy-fleet
   ```

If that prints the slug, auth is live. The next event that matches a
configured ship's `trigger:` produces a post.

The private key is the credential that lets the App act as the bot. Treat
it like any other production secret: rotate via the App settings page,
re-deploy the env if a runtime leaks one. The installation ID is not
sensitive on its own.

---

## Comment shape

Every post the App makes carries the same envelope. The differences
between ships are confined to the header line and the body content.

```
**[pd-<ship>]** <mark>  _<role>_

<body>

<sub>posted by the Port Daddy fleet — `pd-<ship>` · [silence this ship](https://portdaddy.dev/docs/fleet/silence)</sub>
```

- `pd-<ship>` matches the ship's `handle` in `pd-fleet.yml`.
- `<mark>` is an optional unicode primitive (geometric only — no emoji).
- `<role>` is the ship's one-line role description.
- The signed footer carries a link to the per-ship silence flow, which
  toggles the runtime off without affecting the App installation.

The framing is implemented in `frameBody(ship, body)` and is idempotent.
Bodies that already start with the same `**[pd-<handle>]**` prefix are
returned unchanged, so a body composed through framing can be passed
through framing again safely.

---

## Cost expectations

The fleet runs locally by default. Most ships use Llama 3.1 8B or a
similar small model. The writing-heavy ships (test authors, image
generators, document drafters) use larger models. None of that is fixed
by this App; the per-ship backend is set in the installed repo's
`pd-fleet.yml`.

Rough numbers from `port-daddy`'s own fleet over a dogfood week, all
seven ships on Anthropic Claude Haiku:

| Ship             | Default backend         | Cloud cost / PR (Claude Haiku) |
|------------------|-------------------------|--------------------------------|
| reviewer         | local (llama 8B)        | ~$0.004                        |
| redteam          | local (llama 8B)        | ~$0.006                        |
| qa               | local (llama 8B)        | ~$0.003                        |
| test-author      | local (qwen)            | ~$0.012                        |
| tautology        | local (llama 8B)        | ~$0.001                        |
| unspider         | local (llama 8B)        | ~$0.002                        |
| documentarian    | local (qwen)            | ~$0.008                        |

A PR-heavy week with all seven on Haiku came in under one US dollar for
one repository. Sonnet is roughly ten times that; Opus is roughly five
times Sonnet. The `port-daddy:fleet` daemon enforces per-day budget caps
declared in `pd-fleet.yml > fleet.limits.budget_usd_per_day`. The App is
not the budget enforcer; it is the surface.

Other repositories' ships have their own cost shapes. A `skill-media`
ship that generates images is not measured in tokens — it is measured in
image-generation calls, which the runtime budgets separately.

---

## Silencing the fleet

`pd fleet down` stops the local runners. The App stays installed; no
posts arrive. This is the intentional default: uninstalling and
reinstalling a GitHub App is meaningful friction, and an operator should
be able to silence the fleet for a week without re-doing the trust
exchange.

To remove the App entirely, use **Settings → Integrations → GitHub Apps
→ Configure → Uninstall** on the repository or organization. This
revokes the installation token, removes the per-repo permission grant,
and detaches the App from all webhooks for that installation.

To silence a single ship without taking the fleet down, set `enabled:
false` on that ship's block in `pd-fleet.yml` and let the next webhook
re-read the config. The App does not maintain its own enable/disable
state — the YAML is the source of truth.

---

## Files

```
apps/github-app-fleet/
├── manifest.json          # App manifest — paste into the GitHub "create from manifest" flow
├── README.md              # this file
├── CHANGELOG.md
├── lib/
│   ├── auth.ts            # JWT + installation-token management, with caching
│   └── post-as.ts         # postAs(ship, operation) — single entry point
├── docs/
│   └── per-project-ships.md   # per-repo pd-fleet.yml schema + worked examples
├── icons/                 # three direction concepts × three sizes
│   ├── A-lighthouse/
│   ├── B-anchor/
│   └── C-lantern/
└── scripts/
    └── generate-icons.sh  # nano-banana driver
```

---

## What still needs operator action

These are not code decisions. They are owned by the App's account-holder:

- The **App slug** (the URL `github.com/apps/<slug>`). This README
  assumes `port-daddy-fleet`. Shorter slugs are available.
- The **webhook URL** in `manifest.json`. The placeholder is
  `https://REPLACE_ME.portdaddy.dev/github/webhooks`. The receiver is a
  deployment-time decision.
- The **redirect, setup, and OAuth callback URLs**. The defaults are
  `portdaddy.dev/github/app/*`. If the install-experience pages are
  hosted elsewhere, swap them.
- The **icon direction** to ship. `icons/` carries three concepts; one
  must be picked before the App is registered.
- Whether the App is **registered to a personal account** or to a
  **Curiositech organization**. The organization is the right home for a
  public App; the personal account is fine while it is private.
- **Running the manifest-create flow.** That mints the private key and
  the App ID. It is a one-time, irreversible action and is not part of
  this scaffolding.

---

## Time budget

Roughly, end-to-end, starting from this manifest:

| Step                                                                       | Time          |
|----------------------------------------------------------------------------|--------------:|
| Pick an icon direction from `icons/`                                       | 2 min         |
| Decide the App slug and account                                            | 2 min         |
| Set up a webhook receiver (smee for dev, Worker for prod)                  | 5–15 min      |
| Open `github.com/settings/apps/new?manifest=...` and paste                 | 1 min         |
| Save the generated private key, App ID, and installation ID                | 2 min         |
| Add the three env vars to the runtime                                      | 3 min         |
| Add `pd-fleet.yml` to the first installed repository                       | 5–10 min      |
| First round-trip test (`getOctokitForInstallation` → `apps.getAuthenticated`) | 2 min     |
| **Total**                                                                  | **~25–40 min** |

First-time App registration adds another 15–30 minutes of GitHub-side
navigation. Subsequent installs are routine.
