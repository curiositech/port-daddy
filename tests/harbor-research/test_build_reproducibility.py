#!/usr/bin/env python3
"""Regression tests for Harbor's source-bound PDF build contract.

The fixture repository lives under TMPDIR (set to the workflow runner temp
directory). It tests only Git epochs and a fake compiler; real TeX rendering is
proved separately by the Harbor workflow's repeated clean-render hash check.
"""

from __future__ import annotations

from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

REPO_ROOT = Path(__file__).resolve().parents[2]
MAKEFILE = REPO_ROOT / "docs" / "harbor-research" / "Makefile"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "harbor-research-build.yml"


def run(args: list[str], *, cwd: Path, env: dict[str, str] | None = None,
        check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=cwd, env=env, check=check, text=True,
                          capture_output=True)


def stamp(epoch: int) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S +0000")


class FixtureRepo:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.harbor = root / "docs" / "harbor-research"
        (self.harbor / "tex").mkdir(parents=True)
        (self.harbor / "figures").mkdir()
        (root / ".github" / "workflows").mkdir(parents=True)
        shutil.copy2(MAKEFILE, self.harbor / "Makefile")
        shutil.copy2(WORKFLOW, root / ".github" / "workflows" / "harbor-research-build.yml")
        (self.harbor / "tex" / "paper.tex").write_text("\\documentclass{article}\\begin{document}same\\end{document}\n")
        (self.harbor / "figures" / "figure.tex").write_text("% fixture figure\n")
        (self.harbor / "figures" / "figure.png").write_bytes(b"fixture")
        run(["git", "init"], cwd=root)
        run(["git", "config", "user.name", "fixture"], cwd=root)
        run(["git", "config", "user.email", "fixture@example.invalid"], cwd=root)

    def commit(self, message: str, epoch: int) -> str:
        env = {**os.environ, "GIT_AUTHOR_DATE": stamp(epoch), "GIT_COMMITTER_DATE": stamp(epoch)}
        run(["git", "add", "."], cwd=self.root, env=env)
        run(["git", "commit", "-m", message], cwd=self.root, env=env)
        return run(["git", "rev-parse", "HEAD"], cwd=self.root).stdout.strip()

    def epoch(self, ref: str = "HEAD") -> int:
        result = run(["make", "-s", "-C", str(self.harbor), "source-epoch", f"SOURCE_REF={ref}"],
                     cwd=self.root)
        return int(result.stdout.strip())

    def source_inputs(self) -> list[str]:
        return run(["make", "-s", "-C", str(self.harbor), "source-inputs"],
                   cwd=self.root).stdout.splitlines()


@unittest.skipUnless(shutil.which("git") and shutil.which("make"), "git and make are required")
class TestBuildReproducibility(unittest.TestCase):
    def fixture_dir(self) -> tempfile.TemporaryDirectory[str]:
        tmpdir = os.environ.get("TMPDIR") or os.environ.get("RUNNER_TEMP")
        self.assertTrue(tmpdir, "TMPDIR or RUNNER_TEMP must point to approved external scratch")
        return tempfile.TemporaryDirectory(dir=tmpdir)

    def test_metadata_only_commit_preserves_epoch(self) -> None:
        with self.fixture_dir() as tmp:
            repo = FixtureRepo(Path(tmp) / "fixture")
            repo.commit("source", 1_700_000_000)
            before = repo.epoch()
            (repo.root / "proof.json").write_text('{"review":"metadata only"}\n')
            repo.commit("metadata", 1_700_000_100)
            self.assertEqual(before, repo.epoch())

    def test_invalid_source_ref_fails_closed(self) -> None:
        with self.fixture_dir() as tmp:
            repo = FixtureRepo(Path(tmp) / "fixture")
            repo.commit("source", 1_700_000_000)
            result = run(["make", "-s", "-C", str(repo.harbor), "source-epoch",
                          "SOURCE_REF=refs/heads/does-not-exist"],
                         cwd=repo.root, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(result.stdout, "")

    def test_source_revert_changes_epoch_even_when_inputs_match(self) -> None:
        with self.fixture_dir() as tmp:
            repo = FixtureRepo(Path(tmp) / "fixture")
            baseline = repo.commit("source", 1_700_000_000)
            baseline_epoch = repo.epoch(baseline)
            source = repo.harbor / "tex" / "paper.tex"
            original = source.read_text()
            source.write_text("\\documentclass{article}\\begin{document}changed\\end{document}\n")
            repo.commit("change source", 1_700_000_200)
            source.write_text(original)
            repo.commit("revert source bytes", 1_700_000_300)

            same_bytes = run(["git", "diff", "--quiet", baseline, "HEAD", "--", *repo.source_inputs()],
                             cwd=repo.root, check=False)
            self.assertEqual(same_bytes.returncode, 0)
            self.assertNotEqual(baseline_epoch, repo.epoch())
            self.assertEqual(1_700_000_300, repo.epoch())

    def test_failing_pdflatex_does_not_publish(self) -> None:
        with self.fixture_dir() as tmp:
            repo = FixtureRepo(Path(tmp) / "fixture")
            repo.commit("source", 1_700_000_000)
            fake_bin = repo.root / "fake-bin"
            fake_bin.mkdir()
            compiler = fake_bin / "pdflatex"
            compiler.write_text(
                "#!/bin/sh\n"
                "count=0\n"
                "if [ -f \"$FAKE_COUNT\" ]; then count=$(cat \"$FAKE_COUNT\"); fi\n"
                "count=$((count + 1))\n"
                "printf '%s' \"$count\" > \"$FAKE_COUNT\"\n"
                "if [ \"$count\" -eq 1 ]; then exit 71; fi\n"
                "for arg do case \"$arg\" in *.tex) pdf=\"${arg%.tex}.pdf\" ;; esac; done\n"
                "printf 'fake pdf after recovery' > \"$pdf\"\n"
            )
            compiler.chmod(0o755)
            build_dir = repo.root / "out" / "build"
            pdf_dir = repo.root / "out" / "pdf"
            pdf_dir.mkdir(parents=True)
            sentinel = pdf_dir / "retained.pdf"
            sentinel.write_bytes(b"already published")
            env = {
                **os.environ,
                "FAKE_COUNT": str(repo.root / "fake-compiler-count"),
                "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            }
            result = run(["make", "-C", str(repo.harbor), "docs", "TEXS=paper",
                          f"BUILD_DIR={build_dir}", f"PDF_DIR={pdf_dir}"],
                         cwd=repo.root, env=env, check=False)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(sentinel.read_bytes(), b"already published")
            self.assertEqual((repo.root / "fake-compiler-count").read_text(), "1")
            self.assertFalse((pdf_dir / "paper.pdf").exists())


if __name__ == "__main__":
    unittest.main()
