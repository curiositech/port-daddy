# Port Daddy - Project Overview

## Purpose
Port Daddy is an authoritative port management daemon for multi-agent development. It runs on `localhost:9876` (TCP + Unix socket at `/tmp/port-daddy.sock`) and provides atomic port assignment, distributed locks, pub/sub messaging, agent registry, sessions, and service orchestration.

## Tech Stack
- **Language**: TypeScript (ESM, `.ts` files with `.js` import paths)
- **Runtime**: Node.js with `tsx` for dev
- **Database**: SQLite via `better-sqlite3`
- **HTTP Server**: Express.js
- **Build**: `tsc` to `dist/`
- **Test**: Jest with `@swc/jest` transform, ESM mode
- **Package**: npm, `type: "module"` in package.json

## Architecture
- `server.ts` - Express daemon (main entry point), creates DB + schema for services/endpoints/messages/projects/sessions
- `lib/*.ts` - Core modules (services, locks, messaging, agents, activity, webhooks, projects, sessions, etc.)
- `routes/*.ts` - Express route handlers
- `bin/port-daddy-cli.ts` - CLI entry point, communicates with daemon via HTTP/socket
- `shared/` - Shared utilities (port-utils)
- `tests/setup-unit.js` - In-memory SQLite factory for unit tests

## DB Schema Initialization
- `server.ts` creates: services, endpoints, messages, projects, sessions, session_files, session_notes tables
- `lib/locks.ts` creates: locks table (self-initializing)
- `lib/agents.ts` creates: agents table (self-initializing)
- `lib/webhooks.ts` creates: webhooks, webhook_deliveries tables (self-initializing)
- `lib/activity.ts` creates: activity_log table (self-initializing)
- `lib/sessions.ts` creates: sessions, session_files, session_notes tables (self-initializing, duplicates server.ts)

## Module Pattern
Each module exports a `createXxx(db)` factory function that takes a `better-sqlite3` Database instance and returns an object with methods. Example: `createServices(db)` returns `{ claim, release, find, ... }`.

## CLI Pattern
- CLI uses `pdFetch()` to communicate with daemon via Unix socket or TCP
- On ECONNREFUSED/ENOENT, auto-starts daemon and retries once
- Commands parsed manually (no commander/yargs)
- Options: `--flag value`, `--flag=value`, `-q`, `-j`, `-p`
- Output modes: normal (stderr for humans, stdout for machines), `--json`, `--quiet`, `--export`
