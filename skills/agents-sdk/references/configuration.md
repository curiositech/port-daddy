# Configuration

**Primary source read 2026-09-24:** Cloudflare [Agents configuration](https://developers.cloudflare.com/agents/runtime/operations/configuration/), including Wrangler fields, exports/class lifecycle, TypeScript/Vite setup, type generation, environments, and legacy migration guidance. The snippets are illustrative and were not typechecked or deployed in this bundle.

## Wrangler configuration

Cloudflare’s current Agents documentation declares Durable Object-backed Agent classes with a binding and an `exports` entry. New Agents use `storage: "sqlite"`; the older `migrations` array remains documented as a legacy path.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "my-agent-app",
  "main": "src/server.ts",
  "compatibility_date": "YYYY-MM-DD", // choose and pin an application date
  "compatibility_flags": ["nodejs_compat"],
  "durable_objects": {
    "bindings": [
      { "name": "MyAgent", "class_name": "MyAgent" },
      { "name": "ChatAgent", "class_name": "ChatAgent" }
    ]
  },
  "exports": {
    "MyAgent": { "type": "durable-object", "storage": "sqlite" },
    "ChatAgent": { "type": "durable-object", "storage": "sqlite" }
  },
  "ai": { "binding": "AI" },
  "assets": { "directory": "public", "binding": "ASSETS" },
  "observability": { "enabled": true }
}
```

`nodejs_compat` is required by the current Agents docs. A binding name is the property exposed on `env`; `class_name` must exactly match the exported class. The AI and assets sections are optional: include them only when the application uses Workers AI or static assets. Pin a compatibility date suitable for the deployment rather than copying an example date.

## Class lifecycle and legacy migrations

Keep `exports` synchronized with code. For a rename, use an old-class tombstone with `state: "renamed"` and `renamed_to`, then declare the live class. For deletion or storage changes, follow the current class-lifecycle documentation before deployment; these are persistent-state operations.

An existing Worker can retain its legacy migrations. Tags must be unique and sequential; do not rewrite deployed history:

```jsonc
{
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ExistingAgent"] },
    { "tag": "v2", "new_sqlite_classes": ["NewAgent"] }
  ]
}
```

Do not combine a copied legacy migration recipe with a new `exports` lifecycle plan without reviewing the Worker’s current deployed state.

## TypeScript and Vite

Current documentation recommends extending the SDK TypeScript configuration and forbids TypeScript legacy decorators because the Agents SDK relies on TC39 decorators:

```jsonc
{
  "extends": "agents/tsconfig",
  "compilerOptions": { "jsx": "preserve" }
}
```

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [agents(), react(), cloudflare()],
});
```

Do not set `experimentalDecorators: true`: the documented transform is incompatible with `@callable()`. The exact Vite/Agents package versions belong in the application lockfile and should be typechecked there.

## Bindings, environments, and secrets

Generate binding declarations after configuration changes:

```bash
npx wrangler types env.d.ts --include-runtime false
```

The documented generated `Env` contains binding names such as `MyAgent: DurableObjectNamespace`. Named Wrangler environments do not inherit Durable Object bindings; repeat bindings in every environment that needs them, and recognize that staging and production Durable Objects have separate state.

Use Wrangler secret management for deployed secrets and keep provider keys out of committed configuration. A generated `Env` declaration proves only the declared type surface; test the deployed binding, route, secret availability, and state lifecycle in the target environment.

## Local development limits

Vite and Wrangler development are alternatives documented by Cloudflare, and local Durable Object state is persisted beneath `.wrangler/state/`. Local state, generated types, or successful bundling are not proof that a deployed class migration or secret binding is correct.

## Source limits

This reference preserves setup, lifecycle, Vite, decorator, type-generation, environment, and secret-handling methods from the source reference while updating the class-lifecycle shape. It has not run Wrangler, Vite, a typechecker, a Durable Object, or a deployment.