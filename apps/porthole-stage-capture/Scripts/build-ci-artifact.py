#!/usr/bin/python3
"""Verify Porthole Stage bundles and emit a deterministic CI-only tar.

This script intentionally accepts only the two ad-hoc-signed bundles produced
by ``package-apps.sh --allow-ad-hoc``. It cannot create or bless a production
release. The design gives pull requests an exhaustively verified artifact while
keeping Developer ID, notarization, TCC identity, and operator visual proof in a
separate fail-closed release lane.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import plistlib
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ARCHIVE_ROOT = "porthole-stage-ci"
SOURCE_SHA_RE = re.compile(r"^[0-9a-f]{40,64}$")


class VerificationError(RuntimeError):
    """Represent one fail-closed artifact contract violation."""


@dataclass(frozen=True)
class BundleSpec:
    """Describe one exact bundle shape accepted by the CI artifact lane."""

    name: str
    bundle_identifier: str
    executable: str
    required_files: frozenset[str]
    needs_screen_capture_usage: bool


BUNDLE_SPECS = (
    BundleSpec(
        name="Porthole.app",
        bundle_identifier="dev.portdaddy.porthole",
        executable="Porthole",
        required_files=frozenset(
            {
                "Contents/Info.plist",
                "Contents/MacOS/Porthole",
                "Contents/Resources/PortholeIcon.icns",
                "Contents/_CodeSignature/CodeResources",
            }
        ),
        needs_screen_capture_usage=True,
    ),
    BundleSpec(
        name="PortholeFixture.app",
        bundle_identifier="dev.portdaddy.porthole.safe-fixture",
        executable="PortholeFixture",
        required_files=frozenset(
            {
                "Contents/Info.plist",
                "Contents/MacOS/PortholeFixture",
                "Contents/_CodeSignature/CodeResources",
            }
        ),
        needs_screen_capture_usage=False,
    ),
)


def sha256_bytes(data: bytes) -> str:
    """Hash bytes for the manifest; the design uses one digest everywhere."""

    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    """Hash one regular file without trusting platform-specific shell output."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_checked(argv: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a verifier and retain diagnostics so failures remain actionable."""

    result = subprocess.run(argv, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise VerificationError(f"{' '.join(argv)} failed: {detail}")
    return result


def regular_files(root: Path) -> list[Path]:
    """Enumerate a bundle without following links or accepting special files."""

    files: list[Path] = []
    for current, directories, names in os.walk(root, followlinks=False):
        current_path = Path(current)
        for name in [*directories, *names]:
            candidate = current_path / name
            if candidate.is_symlink():
                raise VerificationError(f"bundle symlink is forbidden: {candidate}")
        for name in names:
            candidate = current_path / name
            mode = candidate.lstat().st_mode
            if not stat.S_ISREG(mode):
                raise VerificationError(f"special bundle file is forbidden: {candidate}")
            files.append(candidate)
    return sorted(files, key=lambda path: path.relative_to(root).as_posix())


def verify_bundle(bundle: Path, spec: BundleSpec) -> dict[str, Any]:
    """Verify identity, signature class, plist policy, Mach-O, and exact files."""

    if not bundle.is_dir() or bundle.is_symlink():
        raise VerificationError(f"missing real app bundle: {bundle}")
    files = regular_files(bundle)
    relative_files = frozenset(path.relative_to(bundle).as_posix() for path in files)
    if relative_files != spec.required_files:
        missing = sorted(spec.required_files - relative_files)
        unexpected = sorted(relative_files - spec.required_files)
        raise VerificationError(
            f"{spec.name} file contract mismatch; missing={missing}, unexpected={unexpected}"
        )

    info_path = bundle / "Contents/Info.plist"
    with info_path.open("rb") as handle:
        info = plistlib.load(handle)
    expected = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": spec.executable,
        "CFBundleIdentifier": spec.bundle_identifier,
        "CFBundleExecutable": spec.executable,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": spec.executable,
        "CFBundlePackageType": "APPL",
        "LSMinimumSystemVersion": "14.0",
        "NSHighResolutionCapable": True,
        "NSPrincipalClass": "NSApplication",
    }
    allowed_keys = {
        *expected.keys(),
        "CFBundleShortVersionString",
        "CFBundleVersion",
    }
    if spec.needs_screen_capture_usage:
        allowed_keys.update({"CFBundleIconFile", "NSScreenCaptureUsageDescription"})
        expected["CFBundleIconFile"] = "PortholeIcon"
    actual_keys = set(info.keys())
    if actual_keys != allowed_keys:
        missing = sorted(allowed_keys - actual_keys)
        unexpected = sorted(actual_keys - allowed_keys)
        raise VerificationError(
            f"{spec.name} plist contract mismatch; missing={missing}, unexpected={unexpected}"
        )
    for key, value in expected.items():
        if info.get(key) != value:
            raise VerificationError(
                f"{spec.name} {key} must be {value!r}, got {info.get(key)!r}"
            )
    version = info.get("CFBundleShortVersionString")
    build = info.get("CFBundleVersion")
    if not isinstance(version, str) or not version:
        raise VerificationError(f"{spec.name} is missing CFBundleShortVersionString")
    if not isinstance(build, str) or not build:
        raise VerificationError(f"{spec.name} is missing CFBundleVersion")

    usage = info.get("NSScreenCaptureUsageDescription")
    if spec.needs_screen_capture_usage:
        if not isinstance(usage, str) or "window or app you choose" not in usage:
            raise VerificationError(
                "Porthole.app must explain exact operator-chosen ScreenCaptureKit scope"
            )
    elif usage is not None:
        raise VerificationError("the synthetic fixture must not request Screen Recording")

    executable = bundle / "Contents/MacOS" / spec.executable
    if not os.access(executable, os.X_OK):
        raise VerificationError(f"bundle executable is not executable: {executable}")
    file_description = run_checked(["file", "-b", str(executable)]).stdout
    if "Mach-O" not in file_description:
        raise VerificationError(f"bundle executable is not Mach-O: {file_description.strip()}")

    run_checked(["codesign", "--verify", "--deep", "--strict", str(bundle)])
    signature = run_checked(["codesign", "-dvvv", str(bundle)]).stderr
    signature_contract = (
        f"Identifier={spec.bundle_identifier}",
        "flags=0x2(adhoc)",
        "Signature=adhoc",
        "TeamIdentifier=not set",
    )
    for needle in signature_contract:
        if needle not in signature:
            raise VerificationError(f"{spec.name} is not the expected CI ad-hoc signature: {needle}")
    if "Authority=" in signature:
        raise VerificationError(f"{spec.name} unexpectedly carries distribution authority")
    entitlements = run_checked(
        ["codesign", "-d", "--entitlements", ":-", str(bundle)]
    ).stdout.strip()
    if entitlements:
        raise VerificationError(f"{spec.name} must carry no CI entitlements")

    return {
        "bundle": spec.name,
        "bundleIdentifier": spec.bundle_identifier,
        "executable": spec.executable,
        "version": version,
        "build": build,
        "signing": "ad-hoc-test-only",
        "files": [
            {
                "path": f"{spec.name}/{path.relative_to(bundle).as_posix()}",
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
                "mode": "0755" if os.access(path, os.X_OK) else "0644",
            }
            for path in files
        ],
    }


