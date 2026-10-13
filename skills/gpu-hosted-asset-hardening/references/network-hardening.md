# Network Hardening — Per-Daemon Recipes

The single highest-leverage layer. Every published 2024–26 mass-compromise of GPU daemons was reachable on a public IP without auth. Closing the network gap closes the most common attack class entirely.

---

## The universal rule

**Bind 127.0.0.1 by default. Allow access via reverse-proxy or Tailscale. Never `--listen 0.0.0.0` without an upstream auth proxy.**

If you take only one defense from this skill, take this one.

---

## Per-daemon configs

### ComfyUI

```bash
# Correct
python main.py --listen 127.0.0.1 --port 8188

# Behind a reverse proxy with auth (Caddy example)
# /etc/caddy/Caddyfile
your-comfy.example.com {
  reverse_proxy 127.0.0.1:8188
  basicauth {
    user $2a$14$<bcrypt-hash>
  }
  # Or OIDC with caddy-security
}

# Behind Tailscale (no public DNS at all)
sudo tailscale up
# Connect to MagicDNS hostname; only tailnet members can reach it
```

The April 2026 ComfyUI botnet attacked exactly the `--listen 0.0.0.0` default. Tutorials say it's needed for "remote access" — they're wrong; reverse-proxy or Tailscale gives you remote access without the exposure.

### Ollama

```bash
# Correct (default)
# Ollama listens on 127.0.0.1:11434 by default. Don't change OLLAMA_HOST.

# If you must expose to a tailnet
OLLAMA_HOST=100.x.y.z:11434 ollama serve  # bind to your tailnet IP only

# Reverse-proxy with auth
# Same Caddyfile pattern as ComfyUI; reverse_proxy 127.0.0.1:11434
```

Don't set `OLLAMA_HOST=0.0.0.0`. Ollama has no auth; that flag puts arbitrary model inference on the public internet.

### vLLM

```bash
# vLLM defaults to 0.0.0.0 — change it
python -m vllm.entrypoints.openai.api_server \
  --host 127.0.0.1 \
  --port 8000 \
  --api-key $RANDOM_API_KEY \
  --model meta-llama/Meta-Llama-3.1-8B-Instruct
```

Use `--api-key` even when bound to localhost. The reverse proxy validates Bearer tokens; vLLM also validates. Defense in depth.

### Triton Inference Server

```bash
# Triton defaults to 0.0.0.0 on 8000/8001/8002 — change all three
tritonserver \
  --http-port 8000 --http-address 127.0.0.1 \
  --grpc-port 8001 --grpc-address 127.0.0.1 \
  --metrics-port 8002 --metrics-address 127.0.0.1 \
  --model-repository=/models
```

Triton has no built-in auth; reverse proxy is mandatory. For multi-tenant: one Triton instance per tenant, isolated networks; OR Istio/Linkerd with per-tenant authz.

### TGI (Text Generation Inference)

```bash
# In Docker
docker run --gpus all -p 127.0.0.1:80:80 \
  -e HUGGING_FACE_HUB_TOKEN=$HF_TOKEN \
  ghcr.io/huggingface/text-generation-inference:latest \
  --model-id meta-llama/Meta-Llama-3.1-8B-Instruct
```

Bind the port to `127.0.0.1:80`, not `0.0.0.0:80`. Reverse-proxy with auth.

### Ray

```python
# Ray dashboard on 8265 — don't expose
ray.init(
    dashboard_host="127.0.0.1",
    dashboard_port=8265,
    include_dashboard=True,
)
```

For multi-node Ray: use Ray's TLS + auth (since Ray 2.x). And put the dashboard behind a reverse proxy with OIDC.

ShadowRay (CVE-2023-48022, exploited at scale Apr 2024) was exactly this: public Ray dashboards with no auth, attacker hits `/api/jobs` with a malicious script.

### JupyterHub

```yaml
# config.yaml
hub:
  config:
    JupyterHub:
      authenticator_class: oauthenticator.GoogleOAuthenticator  # or GitHub, OIDC
proxy:
  service:
    type: ClusterIP  # not LoadBalancer; use Ingress with auth instead
```

JupyterHub has decent auth out-of-box; the failure mode is "we'll set up OAuth later" and never doing it. Pick an OIDC provider, configure on day one.

### KServe / k8s

```yaml
# NetworkPolicy: only ingress from istio-system / your gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: kserve-ingress
spec:
  podSelector:
    matchLabels:
      serving.kserve.io/inferenceservice: "true"
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: istio-system
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              app: kserve-controller
```

Plus Istio mTLS in STRICT mode for the namespace. Plus AuthorizationPolicies that gate which clients can hit which models.

---

## Egress allowlist

Equally important: what can the daemon reach *outbound*?

### Allowed destinations (typical ML rig)

- `huggingface.co`, `cdn-lfs.huggingface.co`
- `civitai.com` (community models, if used)
- `github.com`, `raw.githubusercontent.com`, `api.github.com` (custom-node clones)
- `pypi.org`, `files.pythonhosted.org` (Python deps)
- `registry.comfy.org` (ComfyUI Manager)
- Your own asset endpoints (R2 / S3)
- A clock source (`pool.ntp.org`)

