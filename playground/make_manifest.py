#!/usr/bin/env python3
"""Write one manifest per channel: beta/manifest.json and stable/manifest.json.

Each manifest maps every file under <channel>/py into the virtual filesystem.
Run from the site root after refreshing either channel:

    python playground/make_manifest.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHANNELS = ("beta", "stable")

for channel in CHANNELS:
    base = ROOT / channel
    py = base / "py"
    files = []
    for path in sorted(py.rglob("*")):
        if not path.is_file():
            continue
        files.append([path.relative_to(base).as_posix(),
                      "/loment/" + path.relative_to(py).as_posix()])
    (base / "manifest.json").write_text(
        json.dumps({"files": files}, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(f"{channel}: {len(files)} files")
