type: security

- Refuse unsafe iOS Relay base URLs before reading device credentials, validate the server's bearer grammar, and reject every redirect with a per-task delegate. Production sessions disable cookie, credential, and cache stores. Add offline destination, credential, and redirect regression tests; this does not enable pairing or live Porthole sharing.
