#!/usr/bin/env bash
# Build a signed, notarized macOS .pkg for Port Daddy.
#
# Scaffolding — the binary-production steps (bundling Node runtime, signing the
# Rust bosun binary, embedding FleetBar.app) are stubbed until we decide on
# runtime packaging (pkg install deps, SEA single-binary, or Bun compile).
#
# Usage:
#   ./packaging/build-pkg.sh --unsigned                       # layout only
#   ./packaging/build-pkg.sh --sign "Developer ID Application: NAME (TEAMID)" \
#                            --pkg-sign "Developer ID Installer: NAME (TEAMID)" \
#                            --notarize-profile portdaddy-notary
set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
DIST="$REPO_ROOT/dist/pkg"
STAGE="$DIST/stage"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"

APP_SIGN_ID=""
PKG_SIGN_ID=""
NOTARY_PROFILE=""
UNSIGNED=0
SKIP_FLEETBAR=0
BOSUN_ENABLED=0   # flip to 1 when core/pd-bosun/ ships

while [[ $# -gt 0 ]]; do
    case "$1" in
        --unsigned) UNSIGNED=1; shift;;
        --sign) APP_SIGN_ID="$2"; shift 2;;
        --pkg-sign) PKG_SIGN_ID="$2"; shift 2;;
        --notarize-profile) NOTARY_PROFILE="$2"; shift 2;;
        --skip-fleetbar) SKIP_FLEETBAR=1; shift;;
        --with-bosun) BOSUN_ENABLED=1; shift;;
        *) echo "unknown arg: $1" >&2; exit 2;;
    esac
done

echo "==> Port Daddy pkg build v$VERSION"
rm -rf "$DIST"
mkdir -p "$STAGE/core/root/usr/local/bin"
mkdir -p "$STAGE/core/root/usr/local/libexec/portdaddy"
mkdir -p "$STAGE/core/scripts"
mkdir -p "$STAGE/fleetbar/root/Applications"

# ---------------------------------------------------------------------------
# 1. Build artifacts
# ---------------------------------------------------------------------------
echo "==> Building TypeScript (npm run build)"
(cd "$REPO_ROOT" && npm run build --if-present)

# TODO: bundle Node runtime (see packaging/README.md). For now the pkg assumes
# the target machine has /usr/local/bin/node or similar. This will be replaced
# with either SEA (Node Single Executable Application) or a bundled Node.
cp "$REPO_ROOT/bin/port-daddy-cli.js" "$STAGE/core/root/usr/local/bin/pd"
chmod +x "$STAGE/core/root/usr/local/bin/pd"

# Daemon entry point — stub until we decide the runtime packaging.
cat > "$STAGE/core/root/usr/local/libexec/portdaddy/daemon" <<'EOF'
#!/usr/bin/env bash
# Port Daddy daemon launcher (installed via pkg).
# TODO: point at bundled node + server.js once runtime packaging decided.
exec /usr/local/bin/node /usr/local/libexec/portdaddy/server.js "$@"
EOF
chmod +x "$STAGE/core/root/usr/local/libexec/portdaddy/daemon"

if [[ $BOSUN_ENABLED -eq 1 ]]; then
    echo "==> Bundling Bosun watchdog (core/pd-bosun)"
    # TODO: cargo build --release -p pd-bosun, copy binary
    # cp "$REPO_ROOT/dist/core/pd-bosun" "$STAGE/core/root/usr/local/libexec/portdaddy/bosun"
    echo "    (stub — awaiting V4 Bosun per ADR-0021)"
fi

# ---------------------------------------------------------------------------
# 2. Postinstall — installs LaunchAgents per-user
# ---------------------------------------------------------------------------
cat > "$STAGE/core/scripts/postinstall" <<POSTINSTALL
#!/usr/bin/env bash
set -e
# \$USER is the installing user when pkg runs as target=currentUserHome.
USER_HOME="\$(eval echo ~\$USER)"
mkdir -p "\$USER_HOME/Library/LaunchAgents"
mkdir -p "\$USER_HOME/Library/Logs/PortDaddy"

DAEMON_PLIST="\$USER_HOME/Library/LaunchAgents/com.portdaddy.daemon.plist"
sed "s|@HOME@|\$USER_HOME|g" /usr/local/libexec/portdaddy/templates/com.portdaddy.daemon.plist > "\$DAEMON_PLIST"
chown "\$USER":staff "\$DAEMON_PLIST"
launchctl unload "\$DAEMON_PLIST" 2>/dev/null || true
launchctl load "\$DAEMON_PLIST"

