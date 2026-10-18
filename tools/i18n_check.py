#!/usr/bin/env python3
# i18n_check.py —— 官网多语言的对齐校验
#
# 站点是手写的、没有构建步骤，所以"译文会不会跟英文悄悄漂掉"只能靠一条判据看着。
# 英文页是**唯一**的源；这个脚本钉住五件事：
#
#   1. 五种语言 × 六个页面齐全，没有多余文件；
#   2. <html lang> 与 /zh/ /ja/ /ru/ /es/ 的路径对得上；
#   3. <head> 里的 hreflang 组、顶栏的语言切换器、以及每一块
#      <div class="codewrap">…</div>，都**逐字节**等于规范文本
#      （规范文本由本脚本生成，见 --fix —— 所以改站址这种全局改动不会漏掉某一页）；
#   4. 结构对齐：<section> 的 class 序列与英文页相同，本地链接目标集合也相同
#      —— 译文不得引入新链接，也不得丢掉链接；
#   5. 翻译戳：译文页头记着英文页"散文面"的 sha256，英文一改，戳过期就红。
#      与 docs/i18n/glossary.md §2 的 <source-sha256> 是同一个装置。
#
# 代码块与命令输出**不翻译**（docs/i18n/glossary.md §3），所以它们是逐字节搬运的，
# 不是重写的。--fix 干的就是这件事：按序号把英文第 N 块 codewrap 搬进译文。
#
# 运行:
#   python tools/i18n_check.py           # 校验
#   python tools/i18n_check.py --fix     # 搬代码块 + 重建 alternate 组与切换器
#   python tools/i18n_check.py --stamp   # 重盖翻译戳（翻译完、校验过之后才跑）
#
# 没有第三方依赖：只用标准库。

from __future__ import annotations

import hashlib
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 站址是**唯一**的硬编码处。换域名时改这一行，然后跑 --fix：
# 30 个页面的 hreflang 会一起重写，跑不出"漏掉某一页"这种形状。
#
# **2026-10-17：随仓库迁进 `Loment-Lang` 组织，地址变了。** 组织 Pages 用组织名做子域，
# 而 **Pages 不做重定向** —— 旧地址 `fujojtop.github.io/loment-site/` 现在是 **404**，
# 所以这一次不是"好看"，是 55 页 × 6 条 hreflang 全指着一个死域。仓库的旧 URL 会 301，
# 站点不会 —— 两者的行为不一样，别混。
ORIGIN = "https://loment-lang.github.io/loment-site"

#: (目录, <html lang>, hreflang, 切换器里的自称, summary 上的短标)
LANGS = [
    ("",   "en",      "en",      "English",  "EN"),
    ("zh", "zh-Hans", "zh-Hans", "简体中文", "中文"),
    ("ja", "ja",      "ja",      "日本語",   "日本語"),
    ("ru", "ru",      "ru",      "Русский",  "RU"),
    ("es", "es",      "es",      "Español",  "ES"),
]

#: 英文页在根目录；译文各占一个子目录，页面名相同。
PAGES = ["index.html", "start.html", "examples.html", "standard.html", "lgc.html", "lgc-paper.html",
         "lvm.html",
         "lompi.html",
         "libl.html",
         "lspe.html",
         "releases.html",
         "roadmap.html",
         "learn.html"]

#: 语言切换器与 alternate 组不进"散文面"：它们是镶边，不是内容。
SKIP_CLASSES = {"codewrap", "lang"}

#: 译文页允许链到的**仓根资源**：站点样式与图标，外加 LGC 论文那份 PDF ——
#: 它是五种语言共用的一份（各自拷一份就是五份会漂的东西）。
ROOT_ASSETS = {"style.css", "mark.svg", "lgc-paper.pdf"}

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}

