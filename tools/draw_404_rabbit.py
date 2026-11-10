#!/usr/bin/env python3
"""Generate 404-rabbit-forest.svg — a pencil sketch for the 404 page.

    python tools/draw_404_rabbit.py

Same pipeline as tools/draw_blog_rabbit.py: jittered polylines laid down
twice, then a faint turbulence/displacement filter. Fixed seed, standard
library only, reproducible byte for byte.
"""
from __future__ import annotations

import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "404-rabbit-forest.svg"
R = random.Random(20261110)

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


def ellipse(cx, cy, rx, ry, angle=0.0, n=48, a0=0.0, a1=2 * math.pi):
    pts = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * i / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        pts.append((cx + x * math.cos(angle) - y * math.sin(angle),
                    cy + x * math.sin(angle) + y * math.cos(angle)))
    return pts


def quad(p0, c, p1, n=28):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1])
            for t in (i / n for i in range(n + 1))]


def bezier(p0, p1, p2, p3, n=32):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def leaf(cx, cy, r, angle=0.0, width=0.7, opacity=0.35):
    pts = ellipse(cx, cy, r, r * 0.36, angle=angle, n=14)
    stroke(pts, width, opacity, closed=True, passes=1, amp=0.3)
    line((cx - r * 0.75 * math.cos(angle), cy - r * 0.75 * math.sin(angle)),
         (cx + r * 0.75 * math.cos(angle), cy + r * 0.75 * math.sin(angle)),
         0.4, opacity * 0.7, passes=1, amp=0.15)


def leaf_cluster(cx, cy, r, n=8, opacity=0.28):
    for _ in range(n):
        a = R.uniform(0, 2 * math.pi)
        rr = R.uniform(r * 0.25, r)
        leaf(cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.6,
             R.uniform(5, 11), R.uniform(-1.2, 1.2), 0.55, opacity * R.uniform(0.65, 1.0))