def stable_tar_info(name: str, source_date_epoch: int, *, directory: bool) -> tarfile.TarInfo:
    """Create normalized tar metadata so repeated assembly is byte-identical."""

    info = tarfile.TarInfo(name)
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = source_date_epoch
    info.mode = 0o755 if directory else 0o644
    if directory:
        info.type = tarfile.DIRTYPE
        info.size = 0
    return info


def source_entries(input_root: Path) -> Iterable[tuple[str, Path | None, bytes | None, bool]]:
    """Yield normalized archive entries in a later globally sorted sequence."""

    yield ARCHIVE_ROOT, None, None, True
    for spec in BUNDLE_SPECS:
        bundle = input_root / spec.name
        for current, directories, names in os.walk(bundle, followlinks=False):
            current_path = Path(current)
            relative_dir = current_path.relative_to(input_root).as_posix()
            yield f"{ARCHIVE_ROOT}/{relative_dir}", None, None, True
            for name in names:
                source = current_path / name
                archive_name = f"{ARCHIVE_ROOT}/{source.relative_to(input_root).as_posix()}"
                yield archive_name, source, None, False


def add_bytes(
    archive: tarfile.TarFile,
    name: str,
    data: bytes,
    source_date_epoch: int,
) -> None:
    """Add generated metadata with the same stable ownership and clock policy."""

    info = stable_tar_info(name, source_date_epoch, directory=False)
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))