CODE_RE = re.compile(r'<div class="codewrap">.*?</div>', re.S)
#: 找块时不按"alternate 那几行长什么样"去找，而是锚在两个**固定邻居**之间：
#: 从 `style.css` 那条样式表到 `</head>`、从 `</nav>` 到 `</header>`。
#: 这样 --fix 对"已经跑坏一半"的中间态也是幂等的 —— 它重写整段，不修补行。
#:
#: 样式表那条要容许 `../` 前缀：译文在子目录里，链的是 `../style.css`。
#: 早先只认 `style.css` 的写法，于是译文页上这一段压根没被匹配到 —— 而"没匹配到"
#: 在 --fix 里是静默的，在之前的校验里也是静默的，`</head>` 就这么没了。
#: 尾锚取**跳转链接或顶栏，谁先到算谁** —— 这一段被人为削掉过一次（`</head>`、
#: `<body>`、跳转链接一起没了），只认 `<a class="skip"` 就再也认不出来，也就修不回去。
#: 注意**不能**把 `</head>` / `<body>` 也算进尾锚：那样匹配会停在它们之前，
#: 而规范文本里又含着它们，重写一遍就是复制一份。
HEAD_SPAN_RE = re.compile(
    r'<link rel="stylesheet" href="(?:\.\./)?style\.css">.*?'
    r'(?=<a class="skip"|<header class="bar">)', re.S)
BAR_SPAN_RE = re.compile(r'</nav>\n.*?</header>', re.S)
#: 校验时只认整块出现在那里，不管它在不在行首。
LANG_RE = re.compile(r'<details class="lang"[^>]*>.*?</details>', re.S)
SECTION_RE = re.compile(r'<section class="([^"]*)"')
NAV_RE = re.compile(r'<nav>(.*?)</nav>', re.S)
NAV_LINK_RE = re.compile(r'<a\b[^>]*>(.*?)</a>', re.S)


def nav_labels(text: str) -> list[str]:
    """顶栏导航的文字。`LGC` / `lompi` / `GitHub` 这些本来就各语言一样，
    所以判的不是"每一条都不同"，而是**整串不能与英文逐字相同** ——
    那正是"漏译了导航"的形状。"""
    m = NAV_RE.search(text)
    if not m:
        return []
    return [re.sub(r"\s+", " ", t).strip() for t in NAV_LINK_RE.findall(m.group(1))]
HREF_RE = re.compile(r'href="([^"]*)"')
HTML_LANG_RE = re.compile(r'<html lang="([^"]*)">')
STAMP_RE = re.compile(
    r"<!-- translated-from: ([^\s]+) -->\n<!-- source-sha256: ([0-9a-f]{64}) -->\n")
#: 容忍"被粘成一行"的坏戳，好让 --stamp 能把它们清干净。
STAMP_ANY_RE = re.compile(
    r"(?:<!-- translated-from: [^\s]+ -->\n?<!-- source-sha256: [0-9a-f]{64} -->\n?)+")


def langs_by_dir() -> dict[str, tuple[str, str, str, str]]:
    return {d: (code, hre, native, short) for d, code, hre, native, short in LANGS}


def page_path(d: str, page: str) -> Path:
    return ROOT / d / page if d else ROOT / page


def url(d: str, page: str) -> str:
    return f"{ORIGIN}/{d + '/' if d else ''}{page}"


# --------------------------------------------------------------- 规范文本

def canonical_alts(page: str) -> str:
    """<head> 里的 hreflang 组，含 x-default。"""
    lines = [f'<link rel="alternate" hreflang="{hre}" href="{url(d, page)}">'
             for d, _code, hre, _n, _s in LANGS]
    lines.append(f'<link rel="alternate" hreflang="x-default" href="{url("", page)}">')
    return "\n".join(lines) + "\n"


def canonical_head_span(d: str, page: str) -> str:
    """`style.css` 那条样式表到 `<body>` 之间**应当**长什么样。

    --fix 与校验用的是同一个函数 —— 两处各写一份就会各漂各的。
    这一段**自带 `</head>`**，所以哪怕页上那个标签整个没了，重写一遍也就补回来了。"""
    prefix = "../" if d else ""
    return (f'<link rel="stylesheet" href="{prefix}style.css">\n'
            + canonical_alts(page) + "</head>\n<body>\n\n")


