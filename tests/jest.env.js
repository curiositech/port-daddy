/**
 * Jest per-worker environment setup.
 *
 * Runs before each test file (setupFiles, not setupFilesAfterEach).
 * Purpose: isolate tests from shared OS state like the macOS Keychain.
 * Without this, any test that boots the daemon (createHarborTokens,
 * createNoteEncryption) would read/write real Keychain entries and
 * leak state between unrelated suites.
 */
process.env.PORT_DADDY_DISABLE_KEYCHAIN = '1';
