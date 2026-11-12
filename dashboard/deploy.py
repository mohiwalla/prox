#!/usr/bin/env python3
"""Deploy only the dashboard, preserving the proxy binary, config, and stock panel."""
import argparse
import hashlib
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parent
HUB = Path.home() / "cliproxyapi"
TARGET = HUB / "dashboard"
CORE = [HUB / "cli-proxy-api", HUB / "config.yaml", HUB / "static/management.html"]


def fingerprints():
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in CORE}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-only", action="store_true",
                        help="Publish UI and assets without restarting the dashboard or ending sessions")
    args = parser.parse_args()
    before = fingerprints()
    backup = TARGET / "data" / "releases" / str(int(time.time()))
    backup.mkdir(parents=True, mode=0o700)
    names = ["index.html", "README.md", "DESIGN.md", "assets"]
    if not args.frontend_only:
        names.insert(0, "server.py")
    for name in names:
        current = TARGET / name
        source = ROOT / name
        if current.exists():
            if current.is_dir():
                shutil.copytree(current, backup / name)
            else:
                shutil.copy2(current, backup / name)
        if source.is_dir():
            shutil.copytree(source, current, dirs_exist_ok=True)
        else:
            staged = current.with_name(current.name + ".next")
            shutil.copy2(source, staged)
            staged.replace(current)
    if fingerprints() != before:
        raise RuntimeError("The proxy's protected files changed during deployment.")
    if not args.frontend_only:
        subprocess.run(["systemctl", "--user", "restart", "cliproxy-dashboard.service"], check=True)
    print("Dashboard deployed; proxy binary, config, and original panel unchanged.")
    if args.frontend_only:
        print("Refresh the browser to see the UI. Existing sessions remain active.")
    print("Dashboard backup:", backup)


if __name__ == "__main__":
    main()
