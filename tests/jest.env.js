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

// Activate the fail-closed production-DB guard (lib/db.ts assertNotProdInTest).
// JEST_WORKER_ID is normally set in worker subprocesses, but set an explicit
// marker too so the guard fires unconditionally across the whole suite —
// a stray initDatabase() with no args must never resolve to the live registry.
process.env.PD_TEST = '1';
