import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('FleetBar release signing coverage', () => {
  const script = () => readFileSync(join(process.cwd(), 'scripts', 'package-fleetbar.sh'), 'utf8');

  test('discovers and signs every nested Mach-O inside-out instead of hardcoding the payload executables', () => {
    const source = script();

    expect(source).toContain('find_nested_macho_files()');
    expect(source).toContain('sign_nested_macho_files "$APP_BUNDLE"');
    expect(source).toContain('file -b "$candidate"');
    expect(source).toContain('grep -q "Mach-O"');
    expect(source).toContain('sort -t');
    expect(source).toContain('codesign_macho "$nested"');
    expect(source).not.toContain('for nested in "$PORT_DADDY_PAYLOAD_DIR/port-daddy" "$PORT_DADDY_PAYLOAD_DIR/pd"; do');
  });

  test('uses Bun JIT entitlements only for the Bun executable, not ordinary dylibs or the pd launcher', () => {
    const source = script();

    expect(source).toContain('macho_entitlements_for()');
    expect(source).toContain('"$PORT_DADDY_PAYLOAD_DIR/port-daddy")');
    expect(source).toContain('printf \'%s\\n\' "$PAYLOAD_ENTITLEMENTS"');
    expect(source).toContain('"$APP_MACOS/FleetBar")');
    expect(source).toContain('printf \'%s\\n\' "$FLEETBAR_ENTITLEMENTS"');
    expect(source).toContain('codesign_macho()');
    expect(source).toContain('if [[ -n "$entitlements" ]]; then');
    expect(source).not.toContain('--entitlements "$PAYLOAD_ENTITLEMENTS" \\\n      --sign "$IDENTITY" "${KEYCHAIN_ARGS[@]}" "$nested"');
  });

  test('deep strict verifies the complete app and prints the notary log on rejection', () => {
    const source = script();

    expect(source).toContain('codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"');
    expect(source).toContain('submit_notarization()');
    expect(source).toContain('--output-format json');
    expect(source).toContain('print_notary_log "$NOTARY_REQUEST_ID"');
    expect(source).toContain('xcrun notarytool log "$request_id"');
  });
});