if [[ -x /usr/local/libexec/portdaddy/bosun ]]; then
    BOSUN_PLIST="\$USER_HOME/Library/LaunchAgents/com.portdaddy.bosun.plist"
    sed "s|@HOME@|\$USER_HOME|g" /usr/local/libexec/portdaddy/templates/com.portdaddy.bosun.plist > "\$BOSUN_PLIST"
    chown "\$USER":staff "\$BOSUN_PLIST"
    launchctl unload "\$BOSUN_PLIST" 2>/dev/null || true
    launchctl load "\$BOSUN_PLIST"
fi

echo "Port Daddy installed. Run 'pd mcp install' to wire up MCP clients."
POSTINSTALL
chmod +x "$STAGE/core/scripts/postinstall"

mkdir -p "$STAGE/core/root/usr/local/libexec/portdaddy/templates"
cp "$SCRIPT_DIR/templates/"*.plist "$STAGE/core/root/usr/local/libexec/portdaddy/templates/"

# ---------------------------------------------------------------------------
# 3. FleetBar component pkg
# ---------------------------------------------------------------------------
if [[ $SKIP_FLEETBAR -eq 0 ]]; then
    FLEETBAR_APP="$REPO_ROOT/apps/FleetBar/build/Release/FleetBar.app"
    if [[ -d "$FLEETBAR_APP" ]]; then
        cp -R "$FLEETBAR_APP" "$STAGE/fleetbar/root/Applications/"
    else
        echo "!! FleetBar.app not built at $FLEETBAR_APP — skipping (use --skip-fleetbar to silence)"
        SKIP_FLEETBAR=1
    fi
fi

# ---------------------------------------------------------------------------
# 4. Sign binaries (hardened runtime) before pkg packaging
# ---------------------------------------------------------------------------
if [[ $UNSIGNED -eq 0 && -n "$APP_SIGN_ID" ]]; then
    echo "==> Signing binaries with: $APP_SIGN_ID"
    ENTITLEMENTS="$SCRIPT_DIR/entitlements.plist"
    find "$STAGE/core/root/usr/local/libexec/portdaddy" -type f -perm +111 -print0 | while IFS= read -r -d '' bin; do
        codesign --force --options runtime --entitlements "$ENTITLEMENTS" --sign "$APP_SIGN_ID" "$bin"
    done
    codesign --force --options runtime --entitlements "$ENTITLEMENTS" --sign "$APP_SIGN_ID" "$STAGE/core/root/usr/local/bin/pd"
    if [[ $SKIP_FLEETBAR -eq 0 ]]; then
        codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$APP_SIGN_ID" "$STAGE/fleetbar/root/Applications/FleetBar.app"
    fi
fi

# ---------------------------------------------------------------------------
# 5. Build component pkgs
# ---------------------------------------------------------------------------
echo "==> Building component pkgs"
pkgbuild --identifier com.portdaddy.core --version "$VERSION" \
    --install-location "/" --root "$STAGE/core/root" --scripts "$STAGE/core/scripts" \
    "$DIST/core.pkg"

if [[ $SKIP_FLEETBAR -eq 0 ]]; then
    pkgbuild --identifier com.portdaddy.fleetbar --version "$VERSION" \
        --install-location "/" --root "$STAGE/fleetbar/root" \
        "$DIST/fleetbar.pkg"
fi

# ---------------------------------------------------------------------------
# 6. Build distribution pkg (the shippable artifact)
# ---------------------------------------------------------------------------
DIST_XML="$STAGE/distribution.xml"
sed "s|@VERSION@|$VERSION|g" "$SCRIPT_DIR/distribution.xml" > "$DIST_XML"
PKG_OUT="$DIST/PortDaddy-$VERSION.pkg"

if [[ $UNSIGNED -eq 0 && -n "$PKG_SIGN_ID" ]]; then
    productbuild --distribution "$DIST_XML" --package-path "$DIST" \
        --sign "$PKG_SIGN_ID" "$PKG_OUT"
else
    productbuild --distribution "$DIST_XML" --package-path "$DIST" "$PKG_OUT"
fi

echo "==> Built: $PKG_OUT"

# ---------------------------------------------------------------------------
# 7. Notarize + staple
# ---------------------------------------------------------------------------
if [[ $UNSIGNED -eq 0 && -n "$NOTARY_PROFILE" ]]; then
    echo "==> Submitting to notarytool"
    xcrun notarytool submit "$PKG_OUT" --keychain-profile "$NOTARY_PROFILE" --wait
    xcrun stapler staple "$PKG_OUT"
    echo "==> Notarized + stapled: $PKG_OUT"
fi

echo "==> Done."
