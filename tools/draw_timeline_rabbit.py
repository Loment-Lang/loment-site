#!/usr/bin/env python3
"""Generate timeline-rabbit.svg — the pencil doodle under the timeline.

    python tools/draw_timeline_rabbit.py

The drawing is built from jittered polylines rather than hand-placed curves:
every stroke is sampled, perturbed twice and laid down at two opacities, then
the whole group goes through a faint turbulence/displacement filter. That is
the whole pipeline — deterministic (fixed seed), standard library only, and the
SVG is a build artifact, so re-running it must reproduce the same file.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "timeline-rabbit.svg"
R = random.Random(20261108)

STROKES: list[tuple[str, float, float]] = []
FILLS: list[tuple[str, float]] = []


def jitter(points: list[tuple[float, float]], amp: float) -> list[tuple[float, float]]:
    return [(x + R.uniform(-amp, amp), y + R.uniform(-amp, amp)) for x, y in points]


def d_of(points: list[tuple[float, float]], closed: bool = False) -> str:
    d = "M " + " L ".join(f"{x:.2f} {y:.2f}" for x, y in points)
    return d + (" Z" if closed else "")


def stroke(
    points: list[tuple[float, float]],
    width: float = 1.0,
    opacity: float = 0.55,
    closed: bool = False,
    passes: int = 2,
    amp: float = 0.55,
) -> None:
    for i in range(passes):
        pts = jitter(points, amp if i else amp * 0.6)
        STROKES.append((d_of(pts, closed), width * (1 - 0.08 * i), opacity * (1 if i == 0 else 0.55)))


def line(a: tuple[float, float], b: tuple[float, float],
         width: float = 1.0, opacity: float = 0.55, **kw) -> None:
    stroke([a, b], width, opacity, **kw)


def ellipse(
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    angle: float = 0.0,
    n: int = 44,
    a0: float = 0.0,
    a1: float = 2 * math.pi,
) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        x = rx * math.cos(t)
        y = ry * math.sin(t)
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


# ---------------------------------------------------------------- staircase
stairs = [(24, 132), (64, 132), (64, 117), (100, 117), (100, 102),
          (136, 102), (136, 87), (172, 87), (172, 72), (208, 72),
          (208, 57), (244, 57)]
stroke(stairs, 1.35, 0.62, amp=0.5)
line((24, 132), (248, 132), 1.0, 0.32, passes=1, amp=0.4)

# pencil shadow under each tread
for x0, x1, y in ((64, 100, 117), (100, 136, 102), (136, 172, 87),
                  (172, 208, 72), (208, 244, 57)):
    for k in range(5):
        x = x0 + 6 + k * 8
        line((x, y + 2), (x + 4, y + 8), 0.55, 0.17, passes=1, amp=0.3)

# -------------------------------------------------------------------- arrow
arrow = quad((50, 40), (145, 14), (235, 16))
stroke(arrow, 1.5, 0.6, amp=0.45)
tip, prev = arrow[-1], arrow[-2]
ang = math.atan2(tip[1] - prev[1], tip[0] - prev[0])
for s in (-1, 1):
    line(tip, (tip[0] - 13 * math.cos(ang + s * 0.45),
               tip[1] - 13 * math.sin(ang + s * 0.45)), 1.5, 0.6, amp=0.35)

# ------------------------------------------------------------------- rabbit
# body, head, ears; the group leans forward as if just off the step
stroke(ellipse(118, 80, 19, 13, angle=-0.18), 1.3, 0.62)
stroke(ellipse(137, 66, 11, 10, angle=0.05), 1.25, 0.62)

for cx, cy, a in ((123, 44, -0.28), (142, 43, 0.20)):
    stroke(ellipse(cx, cy, 4.8, 16, angle=a), 1.1, 0.55)
    stroke(ellipse(cx, cy + 1, 2.0, 10.5, angle=a), 0.55, 0.28, passes=1)

# ears' inner lines
stroke(ellipse(123, 45, 1.3, 11, angle=-0.28), 0.5, 0.25, passes=1)
stroke(ellipse(142, 44, 1.3, 11, angle=0.20), 0.5, 0.25, passes=1)

# tail
stroke(ellipse(99, 80, 5, 4.5), 1.0, 0.5)
stroke(ellipse(99, 80, 2.4, 2.1), 0.55, 0.28, passes=1)

# hind and front legs, mid-hop
stroke([(107, 87), (99, 96), (92, 94), (98, 89)], 1.1, 0.55)
stroke([(132, 86), (144, 82), (150, 85), (139, 90)], 1.1, 0.55)
stroke([(112, 90), (106, 98), (101, 98)], 0.8, 0.28, passes=1)

# face
FILLS.append((d_of(ellipse(142, 64, 1.4, 1.4, n=10), closed=True), 0.8))
stroke([(146, 69), (149, 71), (146, 72)], 0.9, 0.5, passes=1)
line((146, 72), (144, 75), 0.7, 0.4, passes=1)
line((146, 72), (149, 75), 0.7, 0.4, passes=1)
line((149, 71), (160, 69), 0.6, 0.32, passes=1)
line((149, 72), (160, 74), 0.6, 0.32, passes=1)

# tiny L badge on the chest — the only branding, kept to three strokes
stroke([(111, 75), (118, 75), (118, 83), (111, 83)], 0.8, 0.42, closed=True, passes=1)
stroke([(113, 77), (113, 81), (117, 81)], 0.8, 0.48, passes=1)

# body hatching
for i in range(4):
    line((108 + i * 4, 86), (112 + i * 4, 92), 0.55, 0.24, passes=1, amp=0.3)
for i in range(2):
    line((130 + i * 3, 71), (133 + i * 3, 75), 0.5, 0.22, passes=1, amp=0.3)

# dust and motion behind the hop
for a, b in (((94, 70), (80, 68)), ((96, 80), (77, 80)), ((98, 90), (82, 93))):
    line(a, b, 0.75, 0.3, passes=1, amp=0.4)
for cx in (92, 99, 106):
    stroke(ellipse(cx, 101, 4, 2.2, n=12, a0=0.2, a1=2.6), 0.6, 0.25, passes=1)

# pencil shadow on the tread under the rabbit
for k in range(4):
    line((105 + k * 7, 104), (112 + k * 7, 104), 0.5, 0.2, passes=1, amp=0.3)

paths = "\n".join(
    f'    <path d="{d}" stroke-width="{w:.2f}" opacity="{o:.2f}"/>'
    for d, w, o in STROKES
)
fills = "\n".join(
    f'    <path d="{d}" fill="#3b414a" stroke="none" opacity="{o:.2f}"/>'
    for d, o in FILLS
)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="280" height="150" viewBox="0 0 280 150" role="img" aria-labelledby="title">
  <title id="title">A pencil sketch of the Loment rabbit hopping up a staircase</title>
  <desc>Generated by tools/draw_timeline_rabbit.py; deterministic seed 20261108.</desc>
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