def hatch(points, step=8.0, width=0.45, opacity=0.15, amp=0.3):
    for i in range(1, len(points) - 1, max(1, int(step / 4))):
        x, y = points[i]
        dx = points[min(i + 1, len(points) - 1)][0] - points[i - 1][0]
        dy = points[min(i + 1, len(points) - 1)][1] - points[i - 1][1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        ln2 = R.uniform(2.5, step * 0.9)
        line((x - nx * ln2, y - ny * ln2), (x + nx * ln2, y + ny * ln2),
             width, opacity, passes=1, amp=amp)


def fern(cx, cy, scale=1.0, lean=-0.5, opacity=0.45):
    stem = bezier((cx, cy), (cx + 8 * scale, cy - 20 * scale),
                  (cx + 18 * scale, cy - 38 * scale),
                  (cx + 30 * scale * math.cos(lean), cy - 58 * scale))
    stroke(stem, 0.85, opacity, passes=2, amp=0.35)
    for i, (x, y) in enumerate(stem[3:-1:4]):
        t = i / max(1, len(stem[3:-1:4]) - 1)
        ln = (13 + 11 * math.sin(t * math.pi)) * scale
        line((x, y), (x - ln * 0.80, y - ln * 0.40), 0.55, opacity * 0.85, passes=1)
        line((x, y), (x + ln * 0.82, y - ln * 0.26), 0.55, opacity * 0.85, passes=1)
        line((x, y), (x - ln * 0.30, y - ln * 0.65), 0.4, opacity * 0.60, passes=1)


def grass(x, y, opacity=0.28, n=8):
    for _ in range(n):
        line((x + R.uniform(-5, 5), y), (x + R.uniform(-16, 16), y - R.uniform(8, 26)),
             0.45, opacity, passes=1, amp=0.35)


def bush(cx, cy, r, opacity=0.28):
    for _ in range(13):
        a = R.uniform(0, 2 * math.pi)
        x = cx + math.cos(a) * r * R.uniform(0.3, 1.0)
        y = cy + math.sin(a) * r * 0.45
        stroke(ellipse(x, y, R.uniform(6, 14), R.uniform(4, 8), angle=R.uniform(-0.4, 0.4)),
               0.55, opacity * R.uniform(0.6, 1.0), passes=1, amp=0.35)


def mushroom(x, y, s=1.0, opacity=0.42):
    stroke(ellipse(x, y - 5 * s, 7 * s, 4 * s, a0=math.pi, a1=2 * math.pi),
           0.75, opacity, passes=1, amp=0.25)
    line((x - 6 * s, y - 5 * s), (x + 6 * s, y - 5 * s), 0.6, opacity, passes=1)
    line((x, y - 5 * s), (x, y + 4 * s), 0.75, opacity, passes=1)
    line((x - 2 * s, y + 4 * s), (x + 2 * s, y + 4 * s), 0.6, opacity, passes=1)


def stone(x, y, s=1.0, opacity=0.38):
    pts = [(x - 10 * s, y), (x - 6 * s, y - 6 * s), (x + 2 * s, y - 8 * s),
           (x + 10 * s, y - 3 * s), (x + 9 * s, y + 2 * s), (x - 4 * s, y + 3 * s)]
    stroke(pts, 0.75, opacity, closed=True, passes=2, amp=0.3)
    line((x - 3 * s, y - 2 * s), (x + 5 * s, y - 3 * s), 0.4, opacity * 0.6, passes=1)


def tree(x, base_y, top_y, half_w, opacity=0.5, branches=3):
    top_w = half_w * 0.34
    lean = R.uniform(-10, 10)
    left = bezier((x - half_w, base_y),
                  (x - half_w * 0.86 + lean * 0.3, base_y - (base_y - top_y) * 0.38),
                  (x - top_w * 0.92 + lean * 0.7, top_y + (base_y - top_y) * 0.18),
                  (x - top_w + lean, top_y), n=40)
    right = bezier((x + half_w, base_y),
                   (x + half_w * 0.86 + lean * 0.3, base_y - (base_y - top_y) * 0.38),
                   (x + top_w * 0.92 + lean * 0.7, top_y + (base_y - top_y) * 0.18),
                   (x + top_w + lean, top_y), n=40)
    stroke(left, 1.45, opacity, passes=2, amp=0.6)
    stroke(right, 1.45, opacity, passes=2, amp=0.6)
    # bark hatching and a few knots
    for i in range(5, len(left) - 5, 6):
        lx, ly = left[i]
        rx, ry = right[min(len(right) - 1, i)]
        line((lx + 2, ly), (rx - 2, ry - R.uniform(2, 9)), 0.45, opacity * 0.42, passes=1)
    for _ in range(2):
        i = R.randrange(8, len(left) - 8)
        lx, ly = left[i]
        rx, _ = right[min(len(right) - 1, i)]
        kx = (lx + rx) / 2
        stroke(ellipse(kx, ly, 2.6, 4.2, angle=-0.2), 0.6, opacity * 0.55, passes=1)
    # roots
    for dirn in (-1, 1):
        base = (x + dirn * half_w, base_y)
        root = bezier(base, (x + dirn * half_w * 1.4, base_y + 5),
                      (x + dirn * half_w * 1.9, base_y + 9),
                      (x + dirn * half_w * 2.4, base_y + 8), n=14)
        stroke(root, 0.85, opacity * 0.8, passes=1, amp=0.4)
    # branches with leaf clusters
    for by, dirn in [(base_y - (base_y - top_y) * (0.20 + 0.16 * i), -1 if i % 2 == 0 else 1)
                     for i in range(branches)]:
        bx = x + lean * ((base_y - by) / max(1, base_y - top_y))
        p0 = (bx, by)
        p1 = (bx + dirn * 30, by - 12)
        p2 = (bx + dirn * 54, by - 30)
        p3 = (bx + dirn * 74, by - 56)
        branch = bezier(p0, p1, p2, p3, n=20)
        stroke(branch, 0.8, opacity * 0.85, passes=1, amp=0.45)
        for t in (0.55, 0.78, 0.95):
            px, py = branch[int(t * (len(branch) - 1))]
            line((px, py), (px + dirn * R.uniform(8, 15), py - R.uniform(8, 18)),
                 0.45, opacity * 0.55, passes=1)
        leaf_cluster(p3[0], p3[1], 22, 7, opacity * 0.55)


# ---------------------------------------------------------------- ground
line((16, 470), (884, 470), 1.15, 0.38, amp=0.6)
for y in (484, 498, 514):
    line((30, y), (870, y), 0.45, 0.11, passes=1, amp=0.7)
for _ in range(26):
    x = R.uniform(30, 870)
    y = R.uniform(474, 530)
    line((x, y), (x + R.uniform(4, 18), y + R.uniform(-2, 2)), 0.35, 0.08, passes=1)

# ---------------------------------------------------------------- far trees
for x, top, w in ((250, 230, 7), (310, 200, 8), (360, 250, 6),
                  (545, 215, 7), (610, 190, 9), (670, 245, 6),
                  (700, 210, 7)):
    line((x - w, 470), (x - w * 0.4, top), 0.55, 0.15, passes=1, amp=0.5)
    line((x + w, 470), (x + w * 0.4, top), 0.55, 0.15, passes=1, amp=0.5)
    line((x - w * 0.7, 350), (x - w * 1.9, 322), 0.4, 0.11, passes=1, amp=0.4)
    line((x + w * 0.7, 340), (x + w * 2.0, 310), 0.4, 0.11, passes=1, amp=0.4)
    leaf_cluster(x, top - 10, 18, 5, 0.10)

# deeper forest behind the big trunks
for x, top, w in ((235, 170, 5), (300, 145, 6), (350, 185, 4),
                  (385, 155, 5), (500, 175, 4), (555, 150, 6),
                  (610, 180, 4), (655, 160, 5), (730, 190, 4),
                  (745, 150, 5), (815, 175, 4), (870, 160, 5)):
    line((x - w, 470), (x, top), 0.45, 0.11, passes=1)
    line((x + w, 470), (x, top), 0.45, 0.11, passes=1)
    line((x, top + 28), (x + R.uniform(-18, 18), top + R.uniform(8, 20)), 0.35, 0.08, passes=1)

# ---------------------------------------------------------------- canopy
for cx, cy, rr in ((50, 50, 46), (130, 30, 38), (230, 62, 40),
                   (320, 42, 34), (620, 42, 36), (700, 56, 40),
                   (790, 30, 42), (870, 54, 38)):
    leaf_cluster(cx, cy, rr, 18, 0.23)
    for _ in range(10):
        a = R.uniform(0, 2 * math.pi)
        r = R.uniform(rr * 0.4, rr * 1.25)
        x, y = cx + math.cos(a) * r, cy + math.sin(a) * r * 0.5
        line((x, y), (x + R.uniform(-14, 14), y + R.uniform(-8, 10)),
             0.5, R.uniform(0.08, 0.18), passes=1, amp=0.4)
for cx in (350, 450, 550):
    leaf_cluster(cx, 58, 46, 16, 0.20)

# a few hanging twigs
for x, y, ln in ((40, 120, 46), (270, 100, 38), (360, 90, 34), (540, 96, 36), (640, 110, 44), (880, 130, 40)):
    stroke(bezier((x, y), (x + 6, y + ln * 0.4), (x - 8, y + ln * 0.7), (x + 2, y + ln)),
           0.55, 0.18, passes=1)
    leaf_cluster(x + 2, y + ln, 12, 4, 0.14)

# ---------------------------------------------------------------- big trees
tree(70, 470, 24, 42, 0.68, 4)
tree(175, 470, 92, 22, 0.46, 3)
tree(270, 470, 150, 15, 0.34, 2)
tree(700, 470, 140, 17, 0.32, 2)
tree(785, 470, 18, 38, 0.62, 4)
tree(855, 470, 105, 18, 0.42, 3)

# mid-level branches with leaves, to break the empty middle
for x, y, dirn in ((270, 270, 1), (270, 330, -1), (700, 260, -1), (700, 320, 1)):
    b = bezier((x, y), (x + dirn * 26, y - 8), (x + dirn * 46, y - 24), (x + dirn * 64, y - 42))
    stroke(b, 0.7, 0.26, passes=1)
    leaf_cluster(x + dirn * 64, y - 42, 18, 5, 0.22)

# a small carved 404 on the left trunk
for i, ch in enumerate("404"):
    x = 72 + i * 11
    y = 305
    if ch == "0":
        stroke(ellipse(x, y, 3.6, 5.4), 0.85, 0.42, passes=1, amp=0.25)
    elif ch == "4":
        stroke([(x - 3, y + 5), (x + 1.5, y - 5), (x + 1.5, y + 5)], 0.85, 0.42, passes=1, amp=0.25)
    else:
        stroke([(x - 3, y - 5), (x + 3, y - 5), (x + 3, y), (x - 3, y), (x - 3, y + 5), (x + 3, y + 5)],
               0.85, 0.42, passes=1, amp=0.25)

# ---------------------------------------------------------------- path
left_edge = [(300, 560), (338, 510), (378, 462), (410, 420), (408, 386), (375, 352), (300, 315)]
right_edge = [(640, 560), (600, 510), (558, 462), (520, 420), (520, 386), (558, 352), (660, 312)]
stroke(left_edge, 1.15, 0.50)
stroke(right_edge, 1.15, 0.50)
for i in range(1, len(left_edge) - 1):
    lx, ly = left_edge[i]
    rx = right_edge[min(i, len(right_edge) - 1)][0]
    line((lx + 8, ly), (rx - 8, ly), 0.45, 0.13, passes=1, amp=0.6)
# the fork: two faint trails into the trees
trail_r = bezier((468, 408), (500, 385), (530, 360), (560, 340))
trail_l = bezier((430, 400), (400, 375), (360, 350), (320, 330))
stroke(trail_r, 0.85, 0.30, passes=2)
stroke(trail_l, 0.85, 0.30, passes=2)
hatch(trail_r, 14, 0.4, 0.10)
hatch(trail_l, 14, 0.4, 0.10)
for x, y, s in ((330, 470, 0.7), (390, 490, 0.55), (560, 480, 0.6), (610, 500, 0.5)):
    stone(x, y, s, 0.26)

# ---------------------------------------------------------------- signpost
line((628, 462), (620, 300), 1.35, 0.60)
line((624, 462), (616, 300), 0.8, 0.28, passes=1)
board_l = [(586, 316), (650, 310), (652, 328), (588, 334)]
stroke(board_l, 1.0, 0.55, closed=True, passes=2, amp=0.35)
line((590, 323), (608, 323), 0.5, 0.30, passes=1)
line((620, 322), (640, 321), 0.5, 0.30, passes=1)
board_r = [(604, 348), (668, 354), (666, 372), (602, 366)]
stroke(board_r, 1.0, 0.55, closed=True, passes=2, amp=0.35)
line((612, 359), (634, 361), 0.5, 0.30, passes=1)
line((644, 362), (660, 363), 0.5, 0.30, passes=1)
# question mark carved on the post
stroke(quad((626, 340), (638, 332), (632, 352)), 0.9, 0.42, passes=1)
line((628, 358), (628, 361), 0.9, 0.42, passes=1)
# a little lantern hanging from the top board
line((616, 316), (608, 326), 0.6, 0.35, passes=1)
stroke([(602, 326), (614, 326), (616, 340), (600, 340)], 0.75, 0.42, closed=True, passes=1)
stroke(ellipse(608, 333, 5, 6), 0.55, 0.28, passes=1)
for a in (0.2, 0.9, 1.7, 2.6, 3.5):
    line((608 + 9 * math.cos(a), 333 + 9 * math.sin(a)),
         (608 + 14 * math.cos(a), 333 + 14 * math.sin(a)), 0.4, 0.16, passes=1)
for r in (18, 26, 36):
    stroke(ellipse(608, 333, r, r), 0.45, 0.10 if r == 18 else 0.05, passes=1)

# ---------------------------------------------------------------- undergrowth
for cx, cy, r in ((110, 455, 40), (210, 460, 32), (330, 462, 28),
                  (600, 462, 30), (720, 455, 36), (830, 460, 40)):
    bush(cx, cy, r, 0.24)
for x, y, s, lean in ((40, 520, 1.15, 0.9), (95, 535, 1.3, -0.7),
                      (160, 515, 1.0, 0.6), (230, 535, 1.25, -0.5),
                      (300, 520, 0.95, 0.8), (370, 538, 1.1, -0.6),
                      (520, 538, 1.05, 0.7), (600, 520, 1.2, -0.6),
                      (690, 538, 1.0, 0.5), (760, 515, 1.15, -0.7),
                      (830, 535, 1.25, 0.6), (875, 520, 0.9, -0.8)):
    fern(x, y, s, lean)
for x, y in ((30, 540), (80, 525), (140, 545), (200, 530), (260, 545),
             (340, 530), (410, 545), (500, 530), (560, 545), (630, 530),
             (700, 545), (760, 530), (820, 545), (875, 535)):
    grass(x, y, 0.26)
for x, y, s in ((200, 482, 0.9), (450, 484, 0.7), (580, 488, 0.8), (820, 486, 0.95)):
    stone(x, y, s)
for x, y, s in ((160, 505, 0.9), (340, 512, 0.75), (680, 515, 0.85), (785, 500, 0.7)):
    mushroom(x, y, s)
# a fallen log on the left
stroke([(120, 452), (205, 446), (238, 450), (225, 460), (135, 462), (115, 458)],
       0.9, 0.38, closed=True, passes=2, amp=0.45)
for x in (140, 160, 180, 200, 220):
    line((x, 450), (x + R.uniform(-4, 4), 460), 0.4, 0.18, passes=1)

# sparse ground hatching
for y in range(478, 548, 10):
    for x in range(50, 860, 46):
        line((x, y), (x + R.uniform(8, 18), y + R.uniform(-1, 1)),
             0.3, 0.055, passes=1)

# ---------------------------------------------------------------- rabbit
S = 1.38
def rx(x):
    return 430 + (x - 430) * S

def ry(y):
    return 430 + (y - 430) * S

# body: one closed silhouette, with the haunch as an inner contour
body = [
    (374, 384), (380, 373), (392, 366), (408, 362), (424, 361),
    (440, 362), (456, 366), (468, 372), (477, 379), (482, 389),
    (484, 399), (481, 407), (474, 413), (462, 417), (448, 418),
    (434, 418), (422, 416), (412, 414), (407, 421), (404, 429),
    (402, 436), (408, 441), (418, 443), (426, 439), (430, 431),
    (432, 421), (431, 411), (427, 401), (420, 393), (410, 388),
    (398, 386), (386, 387), (374, 384),
]
stroke([(rx(x), ry(y)) for x, y in body], 1.6, 0.78, closed=True, passes=2, amp=0.55)
# haunch contour and chest line
stroke(bezier((rx(404), ry(392)), (rx(392), ry(399)), (rx(391), ry(419)), (rx(410), ry(429))),
       1.0, 0.46, passes=1)
stroke(bezier((rx(474), ry(379)), (rx(477), ry(393)), (rx(470), ry(406)), (rx(456), ry(412))),
       0.8, 0.30, passes=1)
# tail
stroke(ellipse(rx(370), ry(390), 8 * S, 7 * S), 1.0, 0.55)
stroke(ellipse(rx(370), ry(390), 4 * S, 3.5 * S), 0.5, 0.22, passes=1)
# head and neck
stroke(bezier((rx(470), ry(372)), (rx(475), ry(363)), (rx(480), ry(356)), (rx(484), ry(351))),
       1.0, 0.45, passes=1)
stroke(ellipse(rx(486), ry(342), 26 * S, 24 * S, angle=0.12), 1.5, 0.76)
stroke(ellipse(rx(486), ry(342), 22 * S, 20 * S, angle=0.12), 0.8, 0.26, passes=1)
# ears: one upright, one bent
stroke(ellipse(rx(474), ry(286), 8.5 * S, 38 * S, angle=-0.20), 1.3, 0.68)
stroke(ellipse(rx(474), ry(286), 3.4 * S, 28 * S, angle=-0.20), 0.5, 0.24, passes=1)
stroke(ellipse(rx(504), ry(282), 8.5 * S, 42 * S, angle=0.12), 1.3, 0.68)
stroke(ellipse(rx(504), ry(282), 3.4 * S, 32 * S, angle=0.12), 0.5, 0.24, passes=1)
stroke(bezier((rx(498), ry(244)), (rx(512), ry(232)), (rx(526), ry(244)), (rx(516), ry(260))),
       0.9, 0.40, passes=1)
# face
FILLS.append((d_of(ellipse(rx(496), ry(334), 2.4 * S, 2.4 * S, n=12), closed=True), 0.92))
line((rx(505), ry(346)), (rx(512), ry(349)), 1.0, 0.60, passes=1)
line((rx(512), ry(349)), (rx(506), ry(354)), 0.65, 0.44, passes=1)
line((rx(504), ry(354)), (rx(497), ry(352)), 0.55, 0.36, passes=1)
for dy in (-3, 0, 3):
    line((rx(514), ry(348 + dy)), (rx(526), ry(345 + dy * 1.2)), 0.45, 0.30, passes=1)
line((rx(514), ry(350)), (rx(528), ry(356)), 0.45, 0.26, passes=1)
# raised front paw, scratching an ear
stroke(bezier((rx(472), ry(378)), (rx(486), ry(354)), (rx(494), ry(342)), (rx(488), ry(328))),
       1.1, 0.58)
stroke(ellipse(rx(487), ry(326), 5.5 * S, 4.5 * S, angle=0.3), 0.85, 0.50, passes=1)
# other paw holds a folded map
stroke(bezier((rx(460), ry(404)), (rx(480), ry(416)), (rx(498), ry(418)), (rx(510), ry(411))),
       1.0, 0.54)
stroke([(rx(506), ry(395)), (rx(534), ry(390)), (rx(539), ry(408)), (rx(511), ry(413))],
       0.85, 0.50, closed=True, passes=1)
line((rx(514), ry(395)), (rx(516), ry(411)), 0.45, 0.28, passes=1)
line((rx(524), ry(393)), (rx(526), ry(409)), 0.45, 0.28, passes=1)
line((rx(509), ry(403)), (rx(535), ry(399)), 0.4, 0.22, passes=1)
# scarf
stroke(bezier((rx(456), ry(362)), (rx(474), ry(368)), (rx(492), ry(364)), (rx(502), ry(356))),
       1.15, 0.56)
stroke(bezier((rx(456), ry(362)), (rx(444), ry(372)), (rx(434), ry(384)), (rx(422), ry(390))),
       0.9, 0.44, passes=1)
# cheek, forehead tuft and belly fur
stroke(bezier((rx(492), ry(338)), (rx(500), ry(342)), (rx(498), ry(350)), (rx(492), ry(352))),
       0.5, 0.26, passes=1)
line((rx(478), ry(324)), (rx(482), ry(318)), 0.5, 0.28, passes=1)
line((rx(480), ry(324)), (rx(486), ry(320)), 0.45, 0.24, passes=1)
for i in range(5):
    x = rx(438) + i * 5 * S
    y = ry(408) + math.sin(i) * 2
    line((x, y), (x + 5 * S, y + 3), 0.4, 0.16, passes=1)
# scarf stripes
for i in range(3):
    x = rx(462) + i * 8 * S
    line((x, ry(359)), (x + 3, ry(368)), 0.4, 0.28, passes=1)
# a route drawn on the map
line((rx(514), ry(400)), (rx(520), ry(397)), 0.5, 0.30, passes=1)
line((rx(520), ry(397)), (rx(524), ry(402)), 0.5, 0.30, passes=1)
line((rx(524), ry(402)), (rx(530), ry(399)), 0.5, 0.30, passes=1)
# front and hind leg contours
stroke(bezier((rx(460), ry(392)), (rx(452), ry(410)), (rx(446), ry(424)), (rx(440), ry(432))),
       0.7, 0.30, passes=1)
stroke(bezier((rx(414), ry(400)), (rx(406), ry(420)), (rx(402), ry(432)), (rx(408), ry(440))),
       0.7, 0.30, passes=1)
# toe lines
line((rx(408), ry(440)), (rx(426), ry(442)), 0.7, 0.32, passes=1)
line((rx(434), ry(417)), (rx(432), ry(431)), 0.6, 0.28, passes=1)
# fur strokes along the back and haunch
for i in range(14):
    x = rx(384) + i * 6 * S
    y = ry(369) + math.sin(i * 0.6) * 5
    line((x, y), (x + 8 * S, y + 7 * S), 0.45, 0.20, passes=1, amp=0.3)
for i in range(8):
    x = rx(374) + i * 7 * S
    y = ry(404) + math.sin(i * 0.9) * 4
    line((x, y), (x + 6 * S, y + 5 * S), 0.4, 0.18, passes=1, amp=0.3)
# ground shadow
for i in range(14):
    x = rx(360) + i * 8 * S
    line((x, ry(446)), (x + R.uniform(4, 16), ry(450) + R.uniform(-2, 2)),
         0.55, 0.18, passes=1, amp=0.4)

# a question mark above the rabbit
stroke(quad((rx(510), ry(276)), (rx(538), ry(256)), (rx(524), ry(294))), 1.1, 0.48)
line((rx(516), ry(302)), (rx(516), ry(306)), 1.0, 0.48, passes=1)

# ---------------------------------------------------------------- air
# crescent moon with a few craters
stroke(ellipse(118, 86, 22, 22, a0=-1.2, a1=1.9), 1.0, 0.38)
stroke(ellipse(108, 92, 18, 18, a0=-1.0, a1=1.2), 0.85, 0.32)
for x, y, r in ((120, 80, 3), (112, 94, 2), (126, 94, 1.6)):
    stroke(ellipse(x, y, r, r), 0.5, 0.20, passes=1)
# stars and fireflies
for x, y in ((160, 60), (205, 108), (690, 118), (820, 92), (600, 96),
             (540, 60), (300, 120), (860, 160)):
    line((x - 3, y), (x + 3, y), 0.5, 0.20, passes=1)
    line((x, y - 3), (x, y + 3), 0.5, 0.20, passes=1)
for x, y in ((340, 300), (590, 250), (630, 300), (250, 260), (740, 330)):
    stroke(ellipse(x, y, 2.2, 2.2), 0.5, 0.35, passes=1)
    line((x - 4, y), (x + 4, y), 0.35, 0.18, passes=1)
    line((x, y - 4), (x, y + 4), 0.35, 0.18, passes=1)
# falling leaves
for x, y, a in ((560, 250, 0.5), (600, 300, -0.8), (300, 280, 0.2),
                (720, 260, -0.4), (250, 210, 0.9), (680, 200, 0.3),
                (520, 210, -0.6)):
    leaf(x, y, 7.5, a, 0.55, 0.28)

# ---------------------------------------------------------------- output
defs = """  <defs>
    <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>"""
paths = "\n".join(f'    <path d="{d}" stroke-width="{w:.2f}" opacity="{o:.2f}"/>'
                  for d, w, o in STROKES)
fills = "\n".join(f'    <path d="{d}" fill="#3b414a" stroke="none" opacity="{o:.2f}"/>'
                  for d, o in FILLS)
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560" role="img" aria-labelledby="title">
  <title id="title">A pencil sketch of a rabbit lost at a fork in a forest</title>
  <desc>Generated by tools/draw_404_rabbit.py; deterministic seed 20261110.</desc>
{defs}
  <g filter="url(#pencil)" fill="none" stroke="#3b414a" stroke-linecap="round" stroke-linejoin="round">
{fills}
{paths}
  </g>
</svg>
'''
OUT.write_text(svg, encoding="utf-8", newline="\n")
print(f"wrote {OUT} ({len(STROKES)} strokes, {len(FILLS)} fills)")
