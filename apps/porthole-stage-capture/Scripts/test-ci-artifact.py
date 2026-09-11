#!/usr/bin/env python3
"""Exercise real, prebuilt macOS packages and their fail-closed CI verifier."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import struct
import tarfile
import tempfile
import unittest

PACKAGE = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("porthole_ci_artifact", PACKAGE / "Scripts/build-ci-artifact.py")
artifact = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = artifact
spec.loader.exec_module(artifact)
SOURCE_SHA = "a" * 40
SOURCE_EPOCH = 1_700_000_000


@unittest.skipUnless(sys.platform == "darwin", "real macOS signing tools required")
class ArtifactIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="artifact-integration-", dir=PACKAGE / ".build")
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)
        cls.inputs = [cls.root / "pass-a", cls.root / "pass-b"]
        for output in cls.inputs:
            subprocess.run([
                str(PACKAGE / "Scripts/package-apps.sh"), "--skip-build", "--allow-ad-hoc",
                "--signing-identity", "-", "--configuration", os.environ.get("PORTHOLE_TEST_CONFIGURATION", "debug"),
                "--output", str(output),
            ], check=True, capture_output=True, text=True)

    def mutated(self):
        root = self.root / self._testMethodName
        shutil.copytree(self.inputs[0], root)
        return root

    def reject(self, root, message):
        output = self.root / (self._testMethodName + ".tar")
        with self.assertRaisesRegex(artifact.VerificationError, message):
            artifact.build_archive(root, output, SOURCE_SHA, SOURCE_EPOCH)
        self.assertFalse(output.exists(), "rejected input must not leave a publishable artifact")

    def resign_capture(self, root, *options):
        subprocess.run(["/usr/bin/codesign", "--force", "--sign", "-", *options, str(root / "Porthole.app")],
                       check=True, capture_output=True)

    def test_repeat_builds_are_identical_and_manifest_labels_every_byte(self):
        archives = [self.root / "a.tar", self.root / "b.tar"]
        manifests = [artifact.build_archive(root, output, SOURCE_SHA, SOURCE_EPOCH)
                     for root, output in zip(self.inputs, archives)]
        self.assertEqual(archives[0].read_bytes(), archives[1].read_bytes())
        self.assertEqual(manifests[0], manifests[1])
        manifest = manifests[0]
        self.assertEqual(manifest["sourceSha"], SOURCE_SHA)
        self.assertEqual(manifest["sourceDateEpoch"], SOURCE_EPOCH)
        self.assertFalse(manifest["production"])
        self.assertFalse(manifest["distributionAllowed"])
        self.assertFalse(manifest["tccProofEligible"])
        with tarfile.open(archives[0]) as archive:
            notices = [member for member in archive if "NOT-FOR-DISTRIBUTION" in member.name]
            self.assertEqual(len(notices), 1)
            self.assertIn(b"NOT FOR DISTRIBUTION", archive.extractfile(notices[0]).read())
        fixture = self.inputs[0] / "PortholeFixture.app/Contents/MacOS/PortholeFixture"
        binding = json.loads((self.inputs[0] / "Porthole.app/Contents/Resources/safe-fixture-identity.json").read_text())
        self.assertEqual(binding["executableSHA256"], hashlib.sha256(fixture.read_bytes()).hexdigest())
        driver = self.inputs[0] / "Porthole.app/Contents/Resources/porthole-control"
        self.assertTrue(os.access(driver, os.X_OK))
        help_result = subprocess.run([str(driver), "--help"], check=False, capture_output=True, text=True)
        self.assertEqual(help_result.returncode, 0)
        self.assertIn("without enumerating any source", help_result.stdout)
        self.assertIn("catalog", help_result.stdout)

    def test_explicit_ad_hoc_identity_without_opt_in_is_refused(self):
        result = subprocess.run([str(PACKAGE / "Scripts/package-apps.sh"), "--skip-build",
            "--signing-identity", "-", "--output", str(self.root / "must-not-exist")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 6)
        self.assertIn("requires explicit --allow-ad-hoc", result.stderr)
        self.assertFalse((self.root / "must-not-exist").exists())

    def test_extra_file_is_rejected(self):
        root = self.mutated()
        (root / "Porthole.app/Contents/extra.txt").touch()
        self.reject(root, "file contract mismatch")

    def test_privacy_drift_is_rejected_even_after_valid_resigning(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Info.plist"
        info = plistlib.loads(path.read_bytes())
        info["NSMicrophoneUsageDescription"] = "forbidden"
        path.write_bytes(plistlib.dumps(info))
        self.resign_capture(root)
        self.reject(root, "plist contract mismatch")

    def test_entitlement_is_rejected_even_after_valid_resigning(self):
        root = self.mutated()
        entitlements = self.root / "forbidden.plist"
        entitlements.write_bytes(plistlib.dumps({"com.apple.security.get-task-allow": True}))
        self.resign_capture(root, "--entitlements", str(entitlements))
        self.reject(root, "must carry no CI entitlements")

    def test_symlink_is_rejected(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Resources/PortholeIcon.icns"
        path.unlink()
        path.symlink_to(self.inputs[0] / "Porthole.app/Contents/Resources/PortholeIcon.icns")
        self.reject(root, "bundle symlink is forbidden")

    def test_non_macho_payload_is_rejected(self):
        root = self.mutated()
        (root / "Porthole.app/Contents/MacOS/Porthole").write_text("not a Mach-O executable\n")
        self.reject(root, "Mach-O")

    def test_corrupted_signature_is_rejected(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Resources/PortholeIcon.icns"
        path.write_bytes(path.read_bytes() + b"tampered")
        self.reject(root, "codesign")

    def test_fixture_digest_substitution_is_rejected_even_after_resigning(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Resources/safe-fixture-identity.json"
        binding = json.loads(path.read_text())
        binding["executableSHA256"] = "b" * 64
        path.write_text(json.dumps(binding))
        self.resign_capture(root)
        self.reject(root, "sealed fixture identity")

    def test_fixture_manifest_unknown_fields_are_rejected(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Resources/safe-fixture-identity.json"
        binding = json.loads(path.read_text())
        binding["runtimePathOverride"] = "/untrusted"
        path.write_text(json.dumps(binding))
        self.resign_capture(root)
        self.reject(root, "sealed fixture identity")

    def test_fixture_manifest_malformed_json_is_rejected(self):
        root = self.mutated()
        path = root / "Porthole.app/Contents/Resources/safe-fixture-identity.json"
        path.write_text("{invalid")
        self.resign_capture(root)
        self.reject(root, "invalid fixture identity JSON")


@unittest.skipUnless(sys.platform == "darwin", "native SwiftUI renderer required")
class SyntheticProofTests(unittest.TestCase):
    def test_render_command_rejects_capture_flags_and_preserves_existing_output(self):
        executable = PACKAGE / ".build" / os.environ.get("PORTHOLE_TEST_CONFIGURATION", "debug") / "PortholeStageCapture"
        with tempfile.TemporaryDirectory(prefix="synthetic-arguments-", dir=PACKAGE / ".build") as root:
            for args in [
                ["--render-synthetic-proof"],
                ["--render-synthetic-proof", root, "--proof-window-title", "not permitted"],
                ["--render-synthetic-proof", root, "--approve-safe-fixture-persistence"],
            ]:
                result = subprocess.run([str(executable), *args], stdin=subprocess.DEVNULL,
                                        capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 64)
            result = subprocess.run([str(executable), "--render-synthetic-proof", root], stdin=subprocess.DEVNULL,
                                    capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(list(Path(root).iterdir()), [], "existing output must never be overwritten")

    def test_synthetic_views_and_movies_are_complete_labeled_and_integrity_bound(self):
        executable = PACKAGE / ".build" / os.environ.get("PORTHOLE_TEST_CONFIGURATION", "debug") / "PortholeStageCapture"
        with tempfile.TemporaryDirectory(prefix="synthetic-render-", dir=PACKAGE / ".build") as root:
            output = Path(root) / "proof"
            result = subprocess.run([str(executable), "--render-synthetic-proof", str(output)], stdin=subprocess.DEVNULL,
                                    capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            manifest = json.loads((output / "synthetic-ui-manifest.json").read_text())
            self.assertEqual(manifest["schema"], "pd.porthole.synthetic-ui-proof.v1")
            for field in ["capturePerformed", "operatorDataRead", "permissionProof", "backgroundCaptureProof",
                          "cursorTransportProof", "productionDistribution"]:
                self.assertIs(manifest[field], False, field)
            self.assertEqual(manifest["appearances"], ["dark", "light"])
            self.assertEqual(manifest["logicalSizePoints"], {"width": 1320, "height": 830})
            self.assertEqual(len(manifest["files"]), 6)
            digests = set()
            for entry in manifest["files"]:
                data = (output / entry["filename"]).read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
                self.assertEqual(len(data), entry["bytes"])
                self.assertEqual((entry["pixelWidth"], entry["pixelHeight"]), (1320, 830))
                self.assertEqual(entry["pixelsPerPoint"], 1)
                digests.add(entry["sha256"])
                if entry["filename"].endswith(".png"):
                    self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
                    self.assertEqual(struct.unpack(">II", data[16:24]), (1320, 830))
                else:
                    self.assertEqual(entry["decodedVideoFrames"], 72)
            self.assertEqual(len(digests), 6, "both appearances and motion phases must differ")
            self.assertFalse((output / "receipt.json").exists(), "synthetic UI is not a capture receipt")


if __name__ == "__main__":
    unittest.main(verbosity=2)
