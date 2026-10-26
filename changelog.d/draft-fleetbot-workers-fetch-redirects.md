type: fixed

- Fleetbot uses Cloudflare Workers-supported manual redirect handling for its bounded GitHub requests. Redirect responses fail closed without forwarding credentials. Scoped token minting explicitly requests and verifies GitHub's mandatory Metadata read permission while rejecting broader authority. Bot identity lookup uses the freshly minted repository token; the App JWT remains scoped to App endpoints, and identity failures revoke the minted token before the publisher records failure.
