#!/usr/bin/env python3
"""Refresh playground/beta from a Loment main checkout.

    python tools/sync_beta.py <path-to-loment-checkout>

Copies the reference compiler modules, loment/lib, loment/lspe and lompi/store
into playground/beta, then rebuilds both channel manifests. The site's own
pg_runner.py and helpers.lomt stay in place.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "playground" / "beta"
MODULES = (
    "lomc.py", "lomelf.py", "lomentc.py", "lvm.py", "potato.py",
    "potato_from.py", "lomt_from.py", "loment_comefor.py",
    "loment_diag.py", "loment_interp.py",
    # surface grammars: `choose write grammar <name>` imports these lazily
    "trans_core.py", "pytrans.py", "jtrans.py", "ctrans.py", "cpptrans.py",
    "cstrans.py", "gotrans.py", "nltrans.py",
)


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__.strip())
        return 2
    src = Path(argv[0]).resolve()
    if not (src / "tools" / "lomentc.py").is_file():
        print(f"{src}: not a Loment checkout (tools/lomentc.py missing)")
        return 2

    tools = DEST / "py" / "tools"
    tools.mkdir(parents=True, exist_ok=True)
    for name in MODULES:
        shutil.copy2(src / "tools" / name, tools / name)

    for rel, dst in (
        ("loment/lib", DEST / "py" / "loment" / "lib"),
        ("loment/lspe", DEST / "py" / "loment" / "lspe"),
        ("lompi/store", DEST / "py" / "lompi" / "store"),
    ):
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src / rel, dst)

    subprocess.run([sys.executable, str(ROOT / "playground" / "make_manifest.py")],
                   check=True, cwd=ROOT)
    print(f"beta refreshed from {src}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
