# Managed Preview Tunnel Example

The design shorthand is "PD Tube"; the shipped command is `pd tunnel`.

`share-preview.ts` shows how to build a safe preview-sharing workflow around
Port Daddy's managed tunnels:

- claim or inspect a service identity
- check installed tunnel providers
- start a public tunnel only when explicitly requested
- write the public URL to tuple space for other agents
- stop the tunnel and release the claim

Inspect readiness:

```bash
npx tsx examples/tunnel/share-preview.ts inspect
pd tunnel providers
```

Claim a local service without exposing it:

```bash
npx tsx examples/tunnel/share-preview.ts claim --identity demo:web --port 5173
```

Start and later stop a managed tunnel:

```bash
npx tsx examples/tunnel/share-preview.ts start --identity demo:web --port 5173 --provider cloudflared
npx tsx examples/tunnel/share-preview.ts stop --identity demo:web
```

Starting a tunnel can expose your local dev server to the public internet. Use
the `status` and `list` commands when you are unsure what is active.
