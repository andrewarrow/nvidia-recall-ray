#!/usr/bin/env python3
"""Build a small, allowlisted RecallRay release archive."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLATFORMS = ("macos-arm64", "macos-x64", "linux-x64", "windows-x64")
ENV_EXAMPLE = """# Paste your evaluation credentials here, or enter the Nebius key at launch.
API_KEY=your_nebius_token_factory_key
TAVILY_KEY=your_tavily_key
# Optional overrides:
# WHISPER_MODEL=base.en
# RECALLRAY_PORT=7733
"""


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path, help="compiled RecallRay executable")
    parser.add_argument("--platform", required=True, choices=PLATFORMS)
    parser.add_argument("--version", required=True, help="release version, for example 0.1.0")
    parser.add_argument("--output", type=Path, default=Path("artifacts"), help="output directory")
    return parser.parse_args()


def fail(message: str) -> "NoReturn":
    print(f"package_release.py: error: {message}", file=sys.stderr)
    raise SystemExit(2)


def main() -> int:
    args = arguments()
    if not re.fullmatch(r"[0-9A-Za-z][0-9A-Za-z.+_-]*", args.version):
        fail("version may contain only letters, digits, dots, plus, underscores, and hyphens")
    binary = args.binary.resolve()
    if not binary.is_file() or binary.is_symlink():
        fail(f"binary is not a regular file: {args.binary}")

    windows = args.platform == "windows-x64"
    if windows and binary.suffix.lower() != ".exe":
        fail("windows-x64 binary must have an .exe suffix")
    if not windows and binary.suffix.lower() == ".exe":
        fail("Unix platform binary must not have an .exe suffix")

    package_name = f"recallray-{args.version}-{args.platform}"
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f"{package_name}.zip"
    checksum = output / f"{archive.name}.sha256"

    with tempfile.TemporaryDirectory(prefix="recallray-release-") as temporary:
        package = Path(temporary) / package_name
        package.mkdir()
        executable_name = "recallray.exe" if windows else "recallray"
        shutil.copyfile(binary, package / executable_name)
        if not windows:
            (package / executable_name).chmod(0o755)
        (package / ".env.example").write_text(ENV_EXAMPLE, encoding="utf-8", newline="\n")
        shutil.copyfile(ROOT / "LICENSE", package / "LICENSE")
        shutil.copyfile(ROOT / "TESTING.txt", package / "TESTING.txt")

        if windows:
            names = ("Start RecallRay.cmd", "Start RecallRay.ps1")
        elif args.platform.startswith("macos-"):
            names = ("Start RecallRay.command", "start-recallray.sh")
        else:
            names = ("start-recallray.sh",)
        for name in names:
            destination = package / name
            shutil.copyfile(ROOT / "release" / name, destination)
            if not windows:
                destination.chmod(0o755)

        # Construct the ZIP from this explicit list only. Never archive a source tree
        # or recursively sweep a developer's working directory.
        members = [
            executable_name,
            ".env.example",
            "LICENSE",
            "TESTING.txt",
            *names,
        ]
        temporary_archive = output / f".{archive.name}.tmp"
        try:
            with zipfile.ZipFile(temporary_archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
                for name in members:
                    source = package / name
                    info = zipfile.ZipInfo(f"{package_name}/{name}")
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = (stat.S_IFREG | source.stat().st_mode & 0o777) << 16
                    zipped.writestr(info, source.read_bytes())
            temporary_archive.replace(archive)
        finally:
            temporary_archive.unlink(missing_ok=True)

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum.write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(archive)
    print(checksum)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
