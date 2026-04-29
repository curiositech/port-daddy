# Example Services

These are tiny services you can orchestrate with Port Daddy. They avoid
framework dependencies so the examples run from this repo without installing
Express or a separate frontend stack.

| Service | Default identity | Shows |
| --- | --- | --- |
| API | `examples:api` | Claims a port, exposes `/health` and `/items`, releases on shutdown |
| Web | `examples:web` | Waits for/discovers the API through Port Daddy before serving HTML |
| Worker | `examples:worker` | Waits for/discovers the API, then polls it |

## Run Manually

Use three terminals:

```bash
npx tsx examples/services/api-server.ts
npx tsx examples/services/frontend.ts
npx tsx examples/services/worker.ts
```

Inspect:

```bash
pd find examples:
pd wait examples:api examples:web
npx tsx examples/devtools/agent-workbench.ts
```

## Expose The Frontend

After the web service is running:

```bash
npx tsx examples/tunnel/share-preview.ts start --identity examples:web --provider cloudflared
pd tunnel list
```

Stop the tunnel when done:

```bash
npx tsx examples/tunnel/share-preview.ts stop --identity examples:web
```

## Customize Identities

```bash
PD_SERVICE_ID=myapp:api PORT=4100 npx tsx examples/services/api-server.ts
API_ID=myapp:api PD_SERVICE_ID=myapp:web npx tsx examples/services/frontend.ts
API_ID=myapp:api PD_SERVICE_ID=myapp:worker npx tsx examples/services/worker.ts
```