def canonical_bar_span(page: str, d: str) -> str:
    return "</nav>\n" + canonical_lang_block(page, d) + "\n  </div>\n</header>"


def rel_href(cur: str, target: str, page: str) -> str:
    """从 cur 目录里链到 target 目录同一页的相对路径。"""
    if cur == target:
        return page
    if cur == "":
        return f"{target}/{page}"
    if target == "":
        return f"../{page}"
    return f"../{target}/{page}"


def canonical_lang_block(page: str, cur: str) -> str:
    """顶栏那个 <details> 语言切换器。当前语言那一条带 aria-current。
    缩进按它在 `</nav>` 与 `  </div>` 之间的位置来（4 空格）。"""
    _code, _hre, _native, short = langs_by_dir()[cur]
    out = ['    <details class="lang" name="bar">',
           f'      <summary>{short}</summary>',
           '      <ul>']
    for d, _c, hre, native, _s in LANGS:
        attrs = f' hreflang="{hre}"'
        if d == cur:
            attrs += ' aria-current="true"'
        out.append(f'        <li><a href="{rel_href(cur, d, page)}"{attrs}>{native}</a></li>')
    out += ['      </ul>',
            '    </details>']
    return "\n".join(out)


# ------------------------------------------------------------- 散文与结构

class _Prose(HTMLParser):
    """按文档顺序收集可见文字，跳过代码块与语言切换器。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.skip_at: int | None = None
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        cls = set((dict(attrs).get("class") or "").split())
        if tag.lower() not in VOID:
            self.depth += 1
        if self.skip_at is None and (cls & SKIP_CLASSES):
            self.skip_at = self.depth

    def handle_startendtag(self, tag, attrs):
        pass

    def handle_endtag(self, tag):
        if tag.lower() in VOID:
            return
        if self.skip_at is not None and self.depth == self.skip_at:
            self.skip_at = None
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.skip_at is not None:
            return
        s = re.sub(r"\s+", " ", data).strip()
        if s:
            self.parts.append(s)


def prose_surface(text: str) -> str:
    p = _Prose()
    p.feed(text)
    return "\n".join(p.parts)


def prose_sha(text: str) -> str:
    return hashlib.sha256(prose_surface(text).encode("utf-8")).hexdigest()


def local_hrefs(d: str, text: str) -> tuple[list[str], list[str]]:
    """把本地链接**按这一页所在目录解析**成仓内路径。

    返回 (归一化后的目标集合, 落不到实文件上的那些)。

    这一步不能只看字符串：`zh/index.html` 里写 `style.css` 与写 `../style.css`
    归一化之后都是 `style.css`，但前者指向 `zh/style.css` —— 一个不存在的文件，
    页面会掉样式。所以"解析后这个文件在不在"要单独问一次。"""
    text = LANG_RE.sub("", text)
    ok: list[str] = []
    missing: list[str] = []
    for h in HREF_RE.findall(text):
        if h.startswith(("http://", "https://", "#", "mailto:")):
            continue
        target = h.split("#", 1)[0]
        if not target:
            continue
        parts: list[str] = []
        for seg in (f"{d}/{target}" if d else target).split("/"):
            if seg == "..":
                if parts:
                    parts.pop()
            elif seg not in ("", "."):
                parts.append(seg)
        rel = "/".join(parts)
        if (ROOT / rel).exists():
            ok.append(rel[len(d) + 1:] if d and rel.startswith(d + "/") else rel)
        else:
            missing.append(f"{d}/{h}" if d else h)
    # 按**文档顺序**返回，不排序：比集合只能看出"少了一条/多了一条"，
    # 看不出"这条挪到别处去了" —— 而挪位子正是把一块内容插错地方时最先出现的症状。
    return ok, sorted(set(missing))


def repair_asset_hrefs(d: str, text: str) -> str:
    """子目录页指向**仓根资源**的那几条相对路径要带 `../`。只认 `ROOT_ASSETS` 里的。

    早先它判的是"这个链接现在落不到实文件上、而加到仓根上就有" —— 那是个**启发式**，
    它会误伤：译文页刚写好、同目录的某个页面还没落盘时，一条本来正确的页内链接
    （`libl.html`）会被改写成 `../libl.html`。更糟的是改完之后**它自己也认为对了**
     —— 解析后那个文件确实存在 —— 而判据的链接比对也看不出，于是那条链接悄悄指到了
    **英文页**上。2026-10-11 实测：18 个页面中招。白名单把这类误伤从"靠运气"变成
    "不可能"。"""
    if not d:
        return text

    def sub(m: re.Match) -> str:
        href = m.group(1)
        if href.startswith(("http://", "https://", "#", "mailto:", "/")) or "://" in href:
            return m.group(0)
        target = href.split("#", 1)[0]
        if target not in ROOT_ASSETS or (ROOT / d / target).exists():
            return m.group(0)
        return f'href="../{href}"' if (ROOT / target).exists() else m.group(0)

    return HREF_RE.sub(sub, text)


def escapes_dir(d: str, text: str) -> list[str]:
    """译文页里**链出自己目录**、又不是仓根资源的那些链接。

    译文页的导航与正文链接一律是页内相对（`zh/lib.l` 里也写 `libl.html`）；
    跨语言那一组由切换器负责，而它已经被 `local_hrefs` 排除在外。所以这一条是干净的：
    凡是不在自己目录下、又不是 `ROOT_ASSETS` 的，都是错的 —— 而"错"的后果是跳到英文页，
    链接还能点，最坏的那种错。"""
    if not d:
        return []
    out = []
    for h in HREF_RE.findall(LANG_RE.sub("", text)):
        if h.startswith(("http://", "https://", "#", "mailto:", "/")):
            continue
        parts: list[str] = []
        for seg in f"{d}/{h.split('#', 1)[0]}".split("/"):
            if seg == "..":
                if parts:
                    parts.pop()
            elif seg not in ("", "."):
                parts.append(seg)
        rel = "/".join(parts)
        if not rel.startswith(d + "/") and rel not in ROOT_ASSETS:
            out.append(h)
    return sorted(set(out))


# ------------------------------------------------------------------- --fix

def _write(path: Path, text: str) -> None:
    """这个仓是 LF-only（.gitattributes 里 `* text=auto eol=lf`）。
    Windows 上 write_text 默认把 \\n 翻成 \\r\\n，于是每跑一次工具工作树就多出一堆
    CRLF —— 显式指定 newline，工具就不会在别人的 diff 里留噪音。"""
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def fix_page(d: str, page: str) -> list[str]:
    """把英文的代码块与规范文本搬进这一页。英文页自身只补 alternate 与切换器。

    head 与顶栏是**整段重写**的：`style.css` 到 `</head>` 之间、`</nav>` 到
    `</header>` 之间被清成规范文本。所以这两处之间不要放别的东西 —— --fix 会把它删掉。"""
    path = page_path(d, page)
    if not path.exists():
        return [f"{d or '.'}/{page}: 文件不在"]
    text = path.read_text(encoding="utf-8")
    before = text

    # 锚段找不到时**出声**，不要静默跳过 —— 静默跳过正是 </head> 丢过一次的原因。
    if not HEAD_SPAN_RE.search(text):
        return [f"{d or '.'}/{page}: 找不到 head 段（{page} 上 style.css 到 "
                f'<a class="skip"> 之间），没动']
    if not BAR_SPAN_RE.search(text):
        return [f"{d or '.'}/{page}: 找不到顶栏段（</nav> 到 </header> 之间），没动"]

    text = repair_asset_hrefs(d, text)
    text = HEAD_SPAN_RE.sub(lambda _m: canonical_head_span(d, page), text, count=1)
    text = BAR_SPAN_RE.sub(lambda _m: canonical_bar_span(page, d), text, count=1)

    if d:  # 代码块只从英文搬，译文自己不改
        en = page_path("", page).read_text(encoding="utf-8")
        want = CODE_RE.findall(en)
        got = CODE_RE.findall(text)
        markers = re.findall(r'<!--CODE (\d+)-->', text)
        if markers:
            for n in sorted({int(m) for m in markers}, reverse=True):
                if n >= len(want):
                    return [f"{d}/{page}: <!--CODE {n}--> 没有对应的英文块"]
                text = text.replace(f"<!--CODE {n}-->", want[n], 1)
        elif len(got) == len(want):
            for old, new in zip(got, want):
                text = text.replace(old, new, 1)
        elif len(got) != len(want):
            return [f"{d}/{page}: 英文 {len(want)} 块代码，译文 {len(got)} 块 —— 对不上，不自动搬"]

    if text != before:
        _write(path, text)
        return [f"{d or '.'}/{page}: 已更新"]
    return []


def stamp_page(d: str, page: str) -> bool:
    """盖一张戳。**先把已有的戳全清掉再盖**，所以重复盖是幂等的。

    清掉的那个 + 号是修出来的：早先只换头一张，而被换掉的那张尾部的换行算在匹配里、
    却没还回去 —— 于是第二次盖戳把两张戳粘成了同一行，第三次又粘一张。"""
    en = page_path("", page).read_text(encoding="utf-8")
    path = page_path(d, page)
    text = path.read_text(encoding="utf-8")
    stamp = f"<!-- translated-from: {page} -->\n<!-- source-sha256: {prose_sha(en)} -->\n"
    new = STAMP_ANY_RE.sub("", text, count=1)
    new = new.replace("<!doctype html>\n", "<!doctype html>\n" + stamp, 1)
    if new == text:
        return False
    _write(path, new)
    return True


# ----------------------------------------------------------------- 校验

class Report:
    def __init__(self) -> None:
        self.bad = 0
        self.warn = 0

    def ok(self, msg: str) -> None:
        print(f"  [ok] {msg}")

    def fail(self, msg: str) -> None:
        self.bad += 1
        print(f"  [--] {msg}")

    def soft(self, msg: str) -> None:
        self.warn += 1
        print(f"  [~~] {msg}")


def check() -> int:
    rep = Report()

    # 1. 文件齐全
    for d, code, _hre, _n, _s in LANGS:
        for page in PAGES:
            p = page_path(d, page)
            if not p.exists():
                rep.fail(f"{d or '.'}/ 少一页：{page}")
        extra = sorted(x.name for x in (ROOT / d).glob("*.html")
                       if d and x.name not in PAGES)
        for name in extra:
            rep.fail(f"{d}/ 多了个页面：{name}")
    if not rep.bad:
        rep.ok(f"{len(LANGS)} 种语言 × {len(PAGES)} 页齐全")

    # 2..5 逐页
    mis_lang, mis_head, mis_switcher, mis_struct = [], [], [], []
    mis_code, mis_link, mis_stamp, mis_missing = [], [], [], []
    mis_skel, mis_nav, mis_escape, untranslated = [], [], [], []

    for page in PAGES:
        en_text = page_path("", page).read_text(encoding="utf-8")
        en_sections = SECTION_RE.findall(en_text)
        en_hrefs, en_missing = local_hrefs("", en_text)
        en_codes = CODE_RE.findall(en_text)
        en_sha = prose_sha(en_text)

        for miss in en_missing:
            mis_missing.append(f"./{miss}")

        for d, code, _hre, _n, _s in LANGS:
            p = page_path(d, page)
            if not p.exists():
                continue
            text = p.read_text(encoding="utf-8")
            tag = f"{d + '/' if d else './'}{page}"

            # 骨架：head 与顶栏那两段**必须是规范文本本身**，不是"里头含有"它。
            # 只查"含不含有"会放过"整段没匹配上"—— 那正是 </head> 曾经丢掉的原因。
            got_head = HEAD_SPAN_RE.search(text)
            if not got_head or got_head.group(0) != canonical_head_span(d, page):
                mis_head.append(tag)
            got_bar = BAR_SPAN_RE.search(text)
            if not got_bar or got_bar.group(0) != canonical_bar_span(page, d):
                mis_switcher.append(tag)

            for needle in ("<!doctype html>", "</head>", "<body>",
                           '<a class="skip"', "</body>", "</html>"):
                if needle not in text:
                    mis_skel.append(f"{tag} 缺 {needle}")
            if text.count('<details class="lang"') != 1:
                mis_skel.append(f"{tag} 切换器不是恰好一个")

            if d == "":
                continue

            got = HTML_LANG_RE.search(text)
            if not got or got.group(1) != code:
                mis_lang.append(tag)

            if SECTION_RE.findall(text) != en_sections:
                mis_struct.append(tag)

            if nav_labels(text) == nav_labels(en_text):
                mis_nav.append(tag)

            if CODE_RE.findall(text) != en_codes:
                mis_code.append(tag)

            page_hrefs, page_missing = local_hrefs(d, text)
            for miss in page_missing:
                mis_missing.append(miss)
            if page_hrefs != en_hrefs:
                mis_link.append(tag)

            for h in escapes_dir(d, text):
                mis_escape.append(f"{tag} -> {h}")

            stamps = STAMP_ANY_RE.findall(text)
            m = STAMP_RE.search(text)
            if len(stamps) != 1 or not m or m.group(1) != page or m.group(2) != en_sha:
                mis_stamp.append(tag)
            elif prose_surface(text) == prose_surface(en_text):
                untranslated.append(tag)

    def group(label: str, items: list[str]) -> None:
        if items:
            rep.fail(f"{label}（{len(items)}）：" + "、".join(items[:8])
                     + ("…" if len(items) > 8 else ""))
        else:
            rep.ok(label)

    group("<html lang> / 目录对得上", mis_lang)
    group("head 段（style.css→</head>）为规范文本", mis_head)
    group("顶栏段（</nav>→</header>）为规范文本", mis_switcher)
    group("文档骨架完整", mis_skel)
    group("顶栏导航文字已译", mis_nav)
    group("section 结构与英文一致", mis_struct)
    group("代码块与英文逐字节一致", mis_code)
    group("本地链接目标与顺序都同英文一致", mis_link)
    group("每个本地链接都落得到实文件", mis_missing)
    group("译文链接不越出自己的目录", mis_escape)
    group("翻译戳恰好一张、且对着英文散文面", mis_stamp)

    if untranslated:
        rep.soft("这几页的散文面与英文**逐字相同**，疑似整页没译：" + "、".join(untranslated[:8]))

    total = len(LANGS[1:]) * len(PAGES) + 12
    print(f"\ni18n_check: {total - rep.bad}/{total} 通过"
          + (f"，{rep.warn} 条提示" if rep.warn else ""))
    return 1 if rep.bad else 0


def main(argv: list[str]) -> int:
    if "--fix" in argv:
        changed = []
        for d, _c, _h, _n, _s in LANGS:
            for page in PAGES:
                changed += fix_page(d, page)
        for line in changed:
            print("  " + line)
        print(f"\n--fix: {len(changed)} 个页面有改动" if changed else "\n--fix: 无需改动")
        return 0
    if "--stamp" in argv:
        n = 0
        for d, _c, _h, _n, _s in LANGS[1:]:
            for page in PAGES:
                if page_path(d, page).exists() and stamp_page(d, page):
                    n += 1
        print(f"--stamp: 重盖 {n} 个翻译戳")
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
