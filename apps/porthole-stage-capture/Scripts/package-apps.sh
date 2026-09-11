#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
package_root=${script_dir:h}
configuration=debug
skip_build=false
output_root="${package_root}/.build/proof-apps"
signing_identity=${PORTHOLE_SIGNING_IDENTITY:-}
allow_ad_hoc=false

while (( $# > 0 )); do
    case "$1" in
        --configuration)
            configuration="$2"
            shift 2
            ;;
        --output)
            output_root="$2"
            shift 2
            ;;
        --skip-build)
            skip_build=true
            shift
            ;;
        --signing-identity)
            signing_identity="$2"
            shift 2
            ;;
        --allow-ad-hoc)
            allow_ad_hoc=true
            shift
            ;;
        *)
            print -u2 "package-apps: unknown argument: $1"
            exit 2
            ;;
    esac
done

if [[ -z "$signing_identity" ]]; then
    signing_identity=$(security find-identity -v -p codesigning \
        | awk -F'"' '/Developer ID Application: Curiositech LLC \(P5H9P59X2M\)/ { print $2; exit }')
fi
if [[ -z "$signing_identity" ]]; then
    if [[ "$allow_ad_hoc" == true ]]; then
        signing_identity="-"
    else
        print -u2 "package-apps: stable Developer ID signer unavailable; set PORTHOLE_SIGNING_IDENTITY or pass --signing-identity"
        print -u2 "package-apps: --allow-ad-hoc is test-only and must not be used for TCC proof or distribution"
        exit 5
    fi
fi
if [[ "$signing_identity" == "-" && "$allow_ad_hoc" != true ]]; then
    print -u2 "package-apps: ad-hoc signing requires explicit --allow-ad-hoc and is forbidden for TCC proof"
    exit 6
fi

if [[ -e "$output_root/Porthole.app" || -e "$output_root/PortholeFixture.app" ]]; then
    print -u2 "package-apps: output already exists; choose a fresh --output directory"
    exit 3
fi

if [[ "$skip_build" != true ]]; then
    swift build --package-path "$package_root" --configuration "$configuration"
fi

capture_binary="$package_root/.build/$configuration/PortholeStageCapture"
fixture_binary="$package_root/.build/$configuration/PortholeStageFixture"
if [[ ! -x "$capture_binary" || ! -x "$fixture_binary" ]]; then
    print -u2 "package-apps: Swift executables are missing; build the package first"
    exit 4
fi

capture_app="$output_root/Porthole.app"
fixture_app="$output_root/PortholeFixture.app"
mkdir -p "$capture_app/Contents/MacOS" "$capture_app/Contents/Resources" "$fixture_app/Contents/MacOS"
cp "$package_root/Packaging/Porthole-Info.plist" "$capture_app/Contents/Info.plist"
cp "$package_root/Packaging/PortholeFixture-Info.plist" "$fixture_app/Contents/Info.plist"
cp "$capture_binary" "$capture_app/Contents/MacOS/Porthole"
cp "$fixture_binary" "$fixture_app/Contents/MacOS/PortholeFixture"
cp "$package_root/Scripts/porthole-control.py" "$capture_app/Contents/Resources/porthole-control"
chmod 755 "$capture_app/Contents/MacOS/Porthole" "$fixture_app/Contents/MacOS/PortholeFixture"
chmod 755 "$capture_app/Contents/Resources/porthole-control"
"$package_root/Scripts/generate-icon.sh" "$capture_app/Contents/Resources/PortholeIcon.icns"

signing_options=(--force --sign "$signing_identity")
if [[ "$signing_identity" != "-" ]]; then
    signing_options+=(--options runtime --timestamp=none)
fi
codesign "${signing_options[@]}" --identifier dev.portdaddy.porthole.safe-fixture "$fixture_app"
# Bind the actual signed fixture bytes into the capture app's sealed resources.
# Runtime identity does not depend on the apps retaining a sibling folder layout.
fixture_sha256=$(shasum -a 256 "$fixture_app/Contents/MacOS/PortholeFixture" | awk '{print $1}')
printf '{"bundleIdentifier":"dev.portdaddy.porthole.safe-fixture","executableFilename":"PortholeFixture","executableSHA256":"%s","schema":"pd.porthole.safe-fixture-identity.v1"}\n' "$fixture_sha256" > "$capture_app/Contents/Resources/safe-fixture-identity.json"
codesign "${signing_options[@]}" --identifier dev.portdaddy.porthole "$capture_app"
codesign --verify --deep --strict "$capture_app"
codesign --verify --deep --strict "$fixture_app"

print "$capture_app"
print "$fixture_app"
