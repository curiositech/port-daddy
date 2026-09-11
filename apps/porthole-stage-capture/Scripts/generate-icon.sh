#!/bin/zsh
set -euo pipefail

script_dir=${0:A:h}
package_root=${script_dir:h}
output_path=${1:-"$package_root/.build/PortholeIcon.icns"}
detail_svg="$package_root/Packaging/PortholeIcon-detail.svg"
compact_svg="$package_root/Packaging/PortholeIcon-compact.svg"
micro_svg="$package_root/Packaging/PortholeIcon-micro.svg"

for source_svg in "$detail_svg" "$compact_svg" "$micro_svg"; do
    if [[ ! -f "$source_svg" ]]; then
        print -u2 "generate-icon: missing optical source $source_svg"
        exit 2
    fi
done
if ! command -v rsvg-convert >/dev/null 2>&1; then
    print -u2 "generate-icon: rsvg-convert is required"
    exit 3
fi
if ! command -v iconutil >/dev/null 2>&1; then
    print -u2 "generate-icon: iconutil is required"
    exit 4
fi

mkdir -p "$package_root/.build" "${output_path:h}"
work_dir=$(mktemp -d "$package_root/.build/porthole-icon.XXXXXX")
iconset="$work_dir/PortholeIcon.iconset"
mkdir -p "$iconset"
cleanup() {
    if [[ "$work_dir" == "$package_root/.build/porthole-icon."* ]]; then
        rm -rf "$work_dir"
    fi
}
trap cleanup EXIT

render() {
    local source_svg=$1
    local size=$2
    local filename=$3
    rsvg-convert --width "$size" --height "$size" "$source_svg" --output "$iconset/$filename"
}

render "$micro_svg" 16 icon_16x16.png
render "$micro_svg" 32 icon_16x16@2x.png
render "$compact_svg" 32 icon_32x32.png
render "$compact_svg" 64 icon_32x32@2x.png
render "$compact_svg" 128 icon_128x128.png
render "$detail_svg" 256 icon_128x128@2x.png
render "$detail_svg" 256 icon_256x256.png
render "$detail_svg" 512 icon_256x256@2x.png
render "$detail_svg" 512 icon_512x512.png
render "$detail_svg" 1024 icon_512x512@2x.png

iconutil -c icns "$iconset" -o "$output_path"
print "$output_path"
