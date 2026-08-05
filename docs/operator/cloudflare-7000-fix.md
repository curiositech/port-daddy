# Cloudflare Workers AI code 7000

This is a historical incident note with a current recovery path. Port Daddy
3.15 fixed the model-path encoder that turned a namespaced model id into one
escaped URL segment. A fleet-wide `No route for that URI` response from models
that are present in the live catalog usually means the running daemon is older
than the installed release or a named feature daemon was not rebuilt.

Do not edit model slugs first, replace a launchd plist, or point stable at a
source checkout.

## Diagnose the selected runtime

FleetBar is the operator surface. Its daemon inspector must show the selected
profile, published endpoint, version, source revision, and lifecycle owner.
Agents can collect the same evidence:

```bash
pd status --json
pd dev list
```

For stable, compare the live version with the installed Homebrew version. For a
named development daemon, compare its reported source revision with the
feature worktree's `HEAD`. A successful CLI request proves only that client's
transport; also verify the published browser endpoint.

## Recover without competing supervisors

- Stable is owned by Homebrew and launchd. Upgrade the formula, then use the
  FleetBar restart control. Release automation may use
  `brew services restart port-daddy`.
- A feature build is owned by its named `pd dev` record. Rebuild it from the
  intended worktree and reselect it:

  ```bash
  pd dev down cloudflare-7000-check
  pd dev up --from "$(pwd)" --label cloudflare-7000-check
  eval "$(pd use cloudflare-7000-check)"
  ```

Do not purge the profile during an ordinary rebuild. Its published port may
change, so clients must consume the selector output instead of reusing an old
URL.

## Verify

```bash
pd status --json
pd spawn --backend cloudflare \
  --model '@cf/qwen/qwen3-30b-a3b-fp8' \
  --purpose 'cloudflare model-path smoke' \
  --budget 0.02 \
  -j -- 'reply with one word'
```

The receipt must name the selected daemon revision and end with a non-empty
terminal result. If the same wire error persists on the intended revision,
capture the exact request path and current Cloudflare model catalog before
changing configuration. External platform facts must be checked against
[Cloudflare's current Workers AI documentation](https://developers.cloudflare.com/workers-ai/).

The regression coverage lives in `tests/unit/llm-call.test.js`; it requires
literal namespace separators and the leading `@` in the outbound model path.

See [daemon and supervision](../operations/daemon-and-supervision.md) for the
two supported runtime roles.
