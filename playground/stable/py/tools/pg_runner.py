"""Playground runner: compile/run/build one Loment source in Pyodide.

The module is loaded from /loment/tools by playground.js. ROOT is the virtual
repository root; a host test may override ROOT/WORK before calling run_text.
"""
from __future__ import annotations

import base64
import io
import json
import re
import struct
import sys
import warnings

warnings.filterwarnings("ignore", category=SyntaxWarning)
from pathlib import Path

ROOT = Path("/loment")
WORK = ROOT / "playground.lomt"

ACTIONS = ("run", "build", "check", "ir", "ast", "potato", "asm", "wasm")


def _shim(text: str) -> str:
    if re.search(r"\bfn\s+_start\s*\(", text):
        return text
    return text + "\nfn _start() {\n    main();\n    syscall4(60, 0, 0, 0);\n}\n"


def _edition(text: str, edition: str) -> str:
    if not edition or edition == "tur2026.3":
        return text
    if "choose write grammar" in text:
        return text
    return "choose write grammar " + edition + "\n\n" + text


NATIVE = ("", "loment", "tur", "tur1", "tur2", "tur3",
          "tur2026.1", "tur2026.2", "tur2026.3")


def _grammar(text: str, edition: str, language: str) -> str:
    """Select the surface grammar. Native Tur keeps the edition switch."""
    language = (language or "loment").strip().lower()
    if language in NATIVE:
        return _edition(text, edition)
    if "choose write grammar" in text:
        return text
    return "choose write grammar " + language + "\n\n" + text


def _describe(mod) -> str:
    lines = ["module " + mod.name, ""]
    for c in mod.consts:
        lines.append("const %s: %s = %s" % (c.name, c.type, c.value))
    for s in mod.structs:
        fields = ", ".join("%s: %s" % (n, t) for n, t in s.fields)
        lines.append("struct %s { %s }" % (s.name, fields))
    for e in mod.enums:
        variants = []
        for v in e.variants:
            p = e.payloads.get(v)
            variants.append("%s(%s)" % (v, p) if p else v)
        lines.append("enum %s { %s }" % (e.name, ", ".join(variants)))
    for t in mod.traits:
        lines.append("trait %s" % t.name)
    for im in mod.impls:
        trait = getattr(im, "trait", getattr(im, "trait_name", ""))
        ty = getattr(im, "ty", getattr(im, "type_name", ""))
        lines.append("impl %s for %s" % (trait, ty))
    for c in mod.caps:
        tail = "" if c.kind == "regular" else " " + c.kind
        if c.param:
            tail += "(%d)" % c.param
        lines.append("capability %s : %s[%d..%d]%s" % (c.name, c.space, c.lo, c.hi, tail))
    for f in mod.funcs:
        params = ", ".join("%s: %s" % (p.name, p.type) for p in f.params)
        ret = "" if f.ret == "()" else " -> " + f.ret
        tp = "<%s>" % ", ".join(f.tparams) if f.tparams else ""
        lines.append("fn %s%s(%s)%s" % (f.name, tp, params, ret))
    for f in mod.externs:
        params = ", ".join("%s: %s" % (p.name, p.type) for p in f.params)
        ret = "" if f.ret == "()" else " -> " + f.ret
        lines.append("extern fn %s(%s)%s" % (f.name, params, ret))
    return "\n".join(lines) + "\n"


def _hexdump(data: bytes, base: int = 0, limit: int = 4096) -> str:
    lines = []
    for i in range(0, min(len(data), limit), 16):
        chunk = data[i:i + 16]
        hexs = " ".join("%02x" % b for b in chunk)
        asc = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
        lines.append("%08x  %-47s  |%s|" % (base + i, hexs, asc))
    if len(data) > limit:
        lines.append("... %d bytes total (first %d shown)" % (len(data), limit))
    return "\n".join(lines) + "\n"


