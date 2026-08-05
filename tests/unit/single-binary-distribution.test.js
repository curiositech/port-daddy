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

    expect(bundle).toContain("process.env.PORT_DADDY_CAN_SELF_DAEMON = '1'");
    expect(bundle).toContain('embedded-native-core.generated.js');
    expect(bundle).toContain("await import('koffi')");
    expect(bundle).toContain('__PORT_DADDY_KOFFI_LOAD_ERROR__');
    expect(bundle).toContain("process.argv[2] === '__daemon'");
    expect(bundle).toContain("process.argv[2] === 'start' && process.argv.includes('--foreground')");
    expect(bundle).toContain("process.argv[2] === '__db_integrity_check'");
    expect(bundle).toContain('createAuthorizedDbIntegrityHelperProof()');
    expect(bundle).toContain("await import('../server.js')");
    expect(bundle).toContain('PORT_DADDY_SUPPRESS_CLI_MAIN');
    expect(bundle).toContain("await import('./port-daddy-cli.ts')");
    expect(bundle).toContain('port-daddy-cli.js is the npm shim');
    expect(bundle).toContain('await cli.main()');
  });

  test('server publishes its PID and heartbeat before opening the registry', () => {
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const leaseWrite = server.indexOf('const daemonHeartbeat = createDaemonHeartbeat({');
    const databaseOpen = server.indexOf('const db: DatabaseInstance = initDatabase({');
    const listener = server.indexOf('sockServer.listen(SOCK_PATH');

    expect(leaseWrite).toBeGreaterThan(0);
    expect(leaseWrite).toBeLessThan(databaseOpen);
    expect(server.indexOf('daemonHeartbeat.start();')).toBeLessThan(databaseOpen);
    expect(server.indexOf('await createDbIntegrityProofOutOfProcess(DB_PATH)')).toBeLessThan(databaseOpen);
    expect(server.indexOf('daemonHeartbeat.startProbing();')).toBeGreaterThan(listener);
  });

  test('daemon-only builds prove the hidden integrity helper before ordinary boot', () => {
    const server = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    const helperBoundary = server.indexOf('const dbIntegrityHelperProof = createAuthorizedDbIntegrityHelperProof();');
    const ordinaryBoot = server.indexOf('const STARTED_AT: number = Date.now();');
    const builder = readFileSync(join(process.cwd(), 'scripts', 'build-daemon-binary.mjs'), 'utf8');

    expect(helperBoundary).toBeGreaterThan(0);
    expect(helperBoundary).toBeLessThan(ordinaryBoot);
    expect(server.slice(helperBoundary, ordinaryBoot)).toContain('process.exit(0)');
    expect(builder).toContain('const integrityHelperSmoke = smokeDbIntegrityHelper();');
    expect(builder.indexOf('const integrityHelperSmoke = smokeDbIntegrityHelper();'))
      .toBeLessThan(builder.indexOf("if (!args.has('--no-smoke'))"));
    expect(builder).toContain("join(homedir(), 'coding', 'tmp')");
    expect(builder).not.toContain('tmpdir');
    expect(builder).toContain('integrityHelperSmoke,');
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
    expect(buildScript).toContain('packageOnnxRuntimeNative(target, releaseDir)');
    expect(buildScript).toContain("join(releaseDir, 'native', 'onnxruntime-node'");
    expect(buildScript).not.toContain("join(DIST_DIR, 'native', 'onnxruntime-node'");
    expect(buildScript).toContain('smokeSelfHostedDaemon');
    expect(buildScript).toContain('writePdLauncher');
    expect(buildScript).toContain('launcherSource');
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
    expect(buildScript).toContain('complete Squid, public-skill, and Pilot resources staged beside every binary payload');
    expect(buildScript).toContain("path: join('skills', 'port-daddy-agent-skill')");
    expect(buildScript).toContain("path: join('agents', 'port-daddy-pilot')");
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
    expect(workflow).toContain('node scripts/package-release-artifacts.mjs');
    expect(workflow).toContain('--manifest release-artifacts.json');
    expect(workflow).not.toContain('tar -czf');
    expect(workflow).not.toContain('bin/port-daddy-cli.ts --outfile dist/pd');
  });

  test('release workflow freezes one reviewed source and ships one canonical runtime layout', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow.match(/ref: \$\{\{ needs\.guide-review-gate\.outputs\.candidate_sha \}\}/g)).toHaveLength(5);
    expect(workflow).toContain('--source-commit ${{ needs.guide-review-gate.outputs.candidate_sha }}');
    expect(workflow).toContain('--release-version ${{ needs.guide-review-gate.outputs.tag }}');
    expect(workflow).toContain('--archive dist/${{ matrix.artifact }}.tar.gz');
    expect(workflow).not.toContain('SOAK_PORT:');
    expect(workflow).not.toContain('cp "bin/$f" "dist/$f"');
    expect(workflow).not.toContain('Stage squid harness assets');
    expect(workflow).not.toContain('cp hooks/sessionstart-pilot.mjs');
    expect(workflow).not.toMatch(/npm run|publish-npm|publish\.yml/);
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