### Implementation

| Tool | Best for | Setup time |
|---|---|---|
| **Cloudflare Zero Trust + cloudflared** | Easy; allowlist by hostname | 1–2 hours |
| **AWS Security Group + VPC Endpoints** | AWS workloads; per-subnet | 2–4 hours |
| **GCP VPC firewall + Private Service Connect** | GCP workloads | 2–4 hours |
| **`iptables` + `ipset`** | Self-hosted Linux; per-IP | 4–8 hours |
| **`tinyproxy` + allowlist** | Hostname-based outbound proxy on the box | 2–4 hours |
| **Pi-hole / NextDNS at network edge** | Home/lab; coarse | 30 min |
| **K8s NetworkPolicy + egress gateway** | K8s | 4–8 hours |

### Test the allowlist

```bash
# Should succeed
curl -fsSL https://huggingface.co/api/whoami -H "Authorization: Bearer $HF_TOKEN" | jq

# Should fail (not on allowlist)
curl -m 5 https://example.com/  # expect timeout or DNS failure
curl -m 5 https://pool.minexmr.com:443  # expect failure

# This is your "the allowlist works" canary
```

Run those checks weekly via cron and alert if the negative case starts succeeding (someone widened the allowlist; investigate).

---

## Reverse proxy patterns

### Caddy + basic auth (simplest)

```
your-comfy.example.com {
  reverse_proxy 127.0.0.1:8188
  basicauth {
    you $2a$14$<bcrypt-hash>
  }
  encode gzip
  log {
    output file /var/log/caddy/comfy.log
  }
}
```

`caddy hash-password` to generate the bcrypt hash.

### Caddy + Cloudflare Access (production)

```
your-comfy.example.com {
  forward_auth https://your-team.cloudflareaccess.com {
    uri /cdn-cgi/access/login/your-comfy.example.com
    copy_headers Cf-Access-Authenticated-User-Email
  }
  reverse_proxy 127.0.0.1:8188
}
```

Cloudflare Access does OIDC and gives you an audit log of every login. Free tier supports up to 50 users.

### nginx + OIDC (vouch-proxy)

```nginx
server {
  listen 443 ssl;
  server_name your-comfy.example.com;

  auth_request /vouch-validate;
  error_page 401 = @error401;

  location / {
    proxy_pass http://127.0.0.1:8188;
    proxy_set_header Host $host;
  }

  location /vouch-validate {
    proxy_pass http://127.0.0.1:9090/validate;
    proxy_pass_request_body off;
    proxy_set_header Content-Length "";
    proxy_set_header X-Original-URI $request_uri;
  }

  location @error401 {
    return 302 https://vouch.example.com/login?url=$scheme://$http_host$request_uri;
  }
}
```

### Tailscale (no reverse proxy needed)

```bash
sudo tailscale up
# Daemon binds 127.0.0.1; Tailscale serves it on the tailnet
sudo tailscale serve https / http://127.0.0.1:8188
# Now reachable as https://<machine>.<tailnet>.ts.net from any tailnet member
```

Tailscale is the simplest path for team rigs. No public DNS, no certificate management, no firewall rule maintenance.

---

## "We're behind a VPN" gotchas

A VPN is a defense layer, not the defense. Common failures:

- **VPN split tunneling**: when only some traffic goes through, an attacker who's already on the box can reach the public internet directly.
- **VPN with no auth on the daemon**: anyone on the VPN reaches the daemon. Insider threats and "compromised peer box" scenarios still apply. Add daemon-level auth.
- **VPN client on a compromised laptop**: the laptop is now a pivot to the daemon. Apply Tailscale/CF Access ACLs that restrict which devices can reach which services.

Same with private subnets / VPCs: the subnet boundary doesn't authenticate users. Layer auth even on internal traffic.

---

## "I want my customer to access this" patterns

If a customer (someone outside your tailnet / OIDC IDP) needs to use the daemon:

1. **Don't expose the daemon directly.** Put a thin API in front of it that you control. The API does authn, authz, rate limiting, input validation.
2. **Run the customer's submission through pre-validation.** No raw workflow JSON; only a constrained prompt schema. (For ComfyUI specifically: this is what every reputable inference SaaS does — they don't expose the raw `/prompt` endpoint.)
3. **Per-customer quotas + observability.** Customer A can't exhaust the GPU and starve Customer B.

This is `media-gen-deployment` territory. The hardening principle: **never expose a daemon's raw control plane to non-employees**, no matter how much auth is in front.

---

## What "done" looks like

- [ ] Daemon binds 127.0.0.1, not 0.0.0.0.
- [ ] Public access (if any) goes through a reverse proxy with auth or Tailscale.
- [ ] Daemon-level auth is configured in addition to proxy-level auth.
- [ ] Egress allowlist active; tested with positive (allowed host succeeds) and negative (denied host fails) probes.
- [ ] No port forwards / NAT / public Security Group rules to daemon ports.
- [ ] Tested from outside: `curl https://daemon-port` from a non-tailnet, non-authenticated machine — fails.
- [ ] Tested from a peer box: even on the same VPC/network, the daemon requires auth.

Now move to `auth-and-quotas.md` for the user-side controls.
