#!/usr/bin/env bash
# fetch-pinned-tool.sh URL DEST KIND
#
# Download one pinned CI tool (a GitHub release asset) to DEST and prove it is
# the real file before any job step uses it. KIND says how to check it:
#
#   jar   a Java archive: must open as a zip and contain at least one .class
#   tgz   a gzip tarball: must list cleanly with `tar -tzf`
#   elf   a Linux executable: must start with the ELF magic bytes
#
# If DEST already holds a file that passes the check (an actions/cache hit),
# nothing is downloaded. That is the main defence: with the cache warm, a run
# never touches the release CDN at all.
#
# Why this exists. Every pinned tool used to be fetched with
# `curl -sSL --retry 5 --retry-delay 3`. Two failure modes followed:
#
#   1. No --fail. When the CDN answered 504 past the retries, curl wrote the
#      HTML error page to DEST and exited 0. The TLC step then died with
#      "Could not find or load main class tlc2.TLC", which reads as a proof
#      failure (PR #10363, run 42583672371, job 129048191609).
#   2. A fixed 3 s spacing gives ~15 s of coverage, shorter than the CDN's
#      observed blips; agg's own loop needed 65 s (PR #10192).
#
# So: --fail on every attempt, a widening backoff (5, 10, 20, 40, 60 s; about
# 2 min 15 s in all), the download goes to a temp file that only replaces DEST
# once it passes the check, and the final error says plainly that this is the
# release host failing, not the job's subject.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 URL DEST jar|tgz|elf" >&2
  exit 2
fi
url=$1
dest=$2
kind=$3

check() {
  local f=$1
  [ -s "$f" ] || return 1
  case "$kind" in
    jar) python3 - "$f" <<'PY' || return 1
import sys, zipfile
try:
    with zipfile.ZipFile(sys.argv[1]) as z:
        sys.exit(0 if any(n.endswith('.class') for n in z.namelist()) else 1)
except zipfile.BadZipFile:
    sys.exit(1)
PY
      ;;
    tgz) tar -tzf "$f" >/dev/null 2>&1 || return 1 ;;
    elf) [ "$(head -c 4 "$f" | od -An -c | tr -d ' \n')" = '177ELF' ] || return 1 ;;
    *) echo "fetch-pinned-tool: unknown kind '$kind'" >&2; exit 2 ;;
  esac
}

if check "$dest"; then
  echo "fetch-pinned-tool: $dest is present and valid (cache hit); not downloading."
  exit 0
fi

mkdir -p "$(dirname "$dest")"
tmp="$dest.partial"
attempt=1
for delay in 5 10 20 40 60 0; do
  rm -f "$tmp"
  if curl -fsSL --max-time 600 -o "$tmp" "$url" && check "$tmp"; then
    mv -f "$tmp" "$dest"
    echo "fetch-pinned-tool: downloaded $url (attempt $attempt)."
    exit 0
  fi
  if [ "$delay" -eq 0 ]; then
    break
  fi
  echo "fetch-pinned-tool: attempt $attempt for $url failed or gave an invalid $kind; retrying in ${delay}s."
  sleep "$delay"
  attempt=$((attempt + 1))
done
rm -f "$tmp"
echo "::error::Could not download a valid $kind from $url after $attempt attempts over 135s of backoff. This is the release host failing, NOT a finding of this job."
exit 1
