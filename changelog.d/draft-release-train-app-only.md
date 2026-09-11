type: security

- **Release-train writes now use the responsible Port Daddy App.** Read-only discovery remains independent of App secrets; version PRs and Releases use separate repository-scoped tokens with exact source, bot, tag and publication witnesses. Ambiguous responses never trigger blind publication retries, and explicit token cleanup reports confirmed revocation separately from unconfirmed cleanup after a successful write. Signing, soak, review, protected queue, tap and fresh-install gates remain intact; approved Actions configuration and live rollout are separate work.
