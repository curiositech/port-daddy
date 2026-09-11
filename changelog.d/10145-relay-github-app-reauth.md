type: fixed

- **Relay GitHub reconnects now show which account is being selected.** Account pages describe the real GitHub App OAuth flow and seven-day browser session, explicit Ship Controls reconnects open GitHub's account picker, denied repositories link to GitHub App access settings, and browser-bound state plus PKCE prevent login-session swapping. The replaced Relay session is revoked, and the app no longer sends classic OAuth App scopes that cannot grant GitHub App repository permissions.
