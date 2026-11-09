#!/usr/bin/env python3
"""Build, verify and safely extract the complete public Book source archive.

Only the canonical book/ tree and an explicit set of build helpers are bundled.
The archive is an immutable derivative; SOURCE-MANIFEST.json records each input.
No Git, npm dependencies, credentials or private fonts are needed to build it.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
NAME = "coordination-papers-mega-volume-source.tar.gz"
PREFIX = "port-daddy-book-source"
EPOCH = 1700000000
TEXLIVE = "texlive/texlive@sha256:ee8ecc627897eabeb42d862d8187546483455e66ce94aa5c2bce1b45a977ab27"
RECEIPT = Path("website-v2/public/whitepaper/coordination-papers-mega-volume-source.json")
HELPERS = ("LICENSE", "scripts/build-whitepapers.sh", "scripts/generate-mega-whitepaper.mjs",
           "scripts/generate-book-glossary.mjs", "scripts/lint/check-welds.mjs",
           "scripts/harbor-research/render_status_tables.py",
           "scripts/prepare-book-fonts.py", "scripts/build-book-source.py")
REQUIRED = ("book/BUILDING.md", "book/BUILDING.sh", "book/textbook.json", "book/corpus.json",
            "book/coordination-papers-mega-volume.tex", "book/fonts/manifest.json")
EXTENSIONS = {".tex", ".json", ".md", ".jpg", ".jpeg", ".png", ".pdf", ".svg",
              ".otf", ".ttf", ".csv", ".py", ".sh", ".txt", ".html", ".sty", ".cls", ".bib",
              ".yaml"}
BUILD = {"texliveImage": TEXLIVE, "nodeMajor": 22, "pythonMinimum": "3.10",
         "sourceDateEpoch": EPOCH, "defaultFontProfile": "open-proof",
         "entrypoint": "book/BUILDING.sh",
         "publicationFonts": "Exact published Suisse typography requires separately licensed private Suisse fonts; they are not included."}
# The receipt pins exact gzip bytes, and only stock zlib's deflate reproduces
# them. zlib-ng (including zlib-compat builds reporting "1.3.1.zlib-ng") writes
# valid but different streams, so its receipt fails CI's rebuild as stale. A
# version string cannot prove equivalence; this is the SHA-256 of
# canary_output() under stock zlib 1.3, 1.3.1 and 1.3.2.
STOCK_CANARY_SHA256 = "7fac0ff0817a42d563b902ba13a8ef9a2adbcfb32729fadd8503c7c940080aa4"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode()


def safe_name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or "\\" in name or str(path) != name:
        raise ValueError(f"Unsafe source path: {name!r}")
    return name


def read_source(root: Path, name: str) -> bytes:
    safe_name(name)
    path = root / name
    # Reject links at every level, not just a linked file's final component.
    current = path
    while current != root:
        if current.is_symlink():
            raise ValueError(f"Source symlink is not allowed: {name}")
        current = current.parent
    if not path.is_file():
        raise ValueError(f"Missing source: {name}")
    data = path.read_bytes()
    if data.startswith(b"version https://git-lfs.github.com/spec/v1"):
        raise ValueError(f"Unhydrated Git LFS pointer: {name}")
    if re.search(r"(?i)suisse.*\.(otf|ttf|woff2?)$", name):
        raise ValueError(f"Private Suisse font must not be packaged: {name}")
    return data


def source_files(root: Path) -> tuple[list[dict], dict[str, bytes]]:
    names = set(HELPERS)
    for name in REQUIRED:
        read_source(root, name)
    for path in (root / "book").rglob("*"):
        if path.is_dir() and not path.is_symlink():
            continue
        name = path.relative_to(root).as_posix()
        if path.name == ".gitignore":
            continue
        # answers.sty emits these streams while compiling the authored chapter
        # exercises. A stale copy beside the root can shadow the new stream in
        # the build directory and silently publish obsolete solutions.
        if path.match("book-sol-*.tex") or path.match("sol-*.tex"):
            raise ValueError(
                f"Generated solution stream in canonical source directory: {name}; "
                "keep solution bodies in the chapter manuscripts and build outputs in .cache"
            )
        if path.suffix not in EXTENSIONS and not path.name.startswith("LICENSE"):
            raise ValueError(f"Unexpected file in canonical source directory: {name}")
        names.add(name)
    data = {name: read_source(root, name) for name in sorted(names)}
    font_manifest = json.loads(data["book/fonts/manifest.json"])
    licensed = {"book/" + row["path"]: row["sha256"] for row in font_manifest["files"]}
    for name, content in data.items():
        if Path(name).suffix.lower() in {".otf", ".ttf"}:
            if licensed.get(name) != digest(content):
                raise ValueError(f"Font missing from licensed, hash-pinned manifest: {name}")
    for name, sha in licensed.items():
        if name not in data or digest(data[name]) != sha:
            raise ValueError(f"Missing or changed licensed font input: {name}")
    registry = json.loads(data["book/textbook.json"])
    for chapter in registry["chapters"]:
        name = safe_name(chapter["source"])
        if not name.startswith("book/") or name not in data:
            raise ValueError(f"Chapter is not contained in the canonical source tree: {name}")
    files = [{"path": name, "sha256": digest(content), "bytes": len(content),
              "mode": 0o755 if name.endswith(".sh") else 0o644}
             for name, content in data.items()]
    return files, data


def source_manifest(files: list[dict]) -> dict:
    return {"schemaVersion": 1, "sourceSha256": digest(encoded(files)),
            "build": BUILD, "files": files}


def gzip_writer(output) -> gzip.GzipFile:
    # The archive's only compressor configuration; the deflate canary uses it too.
    return gzip.GzipFile(filename="", fileobj=output, mode="wb", compresslevel=9, mtime=0)


def canary_payload() -> bytes:
    """Tar-like input: 48 NUL-padded 512-byte headers, each before LCG-drawn words."""
    words = b"the agent harbor claim of a lease port daddy book source receipt proof and to is".split()
    state, out = 20261109, bytearray()
    for record in range(48):
        header = b"port-daddy-book-source/book/canary-%02d.tex" % record
        out += header + bytes(512 - len(header))
        for _ in range(96):
            state = (state * 1103515245 + 12345) % 2**31
            out += words[(state >> 16) % 16] + (b"\n" if state % 8 == 0 else b" ")
    return bytes(out)


def canary_output() -> bytes:
    output = io.BytesIO()
    with gzip_writer(output) as stream:
        stream.write(canary_payload())
    return output.getvalue()


def zlib_build() -> str:
    build = f"zlib {zlib.ZLIB_RUNTIME_VERSION} (compiled against {zlib.ZLIB_VERSION})"
    native_ng = getattr(zlib, "ZLIBNG_VERSION", None)
    return build + (f", zlib-ng {native_ng}" if native_ng else "")


def deflate_mismatch() -> str | None:
    """Name the running interpreter and zlib when its deflate is not stock zlib's."""
    if digest(canary_output()) == STOCK_CANARY_SHA256:
        return None
    return f"{sys.executable} uses {zlib_build()}, whose deflate output differs from stock zlib's"


