#!/usr/bin/env python3
"""Write playground/manifest.json: every file under playground/py, mapped into
the virtual filesystem. Run from the site root after refreshing the copies:

    python playground/make_manifest.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = ROOT / "py"

files = []
for path in sorted(PY.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(ROOT).as_posix()
    files.append([rel, "/loment/" + path.relative_to(PY).as_posix()])

(ROOT / "manifest.json").write_text(
    json.dumps({"files": files}, indent=1) + "\n", encoding="utf-8", newline="\n")
print(f"{len(files)} files")
