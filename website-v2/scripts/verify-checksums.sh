#!/bin/bash
find public -name '*.json' -exec shasum -a 256 {} + | grep -v 'CHECKSUM:' | while read hash file; do
  checksum=$(grep 'CHECKSUM:' $file | cut -d' ' -f2)
  [ "$hash" = "$checksum" ] || { echo "Checksum mismatch in $file"; exit 1; }
done