#!/usr/bin/env python3
"""Deploy only the dashboard, preserving the proxy binary, config, and stock panel."""
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
    before = fingerprints()
    backup = TARGET / "data" / "releases" / str(int(time.time()))
    backup.mkdir(parents=True, mode=0o700)
    for name in ["server.py", "index.html", "README.md", "DESIGN.md", "assets"]:
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
            shutil.copy2(source, current)
    if fingerprints() != before:
        raise RuntimeError("The proxy's protected files changed during deployment.")
    subprocess.run(["systemctl", "--user", "restart", "cliproxy-dashboard.service"], check=True)
    print("Dashboard deployed; proxy binary, config, and original panel unchanged.")
    print("Dashboard backup:", backup)


if __name__ == "__main__":
    main()
