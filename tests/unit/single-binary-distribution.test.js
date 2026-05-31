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
    expect(bundle).toContain("await import('../server.js')");
    expect(bundle).toContain('PORT_DADDY_SUPPRESS_CLI_MAIN');
    expect(bundle).toContain("await import('./port-daddy-cli.ts')");
    expect(bundle).toContain('port-daddy-cli.js is the npm shim');
    expect(bundle).toContain('await cli.main()');
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
    expect(buildScript).toContain('target: target || null');
    expect(buildScript).toContain('/arbiter/status');
    expect(buildScript).toContain('embedded native Arbiter enforcer was not loaded cleanly');
    expect(buildScript).toContain('isolated-bin');
    expect(buildScript).toContain('copyFileSync(outfile, isolatedOutfile)');
  });

  test('release workflow uses the single-binary builder instead of compiling the CLI shim directly', () => {
    const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

    expect(workflow).toContain('node scripts/build-single-binary.mjs --target=${{ matrix.target }} --outfile=dist/pd');
    expect(workflow).toContain('pd port-daddy-manifest.json');
    expect(workflow).not.toContain('bin/port-daddy-cli.ts --outfile dist/pd');
  });
});
