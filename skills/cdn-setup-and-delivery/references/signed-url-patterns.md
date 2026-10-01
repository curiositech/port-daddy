# Signed URL / Tokenized Access — Implementation Patterns

Read this when implementing HMAC-signed query params or JWT-based tokenized
access for a specific CDN, or explaining the mechanism to someone building it
for the first time.

## Why this pattern exists

Without it, gating "private" content behind a CDN forces one of two bad
options: (a) make the object public and rely on an unguessable URL (security
by obscurity — it gets scraped/shared), or (b) route every request through the
app server to check auth, which defeats the entire purpose of putting a CDN in
front of the content in the first place (see the "Proxying Large Files"
anti-pattern in SKILL.md). Signed URLs let the CDN edge do the access check
itself, per-request, with zero origin round-trip on a cache hit.

## The core mechanism (provider-agnostic)

1. Client requests access to a private object through your app (authenticated
   API call, e.g. `GET /api/files/report-42/download-link`).
2. App server checks the user's authorization against that object as it
   normally would.
3. If authorized, the app server generates a signed URL:
   - Compute a signature (HMAC-SHA256 typically) over the object path,
     expiry timestamp, and optionally the client IP or a nonce, using a
     secret key shared with (or held by) the CDN.
   - Append the signature and expiry as query parameters:
     `https://cdn.example.com/private/report-42.pdf?expires=1732000000&sig=<hmac>`
4. App server returns that URL to the client (in the API response, or as a
   redirect).
5. Client requests the signed URL directly from the CDN.
6. CDN edge recomputes the expected signature from the request path + expiry
   using its copy of the secret, compares it to the provided `sig`, checks
   `expires` against current time, and serves the object on match — entirely
   at the edge, no origin call for a cache hit.

## HMAC query-param signing (sketch, Python)

```python
import hmac, hashlib, time

def sign_url(path: str, secret: bytes, ttl_seconds: int = 300) -> str:
    expires = int(time.time()) + ttl_seconds
    message = f"{path}{expires}".encode()
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return f"{path}?expires={expires}&sig={signature}"
```

The CDN-side verification is the mirror image — recompute the HMAC from the
request path and the `expires` param it receives, compare against `sig`
using a constant-time comparison, reject if `expires` has passed.

## JWT-based tokenized access (sketch)

Used when you want to embed structured claims (user ID, allowed path prefix,
plan tier) rather than a flat signature:

```python
import jwt, time

def issue_access_token(user_id: str, path_prefix: str, secret: str, ttl=300) -> str:
    payload = {
        "sub": user_id,
        "path": path_prefix,      # e.g. "/private/user-123/*"
        "exp": int(time.time()) + ttl,
    }
    return jwt.encode(payload, secret, algorithm="HS256")
```

The CDN or an edge function validates the JWT signature and checks the
`path` claim against the requested object, plus standard `exp` expiry.
JWTs cost more edge CPU to validate than a raw HMAC compare, but carry more
context — useful when the CDN layer needs to make richer authorization
decisions than "is this exact path/expiry pair valid."

## Provider-specific signing mechanisms (check current docs before implementing)

- **CloudFront**: Signed URLs or Signed Cookies using a CloudFront key pair
  (RSA, not HMAC) and a policy document (JSON) that can scope to a single
  object or a path wildcard with a custom expiry.
- **Cloudflare**: Signed URLs via Cloudflare's token authentication feature
  (HMAC-based), configured per zone/hostname; also supports Cloudflare
  Access for a fuller identity-aware proxy in front of an origin.
- **BunnyCDN**: Token authentication using an HMAC token appended as a query
  parameter, with optional IP-locking and expiry.
- **Fastly**: Signed URLs via VCL custom logic or a signing token, more
  DIY than CloudFront/Cloudflare's built-in features.

Always verify current parameter names, algorithms, and key-rotation
mechanics against the provider's live docs — these details change and are
security-critical to get exactly right.

## TTL guidance

- Short-lived, single-use downloads (report export, invoice PDF): minutes.
- Streaming session tokens: match session length, not longer.
- Avoid TTLs measured in days/weeks for anything sensitive — a signed URL is
  valid until expiry regardless of whether the user's underlying permission
  is revoked in the meantime. If revocation-before-expiry matters, keep TTLs
  short enough that the exposure window is acceptable, or pair with a
  denylist check at the edge (added complexity, only worth it for high-
  sensitivity content).

## Common mistakes

- Signing the URL without an expiry, or with an expiry far longer than the
  use case needs — turns a "signed URL" into a de facto permanent public
  link.
- Putting the signing secret in client-side code — the signature must be
  computed server-side, never in the browser/app.
- Forgetting that query-string signing typically covers the path but not
  always the full query string — verify whether your CDN's scheme signs
  the whole request or just specific components, since an attacker who can
  append extra query params to a URL that isn't fully covered by the
  signature may be able to manipulate behavior.
