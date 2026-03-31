# .portdaddyrc Specification

The `.portdaddyrc` file is a JSON configuration file placed in a project root. It defines services, port ranges, dev commands, and coordination settings for Port Daddy.

---

## Generation

Generate automatically with framework detection:

```bash
port-daddy init
```

This detects 16 frameworks (Next.js, Nuxt, SvelteKit, Remix, Astro, Vite, Angular, CRA, Vue CLI, Express, Fastify, Hono, NestJS, FastAPI, Flask, Django) and produces a `.portdaddyrc` with sensible defaults.

---

## Full Schema

```json
{
  "project": "myapp",
  "services": {
    "api": {
      "port": 3100,
      "cmd": "npm run dev",
      "healthPath": "/health",
      "healthTimeout": 30000,
      "env": { "NODE_ENV": "development" },
      "cwd": "./packages/api",
      "needs": ["db"],
      "noPort": false,
      "metadata": { "framework": "express" }
    },
    "frontend": {
      "port": 3101,
      "cmd": "npm run dev -- --port ${PORT}",
      "healthPath": "/",
      "needs": ["api"]
    },
    "worker": {
      "cmd": "node worker.js",
      "noPort": true,
      "needs": ["api"]
    }
  },
  "portRange": [3100, 3199],
  "context": "main"
}
```

---

## Field Reference

### Top-Level Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `project` | string | yes | — | Project name (first part of semantic identity) |
| `services` | object | yes | — | Map of service name → service config |
| `portRange` | [min, max] | no | [3100, 9999] | Port range for this project |
| `context` | string | no | `"main"` | Default context (e.g., branch name) |

### Service Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `port` | number | no | auto-assigned | Preferred port number |
| `cmd` | string | no | — | Dev command (`${PORT}` replaced with assigned port) |
| `healthPath` | string | no | — | HTTP path for health checks |
| `healthTimeout` | number | no | 30000 | Health check timeout in ms |
| `env` | object | no | — | Environment variables for the command |
| `cwd` | string | no | project root | Working directory (relative to .portdaddyrc) |
| `needs` | string[] | no | — | Services that must be healthy before starting this one |
| `noPort` | boolean | no | false | Service doesn't need a port (e.g., background workers) |
| `metadata` | object | no | — | Arbitrary metadata |

---

## Port Variable Expansion

Use `${PORT}` in `cmd` — it's replaced with the assigned port at runtime:

```json
{
  "cmd": "next dev --port ${PORT}"
}
```

---

## Dependency Graph

The `needs` field creates a startup dependency graph. `port-daddy dev` starts services in topological order:

```
db (no deps) → api (needs db) → frontend (needs api)
                               → worker (needs api)
```

Services wait for their dependencies' health checks to pass before starting.

---

## Monorepo Support

For monorepos, use `cwd` to point to subdirectories:

```json
{
  "project": "monorepo",
  "services": {
    "api": { "port": 3100, "cmd": "npm run dev", "cwd": "./packages/api" },
    "web": { "port": 3101, "cmd": "npm run dev", "cwd": "./packages/web", "needs": ["api"] },
    "docs": { "port": 3102, "cmd": "npm run dev", "cwd": "./packages/docs" }
  }
}
```

---

## Semantic Identity Mapping

The `.portdaddyrc` `project` field becomes the first segment of the semantic identity. Service names become the second segment. The `context` field becomes the third:

```
project: "myapp", service: "api", context: "main"
→ identity: "myapp:api:main"
```

---

## Examples

### Next.js + Express API

```json
{
  "project": "webapp",
  "services": {
    "api": { "port": 3100, "cmd": "node server.js", "healthPath": "/health" },
    "frontend": { "port": 3000, "cmd": "next dev --port ${PORT}", "needs": ["api"] }
  }
}
```

### Python + JavaScript Polyglot

```json
{
  "project": "mlapp",
  "services": {
    "inference": { "port": 8000, "cmd": "uvicorn main:app --port ${PORT}", "healthPath": "/health" },
    "dashboard": { "port": 3000, "cmd": "npm run dev -- --port ${PORT}", "needs": ["inference"] }
  }
}
```

### Workers (No Port)

```json
{
  "project": "pipeline",
  "services": {
    "api": { "port": 3100, "cmd": "npm start" },
    "worker": { "cmd": "node worker.js", "noPort": true, "needs": ["api"] },
    "scheduler": { "cmd": "node cron.js", "noPort": true }
  }
}
```
