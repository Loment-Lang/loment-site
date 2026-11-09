#!/usr/bin/env python3
"""Generate blog-rabbit-horizon.svg — the pencil doodle for the 2026-11-08 post.

    python tools/draw_blog_rabbit.py

Same pipeline as tools/draw_timeline_rabbit.py: jittered polylines laid down
twice, then a faint turbulence/displacement filter. Fixed seed, standard
library only, reproducible byte for byte.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "blog-rabbit-horizon.svg"
R = random.Random(20261108)

STROKES: list[tuple[str, float, float]] = []
FILLS: list[tuple[str, float]] = []


def jitter(points, amp):
    return [(x + R.uniform(-amp, amp), y + R.uniform(-amp, amp)) for x, y in points]


def d_of(points, closed=False):
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in points)
    return d + (" Z" if closed else "")


def stroke(points, width=1.0, opacity=0.55, closed=False, passes=2, amp=0.55):
    for i in range(passes):
        pts = jitter(points, amp if i else amp * 0.6)
        STROKES.append((d_of(pts, closed), width * (1 - 0.08 * i),
                        opacity * (1 if i == 0 else 0.55)))


def line(a, b, width=1.0, opacity=0.55, **kw):
    stroke([a, b], width, opacity, **kw)


def ellipse(cx, cy, rx, ry, angle=0.0, n=44, a0=0.0, a1=2 * math.pi):
    pts = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * math.cos(angle) - y * math.sin(angle),
                    cy + x * math.sin(angle) + y * math.cos(angle)))
    return pts


def quad(p0, c, p1, n=28):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        pts.append((u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
                    u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]))
    return pts


# ------------------------------------------------------------- horizon
line((16, 112), (344, 112), 1.15, 0.5, amp=0.45)

# distant hills
stroke(quad((16, 112), (72, 84), (132, 112)), 0.95, 0.4, passes=1, amp=0.5)
stroke(quad((100, 112), (166, 94), (232, 112)), 0.85, 0.32, passes=1, amp=0.5)

# sun on the horizon: upper half plus three short rays
stroke(ellipse(298, 96, 15, 15, n=30, a0=math.pi, a1=2 * math.pi), 1.1, 0.5)
for a in (-0.8, -0.15, 0.5):
    line((298 + 20 * math.cos(a), 96 + 20 * math.sin(a)),
         (298 + 27 * math.cos(a), 96 + 27 * math.sin(a)), 0.7, 0.35, passes=1)

# two birds
for cx in (246, 258):
    stroke([(cx - 5, 74), (cx, 70), (cx + 5, 74)], 0.7, 0.35, passes=1, amp=0.3)

# --------------------------------------------------------------- path
line((58, 156), (298, 112), 1.0, 0.45, amp=0.5)
line((342, 156), (298, 112), 1.0, 0.45, amp=0.5)
for y in (126, 138, 150):
    xl = 58 + 240 * (156 - y) / 44
    xr = 342 - 44 * (156 - y) / 44
    line((xl + 4, y), (xr - 4, y), 0.75, 0.3, passes=1, amp=0.4)

# --------------------------------------------------------------- rabbit
# body and head, leaning into the run; feet land on the path, below the horizon
stroke(ellipse(178, 126, 22, 12, angle=-0.05), 1.25, 0.6)
stroke(ellipse(205, 119, 10, 9.5, angle=0.05), 1.2, 0.6)

# ears swept back
for cx, cy, a in ((192, 101, -0.95), (201, 100, -0.8)):
    stroke(ellipse(cx, cy, 4.2, 14, angle=a), 1.05, 0.52)
    stroke(ellipse(cx, cy + 1, 1.7, 9, angle=a), 0.5, 0.25, passes=1)

# tail
stroke(ellipse(152, 122, 4.5, 4.0), 0.95, 0.48)
stroke(ellipse(152, 122, 2.0, 1.8), 0.5, 0.25, passes=1)

# four legs, stretched: two forward, two back, one kicked up
stroke([(195, 133), (212, 140), (223, 137)], 1.05, 0.52)
stroke([(193, 131), (209, 136), (219, 134)], 0.8, 0.3, passes=1)
stroke([(162, 133), (148, 144), (138, 142)], 1.05, 0.52)
stroke([(165, 135), (152, 146), (143, 145)], 0.8, 0.3, passes=1)
stroke([(169, 127), (157, 116), (149, 118)], 0.85, 0.32, passes=1)

# face
FILLS.append((d_of(ellipse(209, 117, 1.3, 1.3, n=10), closed=True), 0.8))
line((213, 122), (216, 124), 0.8, 0.45, passes=1)
line((216, 124), (214, 127), 0.6, 0.35, passes=1)
line((216, 123), (226, 121), 0.55, 0.3, passes=1)
line((216, 125), (226, 127), 0.55, 0.3, passes=1)

# tiny L badge
stroke([(169, 121), (176, 121), (176, 129), (169, 129)], 0.75, 0.4, closed=True, passes=1)
stroke([(171, 123), (171, 127), (175, 127)], 0.75, 0.45, passes=1)

# hatching and dust
for i in range(4):
    line((167 + i * 4, 131), (171 + i * 4, 137), 0.5, 0.22, passes=1, amp=0.3)
for a, b in (((139, 117), (119, 115)), ((141, 127), (115, 127)), ((143, 137), (121, 140))):
    line(a, b, 0.7, 0.28, passes=1, amp=0.4)
for cx in (136, 143, 150):
    stroke(ellipse(cx, 150, 4, 2.2, n=12, a0=0.2, a1=2.6), 0.55, 0.24, passes=1)

# a few grass ticks at the horizon, left side
for x in (26, 38, 54, 70, 88, 206, 222):
    line((x, 112), (x - 1.5, 107), 0.55, 0.25, passes=1, amp=0.3)

paths = "\n".join(
    f'    <path d="{d}" stroke-width="{w:.2f}" opacity="{o:.2f}"/>'
    for d, w, o in STROKES)
fills = "\n".join(
    f'    <path d="{d}" fill="#3b414a" stroke="none" opacity="{o:.2f}"/>'
    for d, o in FILLS)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="360" height="160" viewBox="0 0 360 160" role="img" aria-labelledby="title">
  <title id="title">A pencil sketch of the Loment rabbit running toward the horizon</title>
  <desc>Generated by tools/draw_blog_rabbit.py; deterministic seed 20261108.</desc>
  <defs>
    <filter id="pencil" x="-8%" y="-8%" width="116%" height="116%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.85" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
  <g filter="url(#pencil)" fill="none" stroke="#3b414a" stroke-linecap="round" stroke-linejoin="round">
{paths}
{fills}
  </g>
</svg>
'''

OUT.write_text(svg, encoding="utf-8", newline="\n")
print(f"wrote {OUT} ({len(svg)} bytes, {len(STROKES)} strokes)")