def _elf_text(blob: bytes):
    if blob[:4] != b"\x7fELF":
        return None
    try:
        shoff = struct.unpack_from("<Q", blob, 0x28)[0]
        shentsize = struct.unpack_from("<H", blob, 0x3A)[0]
        shnum = struct.unpack_from("<H", blob, 0x3C)[0]
        shstrndx = struct.unpack_from("<H", blob, 0x3E)[0]
        o = shoff + shstrndx * shentsize
        stroff = struct.unpack_from("<Q", blob, o + 0x18)[0]
        strsize = struct.unpack_from("<Q", blob, o + 0x20)[0]
        names = blob[stroff:stroff + strsize]
        for i in range(shnum):
            o = shoff + i * shentsize
            noff = struct.unpack_from("<I", blob, o)[0]
            end = names.find(b"\0", noff)
            if names[noff:end] != b".text":
                continue
            addr = struct.unpack_from("<Q", blob, o + 0x10)[0]
            off = struct.unpack_from("<Q", blob, o + 0x18)[0]
            size = struct.unpack_from("<Q", blob, o + 0x20)[0]
            return blob[off:off + size], addr
    except (struct.error, IndexError):
        return None
    return None


def _result(kind, rc=0, out="", err="", **extra):
    d = {"kind": kind, "rc": rc, "out": out, "err": err}
    d.update(extra)
    return d


def run_text(text: str, action: str = "run", edition: str = "tur2026.3",
             target: str = "elf", name: str = "main",
             language: str = "loment") -> dict:
    import lomentc
    import lomelf
    import lvm

    action = action if action in ACTIONS else "run"
    target = "pe" if target == "pe" else "elf"

    if action == "wasm":
        return _result(
            "wasm", 0,
            "WebAssembly output is planned for 0.1.5.2.\n"
            "The wasm32 backend is designed in docs/313 and tracked in issue #1496.\n"
            "Until it lands, use Build for an ELF/PE artifact, or Run for LVM.\n")

    language = (language or "loment").strip().lower()
    src = _grammar(text, edition, language)
    if language in NATIVE:
        src = _shim(src)
    WORK.parent.mkdir(parents=True, exist_ok=True)
    WORK.write_text(src, encoding="utf-8", newline="\n")

    if action == "run":
        out = io.BytesIO()
        err = io.StringIO()
        old = sys.stderr
        sys.stderr = err
        try:
            rc = lvm.run_source(WORK, ROOT, out)
        except Exception as e:                       # noqa: BLE001
            rc = 2
            err.write(type(e).__name__ + ": " + str(e))
        finally:
            sys.stderr = old
        return _result("run", rc, out.getvalue().decode("utf-8", "replace"), err.getvalue())

    try:
        mod, deps = lomentc.load_unit(WORK, ROOT)
        errs = lomentc.check(mod, deps=deps)
    except Exception as e:                           # noqa: BLE001
        return _result(action, 2, err=type(e).__name__ + ": " + str(e))
    if errs:
        return _result(action, 2, err="check: " + repr(errs[:4]))

    if action == "check":
        return _result("check", 0,
                       "check passed: %d functions, %d structs, %d enums\n"
                       % (len(mod.funcs), len(mod.structs), len(mod.enums)))
    if action == "ir":
        return _result("ir", 0, lomentc.emit_llvm(mod, ROOT, deps))
    if action == "ast":
        return _result("ast", 0, _describe(mod))
    if action == "potato":
        raw = lomentc.emit_potato(mod, ROOT, deps)
        try:
            raw = json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
        except ValueError:
            pass
        return _result("potato", 0, raw)

    try:
        ir = lomentc.emit_llvm(mod, ROOT, deps)
        blob, info = lomelf.compile_pe(ir) if target == "pe" else lomelf.compile_ll(ir)
    except Exception as e:                           # noqa: BLE001
        return _result(action, 2, err=type(e).__name__ + ": " + str(e))

    if action == "build":
        ext = ".exe" if target == "pe" else ".elf"
        return _result("build", 0,
                       "built %d bytes (%s)\n" % (len(blob), target.upper()),
                       artifact=base64.b64encode(blob).decode("ascii"),
                       filename=name + ext)

    text_hit = _elf_text(blob)
    if text_hit is not None:
        data, addr = text_hit
        note = ".text section, %d bytes (no textual assembly exists)\n" % len(data)
    else:
        data, addr = blob[:1024], 0
        note = "artifact bytes, first %d of %d (no textual assembly exists)\n" % (
            len(data), len(blob))
    return _result("asm", 0, note + _hexdump(data, addr))
