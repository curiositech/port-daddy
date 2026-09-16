type: fixed

- **GitHub App key handling is now consistent across every Worker.** Relay, Fleet executor, and the webhook receiver share one strict parser that accepts GitHub-downloaded PKCS#1 keys and PKCS#8 keys while rejecting malformed, mislabeled, encrypted, or concatenated PEM material before signing.
