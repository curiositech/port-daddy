# Multiplayer Dev Env Template

This template demonstrates how to use Port Daddy's Remote Harbors (Lighthouses) and Tunnels to create a shared, real-time development environment across different machines.

## Architecture

1.  **Frontend Dev (Alice):** Runs the React application locally, claiming port 3000.
2.  **Backend Dev (Bob):** Runs the Python FastAPI server locally, claiming port 8000.
3.  **Lighthouse (Cloudflare Worker):** Facilitates discovery between Alice and Bob's Port Daddy daemons.
4.  **Tunnels:** Port Daddy automatically creates secure ngrok/cloudflared tunnels so Alice's frontend can talk to Bob's backend.

## Setup

```bash
# Alice's machine
pd harbor create project-x --public
pd up --service frontend

# Bob's machine
pd harbor discover project-x
pd harbor join project-x
pd up --service backend
```

## How it uses Port Daddy
*   **Remote Harbors:** Secure capability exchange over the internet.
*   **Automatic Tunnels:** `pd tunnel` exposes the services, and the URL is injected into the other developer's `.env` automatically via the daemon sync.
*   **Cross-Machine DNS:** Bob can curl `http://frontend.project-x.local` and Port Daddy routes it through the tunnel to Alice's machine.