def build_archive(
    input_root: Path,
    output: Path,
    source_sha: str,
    source_date_epoch: int,
) -> dict[str, Any]:
    """Verify both apps, then write one deterministic non-production tar."""

    expected_children = sorted(spec.name for spec in BUNDLE_SPECS)
    actual_children = sorted(path.name for path in input_root.iterdir())
    if actual_children != expected_children:
        raise VerificationError(
            f"package root must contain exactly {expected_children}, got {actual_children}"
        )

    bundles = [verify_bundle(input_root / spec.name, spec) for spec in BUNDLE_SPECS]
    if len({(bundle["version"], bundle["build"]) for bundle in bundles}) != 1:
        raise VerificationError("Porthole and its fixture must share one version and build")
    manifest = {
        "schema": "port-daddy.porthole-stage-ci-artifact.v1",
        "production": False,
        "distributionAllowed": False,
        "sourceSha": source_sha,
        "sourceDateEpoch": source_date_epoch,
        "signing": "ad-hoc-test-only",
        "tccProofEligible": False,
        "bundles": bundles,
    }
    manifest_bytes = (
        json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
    ).encode()
    notice_bytes = (
        "PORTHOLE STAGE CI ARTIFACT - NOT FOR DISTRIBUTION\n"
        "\n"
        "This archive is ad-hoc signed, has no Developer ID or notarization,\n"
        "cannot establish stable TCC identity, and is not visual/privacy proof.\n"
        f"Source: {source_sha}\n"
    ).encode()

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        raise VerificationError(f"output already exists: {output}")
    generated = [
        (f"{ARCHIVE_ROOT}/CI-ONLY-NOT-FOR-DISTRIBUTION.txt", None, notice_bytes, False),
        (f"{ARCHIVE_ROOT}/manifest.json", None, manifest_bytes, False),
    ]
    entries = sorted([*source_entries(input_root), *generated], key=lambda entry: entry[0])
    with tempfile.TemporaryDirectory(prefix=".porthole-ci-build-", dir=output.parent) as temporary:
        candidate = Path(temporary) / output.name
        with tarfile.open(candidate, mode="w", format=tarfile.USTAR_FORMAT) as archive:
            for name, source, generated_bytes, directory in entries:
                if directory:
                    archive.addfile(stable_tar_info(name, source_date_epoch, directory=True))
                elif generated_bytes is not None:
                    add_bytes(archive, name, generated_bytes, source_date_epoch)
                else:
                    assert source is not None
                    data = source.read_bytes()
                    info = stable_tar_info(name, source_date_epoch, directory=False)
                    info.mode = 0o755 if os.access(source, os.X_OK) else 0o644
                    info.size = len(data)
                    archive.addfile(info, io.BytesIO(data))
        verify_archive(candidate, manifest, source_date_epoch)
        os.replace(candidate, output)
    return manifest


def verify_archive(output: Path, manifest: dict[str, Any], source_date_epoch: int) -> None:
    """Read back every tar member, hash payloads, and recheck extracted apps."""

    expected_files = {
        f"{ARCHIVE_ROOT}/{item['path']}": item
        for bundle in manifest["bundles"]
        for item in bundle["files"]
    }
    with tarfile.open(output, mode="r:") as archive:
        members = archive.getmembers()
        names = [member.name for member in members]
        if names != sorted(names) or len(names) != len(set(names)):
            raise VerificationError("archive members must be unique and globally sorted")
        for member in members:
            if member.uid != 0 or member.gid != 0 or member.mtime != source_date_epoch:
                raise VerificationError(f"archive metadata is not normalized: {member.name}")
            if not (member.isdir() or member.isfile()):
                raise VerificationError(f"archive links and special entries are forbidden: {member.name}")
        for name, expected in expected_files.items():
            member = archive.getmember(name)
            if format(member.mode, "04o") != expected["mode"]:
                raise VerificationError(f"archive payload mode mismatch: {name}")
            extracted = archive.extractfile(member)
            if extracted is None:
                raise VerificationError(f"archive payload is unreadable: {name}")
            data = extracted.read()
            if sha256_bytes(data) != expected["sha256"] or len(data) != expected["size"]:
                raise VerificationError(f"archive payload digest mismatch: {name}")
        manifest_member = archive.extractfile(f"{ARCHIVE_ROOT}/manifest.json")
        if manifest_member is None or json.load(manifest_member) != manifest:
            raise VerificationError("archive manifest readback differs from the signed-input manifest")

        with tempfile.TemporaryDirectory(prefix="porthole-ci-readback-", dir=output.parent) as temporary:
            archive.extractall(temporary)
            extracted_root = Path(temporary) / ARCHIVE_ROOT
            for spec in BUNDLE_SPECS:
                verify_bundle(extracted_root / spec.name, spec)


def parse_args() -> argparse.Namespace:
    """Parse explicit paths and provenance; the design rejects ambient defaults."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="directory containing both apps")
    parser.add_argument("--output", type=Path, required=True, help="fresh .tar output path")
    parser.add_argument("--source-sha", required=True, help="checked-out Git commit")
    parser.add_argument("--source-date-epoch", type=int, required=True, help="Git commit unix time")
    return parser.parse_args()


def main() -> int:
    """Build the CI artifact and print a bounded machine-readable receipt."""

    args = parse_args()
    try:
        source_sha = args.source_sha.lower()
        if not SOURCE_SHA_RE.fullmatch(source_sha):
            raise VerificationError("--source-sha must be 40..64 lower-case hex characters")
        if args.source_date_epoch <= 0:
            raise VerificationError("--source-date-epoch must be positive")
        input_root = args.input.resolve(strict=True)
        output = args.output.resolve(strict=False)
        if output.suffix != ".tar":
            raise VerificationError("--output must end in .tar")
        manifest = build_archive(input_root, output, source_sha, args.source_date_epoch)
        print(
            json.dumps(
                {
                    "ok": True,
                    "artifact": str(output),
                    "artifactSha256": sha256_file(output),
                    "sourceSha": source_sha,
                    "production": False,
                    "bundleCount": len(manifest["bundles"]),
                },
                sort_keys=True,
            )
        )
        return 0
    except (OSError, VerificationError, plistlib.InvalidFileException, tarfile.TarError) as error:
        print(f"build-ci-artifact: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
