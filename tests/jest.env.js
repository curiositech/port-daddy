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

// The worktree-isolation guard refuses spawns into a *main* checkout (the
// 403-file-deletion defense). CI checks the repo out AS a main checkout, so any
// unit test that calls spawner.spawn() without an explicit workdir trips it and
// gets the isolation message instead of the behavior under test. Unit tests run
// in an isolated, single-process context (not a real operator main checkout with
// parallel agents), so disable the guard suite-wide here. The guard's OWN tests
// (tests/unit/spawner-isolation-guard.test.js) delete this and pass explicit env
// args, so they still exercise the live guard.
process.env.PD_SPAWN_ISOLATION_OFF = '1';

// A persisted FleetBar CLI-backend selection (~/.port-daddy-cli-backend) must
// never leak into tests. detectForcedCliBackend() falls back to that dotfile,
// which force-routes EVERY spawner.spawn() through cli:<tool> — on a machine
// where the operator picked codex, the spawner-coast-guard suite watched its
// `custom` backend spec spawn `codex` instead of the sandbox-wrapped command
// under test (70 failures that never reproduce in CI, where no dotfile exists).
// 'none' is the explicit off-switch: env wins over the dotfile. Tests that
// exercise the override itself set their own PD_USE_CLI_BACKEND / pass an
// explicit persistedPath, so this default doesn't blunt them.
process.env.PD_USE_CLI_BACKEND = 'none';