def stock_zlib_fix(command: str) -> str:
    return ("Use a Python linked against stock zlib, such as uv's managed CPython: "
            "`uv python install 3.12`, then "
            f"`\"$(uv python find --python-preference only-managed 3.12)\" scripts/build-book-source.py {command}`. "
            "On macOS, a python.org or uv build also works.")


def require_stock_deflate():
    problem = deflate_mismatch()
    if problem:
        raise ValueError(f"Refusing to write the source archive or receipt: {problem}, "
                         "so a receipt built here would fail CI's byte-for-byte rebuild as stale. "
                         f"{stock_zlib_fix('build')}")


def stale_hint(actual: dict, expected: dict) -> str:
    problem = deflate_mismatch()
    if problem:
        return (f". This check cannot reproduce stock archive bytes, so the receipt may be current: "
                f"{problem}. {stock_zlib_fix('check')}")
    if isinstance(actual, dict) and actual.get("source") == expected["source"]:
        return (". Every source hash matches but the archive bytes differ, so the receipt was "
                f"probably built with a non-stock zlib such as zlib-ng. {stock_zlib_fix('build')}")
    return ""


def make_archive(files: list[dict], data: dict[str, bytes]) -> tuple[bytes, bytes]:
    manifest = encoded(source_manifest(files))
    contents = dict(data)
    contents["SOURCE-MANIFEST.json"] = manifest
    contents["README.md"] = data["book/BUILDING.md"]
    output = io.BytesIO()
    with gzip_writer(output) as gz:
        with tarfile.open(fileobj=gz, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, content in sorted(contents.items()):
                info = tarfile.TarInfo(f"{PREFIX}/{safe_name(name)}")
                info.size = len(content)
                info.mtime = EPOCH
                info.mode = 0o755 if name.endswith(".sh") else 0o644
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                archive.addfile(info, io.BytesIO(content))
    return output.getvalue(), manifest


def receipt_for(files: list[dict], archive: bytes, manifest: bytes) -> dict:
    sha = digest(archive)
    key = f"book/source/sha256/{sha}.tar.gz"
    return {"schemaVersion": 1,
            "archive": {"file": NAME, "sha256": sha, "bytes": len(archive),
                        "contentType": "application/gzip", "key": key,
                        "url": "https://media.portdaddy.dev/" + key},
            "source": {"sha256": digest(encoded(files)), "fileCount": len(files), "files": files},
            "manifestSha256": digest(manifest), "build": BUILD}


def atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".book-source-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def redirect_block(receipt: dict) -> str:
    target = receipt["archive"]["url"]
    return ("# BEGIN BOOK SOURCE DOWNLOAD\n"
            f"/whitepaper/{NAME}  {target}  302\n"
            f"/whitepaper/coordination-papers-mega-volume.tex  {target}  302\n"
            "# END BOOK SOURCE DOWNLOAD\n")


def redirects_with_block(text: str, block: str) -> str:
    start = "# BEGIN BOOK SOURCE DOWNLOAD"
    end = "# END BOOK SOURCE DOWNLOAD"
    if start in text or end in text:
        if text.count(start) != 1 or text.count(end) != 1:
            raise ValueError("Malformed Book source redirect markers")
        pattern = re.compile(re.escape(start) + r"\n.*?" + re.escape(end) + r"\n?", re.S)
        changed, count = pattern.subn(lambda _: block, text)
        if count != 1:
            raise ValueError("Malformed Book source redirect block")
        return changed
    # Specific download rules precede the SPA catchall and all broad matches.
    return block + "\n" + text


def build(root: Path, output: Path, receipt_path: Path, r2_manifest: Path | None = None):
    # Fail closed before anything is written; check() runs the canary only to
    # explain a mismatch, so a website build is not gated on its interpreter.
    require_stock_deflate()
    files, data = source_files(root)
    archive, manifest = make_archive(files, data)
    receipt = receipt_for(files, archive, manifest)
    redirect_path = root / "website-v2/public/_redirects"
    redirects = redirects_with_block(redirect_path.read_text() if redirect_path.exists() else "", redirect_block(receipt))
    atomic_write(output, archive)
    atomic_write(receipt_path, encoded(receipt))
    atomic_write(redirect_path, redirects.encode())
    if r2_manifest:
        atomic_write(r2_manifest, encoded({"version": 1,
            "cacheControl": "public, max-age=31536000, immutable",
            "assets": [{"path": output.relative_to(root).as_posix(), **{
                key: receipt["archive"][key] for key in ("key", "sha256", "bytes", "contentType")}}]}))
    return receipt


def check(root: Path, receipt_path: Path):
    files, data = source_files(root)
    # Regenerate exact bytes as well as input hashes: recipes/compressor output
    # cannot silently drift while keeping a source-only receipt looking fresh.
    archive, manifest = make_archive(files, data)
    expected = receipt_for(files, archive, manifest)
    actual = json.loads(receipt_path.read_bytes())
    if actual != expected:
        raise ValueError("Book source archive receipt is stale; rebuild and publish the source archive"
                         + stale_hint(actual, expected))
    redirects = (root / "website-v2/public/_redirects").read_text()
    if redirects_with_block(redirects, redirect_block(expected)) != redirects:
        raise ValueError("Book source download redirects are missing or stale")
    return actual


def verify_extracted(root: Path):
    manifest = json.loads(read_source(root, "SOURCE-MANIFEST.json"))
    if manifest.get("schemaVersion") != 1 or manifest.get("build") != BUILD:
        raise ValueError("Unsupported source manifest or build recipe")
    files = manifest["files"]
    if digest(encoded(files)) != manifest["sourceSha256"]:
        raise ValueError("Source manifest file inventory digest differs")
    seen = set()
    for row in files:
        name = safe_name(row["path"])
        if name in seen:
            raise ValueError(f"Duplicate manifest entry: {name}")
        seen.add(name)
        data = read_source(root, name)
        if len(data) != row["bytes"] or digest(data) != row["sha256"]:
            raise ValueError(f"Source integrity mismatch: {name}")
    if not set(REQUIRED + HELPERS).issubset(seen):
        raise ValueError("Source manifest omits required build inputs")
    actual_files, _ = source_files(root)
    if actual_files != files:
        raise ValueError("Source inventory contains unlisted or changed build inputs")
    if read_source(root, "README.md") != read_source(root, "book/BUILDING.md"):
        raise ValueError("Top-level README differs from the verified build instructions")
    return manifest


def extract(archive_path: Path, destination: Path) -> Path:
    # Require an unused destination: never merge an untrusted archive into a
    # checkout or follow pre-existing links while extracting it.
    if destination.exists():
        raise ValueError(f"Extraction destination already exists: {destination}")
    with tarfile.open(archive_path, "r:gz") as archive:
        members = archive.getmembers()
        seen = set()
        total = 0
        for member in members:
            name = safe_name(member.name)
            if not name.startswith(PREFIX + "/") or not member.isfile() or name in seen:
                raise ValueError(f"Invalid archive member: {name}")
            seen.add(name)
            total += member.size
            if len(seen) > 10000 or total > 250 * 1024 * 1024:
                raise ValueError("Source archive exceeds extraction bounds")
        destination.mkdir(parents=True)
        for member in members:
            path = destination / member.name
            path.parent.mkdir(parents=True, exist_ok=True)
            stream = archive.extractfile(member)
            if stream is None:
                raise ValueError(f"Cannot read archive member: {member.name}")
            path.write_bytes(stream.read())
            path.chmod(0o755 if member.name.endswith(".sh") else 0o644)
    root = destination / PREFIX
    verify_extracted(root)
    return root


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "check", "verify", "extract"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--r2-manifest", type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--destination", type=Path)
    args = parser.parse_args(argv)
    root = args.root.resolve()
    try:
        if args.command == "verify":
            result = verify_extracted(root)
            print(f"Verified {len(result['files'])} source files; {result['sourceSha256']}")
        elif args.command == "extract":
            if not args.archive or not args.destination:
                parser.error("extract requires --archive and --destination")
            print(extract(args.archive, args.destination))
        else:
            receipt_path = args.receipt or root / RECEIPT
            if args.command == "build":
                result = build(root, args.output or root / ".cache/book-source" / NAME,
                               receipt_path, args.r2_manifest)
            else:
                result = check(root, receipt_path)
            print(f"Book source: {result['source']['fileCount']} files, {result['archive']['bytes']} bytes, SHA256 {result['archive']['sha256']}")
    except (ValueError, OSError, KeyError, tarfile.TarError) as error:
        parser.exit(1, f"Book source: {error}\n")


if __name__ == "__main__":
    main()
