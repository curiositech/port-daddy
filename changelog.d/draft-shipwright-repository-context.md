type: security

- **Shipwright context and publication authority are repository-scoped.** Durable threads, prompts, quotas, retention, and GitHub publication now bind to the signed-in user and repository; read access cannot silently grant write authority, cross-repository history cannot leak into a session, and erasure remains available after repository access is lost.
