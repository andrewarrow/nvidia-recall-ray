#!/usr/bin/env python3
"""Run a packaged release locally and check its offline startup surface."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import queue
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from pathlib import PurePosixPath


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path, help="release ZIP created by package_release.py")
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def host_platform() -> str:
    if sys.platform == "darwin":
        return "macos"
    if sys.platform.startswith("linux"):
        return "linux"
    if os.name == "nt":
        return "windows"
    raise RuntimeError(f"unsupported smoke-test host: {sys.platform}")


def read_response(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return response.status, response.read()


def main() -> int:
    args = parse_args()
    archive = args.archive.resolve()
    require(archive.is_file(), f"archive does not exist: {archive}")
    checksum_file = archive.with_name(archive.name + ".sha256")
    require(checksum_file.is_file(), "archive SHA-256 sidecar is missing")
    checksum_fields = checksum_file.read_text(encoding="ascii").split()
    require(len(checksum_fields) == 2 and checksum_fields[1] == archive.name and re.fullmatch(r"[0-9a-f]{64}", checksum_fields[0]) is not None, "archive SHA-256 sidecar has an invalid format")
    expected_digest = checksum_fields[0]
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == expected_digest, "archive SHA-256 does not match its sidecar")
    platform_match = re.fullmatch(r"recallray-(.+)-(macos-arm64|macos-x64|linux-x64|windows-x64)\.zip", archive.name)
    require(platform_match is not None, "archive filename must follow recallray-<version>-<platform>.zip")
    version, platform = platform_match.groups()
    require(platform.startswith(host_platform()), f"{platform} archive cannot run on this {host_platform()} host")

    with tempfile.TemporaryDirectory(prefix="recallray-smoke-") as temporary:
        extracted = Path(temporary)
        with zipfile.ZipFile(archive) as zipped:
            bad_member = zipped.testzip()
            require(bad_member is None, f"archive CRC check failed for {bad_member}")
            entries = zipped.namelist()
            require(entries and all(not PurePosixPath(entry.replace("\\", "/")).is_absolute() and ".." not in PurePosixPath(entry.replace("\\", "/")).parts for entry in entries), "archive contains an unsafe path")
            zipped.extractall(extracted)
            if os.name != "nt":
                for info in zipped.infolist():
                    if not info.is_dir():
                        mode = (info.external_attr >> 16) & 0o777
                        if mode:
                            (extracted / info.filename).chmod(mode)

        package_name = f"recallray-{version}-{platform}"
        package = extracted / package_name
        require(package.is_dir(), f"archive is missing {package_name}/")
        binary_name = "recallray.exe" if platform == "windows-x64" else "recallray"
        launcher_name = (
            "Start RecallRay.cmd" if platform == "windows-x64" else
            "Start RecallRay.command" if platform.startswith("macos-") else
            "start-recallray.sh"
        )
        allowed = {binary_name, ".env.example", "LICENSE", "TESTING.txt", launcher_name}
        if platform.startswith("macos-"):
            allowed.add("start-recallray.sh")
        if platform == "windows-x64":
            allowed.add("Start RecallRay.ps1")
        actual = {path.relative_to(package).as_posix() for path in package.rglob("*") if path.is_file()}
        require(actual == allowed, f"unexpected package files: {sorted(actual ^ allowed)}")
        require(not any(path.is_dir() for path in package.rglob("*")), "package contains an unexpected subdirectory")
        require(not any(path.name == ".env" or path.name.endswith((".db", ".db-shm", ".db-wal")) for path in package.rglob("*")), "archive includes local credentials or a database")
        env_example = (package / ".env.example").read_text(encoding="utf-8")
        require("API_KEY=your_nebius_token_factory_key" in env_example and "TAVILY_KEY=your_tavily_key" in env_example, ".env.example does not contain the credential placeholders")
        require(not (package / ".env").exists(), "archive includes a real .env")

        database = extracted / "smoke-only.db"
        env = os.environ.copy()
        env.update({
            "API_KEY": "release-smoke-test-not-a-real-key",
            "RECALLRAY_PORT": "0",
            "RECALLRAY_DB": str(database),
        })
        if os.name == "nt":
            command = ["cmd.exe", "/d", "/c", f'"{launcher_name}" --no-open']
            creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            process = subprocess.Popen(command, cwd=package, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=creationflags)
        else:
            launcher = package / launcher_name
            if platform.startswith("macos-"):
                command = [str(launcher), "--no-open"]
            else:
                command = ["/bin/sh", str(launcher), "--no-open"]
            process = subprocess.Popen(command, cwd=package, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", start_new_session=True)

        lines: list[str] = []
        output_queue: queue.Queue[str | None] = queue.Queue()

        def collect_output() -> None:
            assert process.stdout is not None
            for line in process.stdout:
                lines.append(line.rstrip())
                output_queue.put(line.rstrip())
            output_queue.put(None)

        reader = threading.Thread(target=collect_output, daemon=True)
        reader.start()
        base_url: str | None = None
        deadline = time.monotonic() + 30
        try:
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("launcher exited before serving: " + "\n".join(lines[-20:]))
                try:
                    line = output_queue.get(timeout=0.2)
                except queue.Empty:
                    continue
                if line is None:
                    break
                match = re.search(r"http://127\.0\.0\.1:(\d+)", line)
                if match:
                    base_url = f"http://127.0.0.1:{match.group(1)}"
                    break
            require(base_url is not None, "server did not announce its localhost URL: " + "\n".join(lines[-20:]))

            ready_deadline = time.monotonic() + 10
            while time.monotonic() < ready_deadline:
                try:
                    status, body = read_response(f"{base_url}/api/state")
                    break
                except (urllib.error.URLError, TimeoutError):
                    if process.poll() is not None:
                        raise RuntimeError("server exited before the state endpoint became ready: " + "\n".join(lines[-20:]))
                    time.sleep(0.1)
            else:
                raise RuntimeError("state endpoint did not become ready")
            require(status == 200, f"GET /api/state returned HTTP {status}")
            state = json.loads(body)
            require(set(state) == {"version", "mode", "conversations", "loops", "events"}, f"unexpected state schema: {sorted(state)}")
            require(state["version"] == version, f"expected app version {version}, got {state['version']!r}")
            require(state["mode"] == "nemotron", "state mode is not nemotron")
            require(all(state[key] == [] for key in ("conversations", "loops", "events")), "isolated database did not start empty")

            for route, expected in (("/", b"RecallRay"), ("/static/app.js", b""), ("/static/app.css", b"")):
                route_status, content = read_response(base_url + route)
                require(route_status == 200 and content, f"GET {route} did not return content")
                if expected:
                    require(expected in content, f"GET {route} did not contain expected app content")
            require(database.exists(), "launcher did not create the isolated SQLite database")
            require((package / ".env").read_text(encoding="utf-8") == env_example,
                    "first launch did not create the placeholder configuration")
            print(f"PASS {platform}: launch, empty API schema, page, JavaScript, CSS; no cloud request made")
            return 0
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        check=False,
                    )
                else:
                    try:
                        os.killpg(process.pid, signal.SIGINT)
                    except ProcessLookupError:
                        pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        subprocess.run(
                            ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            check=False,
                        )
                    else:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    process.wait(timeout=5)
            reader.join(timeout=1)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(f"smoke_release.py: FAIL: {error}", file=sys.stderr)
        raise SystemExit(1)
