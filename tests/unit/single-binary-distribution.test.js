import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('single binary distribution path', () => {
  test('builds through the bundle entrypoint and manifest script', () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

    expect(pkg.scripts['build:bin']).toBe('node scripts/build-single-binary.mjs');
    expect(existsSync(join(process.cwd(), 'scripts', 'build-single-binary.mjs'))).toBe(true);
    const script = readFileSync(join(process.cwd(), 'scripts', 'build-single-binary.mjs'), 'utf8');
    expect(script).toContain("bin/port-daddy-bundle.ts");
    expect(script).toContain('writeEmbeddedAssetsModule');
    expect(script).toContain('writeEmbeddedNativeCoreModule');
    expect(script).toContain('stageSquidReleaseAssets');
    expect(script).toContain("scripts/smoke-squid-release.mjs");
    expect(script).toContain('targetArch');
    expect(script).toContain("from './lib/onnx-runtime-native.mjs'");
    expect(script).toContain('requestedArch !== process.arch');
    expect(script).toContain("run('bash', ['scripts/build-core.sh']");
    expect(script).toContain('dataBase64');
    expect(script).toContain('embeddedNativeCore');
    expect(script).toContain('canSmokeTarget');
    expect(script).toContain("Expected embedded native core for same-runner target");
    expect(existsSync(join(process.cwd(), 'bin', 'port-daddy-bundle.ts'))).toBe(true);
  });

  test('single binary entrypoint can route daemon mode before loading the CLI', () => {
    const bundle = readFileSync(join(process.cwd(), 'bin', 'port-daddy-bundle.ts'), 'utf8');
    const daemonBundle = readFileSync(join(process.cwd(), 'bin', 'port-daddy-daemon.ts'), 'utf8');
    const daemonBuild = readFileSync(join(process.cwd(), 'scripts', 'build-daemon-binary.mjs'), 'utf8');

    expect(bundle).toContain("process.env.PORT_DADDY_CAN_SELF_DAEMON = '1'");
    expect(bundle).toContain('embedded-native-core.generated.js');
    expect(bundle).toContain("await import('koffi')");
    expect(bundle).toContain('__PORT_DADDY_KOFFI_LOAD_ERROR__');
    expect(bundle).toContain("process.argv[2] === '__daemon'");
    expect(bundle).toContain("process.argv[2] === 'start' && process.argv.includes('--foreground')");
    expect(bundle).toContain('resolveDbIntegrityHelperInvocation(process.argv)');
    expect(bundle).toContain('runDbIntegrityHelper(dbIntegrityHelper)');
    expect(bundle).toContain("await import('../server.js')");
    expect(bundle).toContain('PORT_DADDY_SUPPRESS_CLI_MAIN');
    expect(bundle).toContain("await import('./port-daddy-cli.ts')");
    expect(bundle).toContain('port-daddy-cli.js is the npm shim');
    expect(bundle).toContain('await cli.main()');
    expect(daemonBundle).toContain('resolveDbIntegrityHelperInvocation(process.argv)');
    expect(daemonBundle).toContain('runDbIntegrityHelper(dbIntegrityHelper)');
    expect(daemonBundle).toContain("await import('../server.js')");
    expect(daemonBuild).toContain("'bin/port-daddy-daemon.ts'");
    expect(daemonBuild).toContain("['__semantic-runtime-check']");
    expect(daemonBuild).toContain('packageOnnxRuntimeNative');
    expect(daemonBuild).not.toContain("['build', '--compile', 'server.ts'");
    expect(daemonBundle).toContain("process.argv[2] === '__semantic-runtime-check'");
  });

  test('server publishes its PID and heartbeat before opening the registry', () => {
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const duplicateCheck = server.indexOf("if (existsSync(SOCK_PATH)) {");
    const readyClear = server.indexOf('clearDaemonReady(READY_FILE);');
    const leaseWrite = server.indexOf('const bosunHeartbeat = createBosunHeartbeat({');
    const databaseOpen = server.indexOf('const db: DatabaseInstance = initDatabase({');
    const listener = server.indexOf('sockServer.listen(SOCK_PATH');
    const readyCallback = server.indexOf('function onReady(): void {');
    const readyPublish = server.indexOf('publishDaemonReady(READY_FILE, process.pid);');
    const daemonStart = server.indexOf('activityLog.log(ActivityType.DAEMON_START');
    const readyCallAfterListener = server.indexOf('onReady();', listener);

    expect(leaseWrite).toBeGreaterThan(0);
    expect(readyClear).toBeGreaterThan(duplicateCheck);
    expect(readyClear).toBeLessThan(leaseWrite);
    expect(leaseWrite).toBeLessThan(databaseOpen);
    expect(server.indexOf('bosunHeartbeat.start();')).toBeLessThan(databaseOpen);
    expect(server.indexOf('await createDbIntegrityProofOutOfProcess(DB_PATH)')).toBeLessThan(databaseOpen);
    expect(server.indexOf('bosunHeartbeat.startProbing();')).toBeGreaterThan(listener);
    expect(readyPublish).toBeGreaterThan(readyCallback);
    expect(readyPublish).toBeLessThan(daemonStart);
    expect(readyCallAfterListener).toBeGreaterThan(listener);
    expect(server).toContain('clearDaemonReady(READY_FILE, process.pid);');
  });

  test('runs MCP in-process instead of shelling out through tsx', () => {
    const cli = readFileSync(join(process.cwd(), 'bin', 'port-daddy-cli.ts'), 'utf8');
    const mcpCase = cli.slice(cli.indexOf("case 'mcp':"), cli.indexOf("case 'dns':"));

    expect(mcpCase).toContain("await import('../mcp/server.js')");
    expect(mcpCase).not.toContain("node_modules', '.bin', 'tsx");
    expect(mcpCase).not.toContain('spawn(process.execPath');
  });

  test('daemon launch resolver supports a self-hosted single-binary mode', () => {
    const resolver = readFileSync(join(process.cwd(), 'shared', 'daemon-binary.ts'), 'utf8');

    expect(resolver).toContain("export type DaemonLaunchMode = 'binary' | 'source' | 'self'");
    expect(resolver).toContain("args: ['__daemon']");
    expect(resolver).toContain('PORT_DADDY_CAN_SELF_DAEMON');
  });

  test('server falls back to embedded public assets when public/ is absent', () => {
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');

    expect(server).toContain('registerEmbeddedPublicAssets');
    expect(server).toContain('__PORT_DADDY_EMBEDDED_PUBLIC_ASSETS__');
    expect(server).toContain('Bun?: { embeddedFiles?');
    expect(server).toContain("name?.startsWith('public/')");
  });

  test('manifest advertises self-hosted daemon and embedded public surfaces', () => {
    const buildScript = readFileSync(join(process.cwd(), 'scripts', 'build-single-binary.mjs'), 'utf8');

    expect(buildScript).toContain('self-hosted via hidden __daemon entrypoint');
    expect(buildScript).toContain('embedded in the executable through a generated asset table');
    expect(buildScript).toContain('embeddedNativeCore');
    expect(buildScript).toContain('smokeSelfHostedDaemon');
    expect(buildScript).toContain('writePdLauncher');
    expect(buildScript).toContain('launcherSource');
    expect(buildScript).toContain('prepareOnnxRuntimeNativeBinding');
    expect(buildScript).not.toContain('DYLD_FALLBACK_LIBRARY_PATH');
    expect(buildScript).toContain('LD_LIBRARY_PATH');
    expect(buildScript).toContain("run('cc'");
    expect(buildScript).toContain('execv(target, child_argv)');
    expect(buildScript).toContain('setenv("PORT_DADDY_FORCE_TCP", "1", 1)');
    expect(buildScript).toContain("basename(requestedOutfile) === 'pd'");
    expect(buildScript).toContain("join(dirname(requestedOutfile), 'port-daddy')");
    expect(buildScript).toContain('target: target || null');
    expect(buildScript).toContain('/arbiter/status');
    expect(buildScript).toContain('embedded native Arbiter enforcer was not loaded cleanly');
    expect(buildScript).toContain("['attention', '--agent', 'pd-single-binary-smoke-agent', '--json']");
    expect(buildScript).toContain("['attention', '--json']");
    expect(buildScript).toContain('single binary CLI smoke failed: bare pd attention did not return the expected summary');
    expect(buildScript).toContain('single binary CLI smoke failed: pd attention did not return the expected summary');
    expect(buildScript).toContain('isolated-bin');
    expect(buildScript).toContain('copyFileSync(outfile, isolatedOutfile)');
    expect(buildScript).toContain('companionFiles');
    expect(buildScript).toContain('repair-capable companion scripts staged beside every locally built artifact');
  });

  test('compiled CLI relaunches short pd binary through sibling port-daddy before daemon work', () => {
    const cli = readFileSync(join(process.cwd(), 'bin', 'port-daddy-cli.ts'), 'utf8');

    expect(cli).toContain('function maybeRelaunchShortBinary()');
    expect(cli).toContain("basename(execPath) === 'pd' || basename(argv0) === 'pd'");
    expect(cli).toContain("join(dirname(execPath), 'port-daddy')");
    expect(cli).toContain("PORT_DADDY_DISABLE_SHORT_REEXEC: '1'");
    expect(cli).toContain('maybeRelaunchShortBinary();');
  });

  test('release workflow uses the single-binary builder instead of compiling the CLI shim directly', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    expect(workflow).toContain('node scripts/build-single-binary.mjs --target=${{ matrix.target }} --outfile=dist/pd');
    expect(workflow).toContain('pd port-daddy port-daddy-manifest.json');
    expect(workflow).not.toContain('bin/port-daddy-cli.ts --outfile dist/pd');
  });

  test('release evidence and clean-install workflows use their real path contracts', () => {
    const releaseWorkflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
    const freshInstallWorkflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'fresh-install.yml'), 'utf8');

    // Batten resolves a relative --archive from --staged-dir. Prefixing it with
    // dist would reproduce the v3.28.2 dist/dist/<archive> release failure.
    expect(releaseWorkflow).toContain('--archive "${{ matrix.artifact }}.tar.gz"');
    expect(releaseWorkflow).not.toContain('--archive "dist/${{ matrix.artifact }}.tar.gz"');

    // The release-triggered smoke waits for the tap's exact formula version,
    // refreshes Homebrew only after that boundary, and still installs the fully
    // qualified formula so the caller's explicit trust choice remains visible.
    // https://docs.brew.sh/Tap-Trust#installing-from-a-tap
    const waitForFormula = freshInstallWorkflow.indexOf('Wait for the tap formula to match this release');
    const refreshTap = freshInstallWorkflow.indexOf('brew tap curiositech/tap', waitForFormula);
    const qualifiedInstall = freshInstallWorkflow.indexOf('brew install curiositech/tap/port-daddy', refreshTap);
    expect(waitForFormula).toBeGreaterThan(-1);
    expect(refreshTap).toBeGreaterThan(waitForFormula);
    expect(qualifiedInstall).toBeGreaterThan(refreshTap);
    expect(freshInstallWorkflow).not.toContain('brew install port-daddy');
  });

  test('FleetBar packages the same Port Daddy payload with embedded Rust core proof', () => {
    const localPackager = readFileSync(join(process.cwd(), 'scripts', 'package-fleetbar.sh'), 'utf8');
    const previewPackager = readFileSync(join(process.cwd(), 'scripts', 'package-fleetbar-preview.sh'), 'utf8');
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    for (const script of [localPackager, previewPackager]) {
      expect(script).toContain('Contents/Resources/PortDaddy');
      expect(script).toContain('scripts/build-single-binary.mjs');
      expect(script).toContain('--outfile="$payload_dir/pd"');
      expect(script).toContain('port-daddy-manifest.json');
      expect(script).toContain('manifest.embeddedNativeCore?.status !== "embedded"');
      expect(script).toContain('manifest.smoke?.daemon?.arbiter?.enforcerLoaded !== true');
      expect(script).toContain('bundledPortDaddy');
      expect(script).toContain('signature: manifest.signature ?? null');
    }

    expect(localPackager).toContain('OUT_DIR_INPUT=');
    expect(localPackager).toContain('OUT_DIR="$ROOT_DIR/$OUT_DIR_INPUT"');
    expect(previewPackager).toContain('PORT_DADDY_ENTITLEMENTS="$REPO_ROOT/scripts/entitlements/port-daddy.plist"');
    expect(localPackager).toContain('find_nested_macho_files()');
    expect(localPackager).toContain('sign_nested_macho_files "$APP_BUNDLE"');
    expect(localPackager).toContain('codesign_macho "$nested"');
    expect(localPackager).toContain('codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"');
    expect(localPackager).toContain('submit_notarization "$APP_BUNDLE"');
    expect(localPackager).toContain('print_notary_log "$NOTARY_REQUEST_ID"');
    expect(previewPackager).toContain('Signing bundled Port Daddy payload with Developer ID');
    expect(previewPackager).toContain('--entitlements "$PORT_DADDY_ENTITLEMENTS" --sign "$SIGNING_IDENTITY" "$PORT_DADDY_PAYLOAD_DIR/port-daddy"');
    expect(previewPackager).toContain('Signing bundled Port Daddy payload with ad-hoc identity.');
    expect(previewPackager).toContain('--entitlements "$PORT_DADDY_ENTITLEMENTS" --sign - "$PORT_DADDY_PAYLOAD_DIR/port-daddy"');
    expect(previewPackager).toContain('refresh_port_daddy_payload_manifest');
    expect(previewPackager).toContain('manifest.sha256 = sha256(binaryPath)');
    expect(previewPackager).toContain('manifest.launcherSha256 = sha256(launcherPath)');
    expect(previewPackager).toContain('refresh_port_daddy_payload_manifest "$PORT_DADDY_PAYLOAD_DIR" "developer-id"');
    expect(previewPackager).toContain('refresh_port_daddy_payload_manifest "$PORT_DADDY_PAYLOAD_DIR" "ad-hoc"');
    expect(workflow).toContain('scripts/package-fleetbar.sh dist/fleetbar');
    expect(workflow).toContain('dist/fleetbar/PortDaddy-FleetBar-macOS-*.zip');
    expect(workflow).not.toContain('PortDaddy-FleetBar-macOS-*-dev.zip');
  });
});
