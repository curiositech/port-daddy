# 0013. The Unified Harbor Model & Cryptographic Security

## Status

Accepted (Deep Engineering Revision)

## Context

In Port Daddy V3, agents operate in an implicit global namespace. Any agent can claim any resource, read any notes, or publish to any channel. This "no walls, no doors" approach is sufficient for single-user scenarios but fails as soon as:
- **Remote Collaboration**: Multiple users share a daemon (Lighthouses).
- **Security Posture**: Experimental agents need to be sandboxed.
- **Economic Attribution**: Credits and reputation ledgers must be scoped to specific projects.

## Decision

Adopt the **Unified Harbor Model** as the universal unit of scope, security, and economy.

### 1. Default Implicit Harbors
- **Auto-Sandbox**: Every `pd begin` or `pd scan` automatically creates or joins a Harbor based on the project root (e.g., `harbor: myapp`).
- **Invisible Security**: Security is "invisible" for standard local use—no manual certificate management or complex setup.

### 2. ed25519 Harbor Tokens
- **Public-Key Verification**: Use **Harbor Tokens** (JWTs signed with ed25519) for all daemon requests.
- **Verification**: Any agent or remote daemon can verify a Harbor Token using the daemon’s public key without needing the private key.
- **Scope Enforcement**: Every Fastify route utilizes a pre-handler hook that parses the token's scope claim (e.g., `scope: myapp:web:**`).

### 3. Harbor Inheritance & Ambient Knowledge
- **Skills**: Harbors are nodes in the Semantic Token Graph. Agents born in a Harbor automatically inherit "Ambient Knowledge" (e.g., if a harbor provides `skill:postgres`, all agents inside gain that edge).

### 4. Outbound Firewall & Approval Queue
- **Read-Only Context**: External Connectors (Gmail, GitHub) are "read-only" by default.
- **Human-in-the-Loop**: Any agent wishing to make an outbound write request (e.g., `POST/PUT`) must have it approved via a dashboard **Approval Queue**.

## Rationale

By making Harbors the default and invisible unit of isolation, we provide high security without manual configuration. Agents "born" in a harbor are naturally constrained by its tokens. Using ed25519 signatures allows for secure, distributed verification across Lighthouses, which is essential for the V4 economy.

## Consequences

### Positive
- **Project Isolation**: Agents in `project-a` cannot interfere with `project-b`.
- **Seamless Remote**: Moving from local to remote is a matter of changing the Lighthouse URL; the Harbor primitive remains the same.
- **Security**: Mandatory human approval for outbound writes prevents "rogue agent" catastrophes.

### Negative
- **Friction for SDKs**: Existing SDKs must be updated to handle and present Harbor Tokens.
- **Performance**: Cryptographic verification adds a small constant overhead to every request (mitigated by ed25519's speed).

### Neutral
- **Home Port**: The maritime theme is reinforced: the Harbor is the "Home Port" for the swarm.
