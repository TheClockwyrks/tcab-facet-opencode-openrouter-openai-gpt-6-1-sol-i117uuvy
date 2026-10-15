"""One-time Facet asset production. Requires the six authoring binaries.

The application build never runs this script. All finished media are committed.
"""
import colorsys
import json
import math
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"
WORK = Path("/tmp/opencode/facet-production")
WORK.mkdir(parents=True, exist_ok=True)
for d in ["gems", "audio", "fx"]:
    (OUT / d).mkdir(parents=True, exist_ok=True)


def run(*args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)


def dump(path, value):
    path.write_text(json.dumps(value))


class Canvas:
    def __init__(self, w=64, h=64):
        self.w, self.h = w, h
        self.pixels = {}

    def rect(self, x, y, w, h, color):
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                if 0 <= xx < self.w and 0 <= yy < self.h:
                    self.pixels[xx, yy] = color

    def poly(self, points, color):
        for y in range(max(0, int(min(p[1] for p in points))), min(self.h, int(max(p[1] for p in points)) + 1)):
            xs = []
            for i, (x1, y1) in enumerate(points):
                x2, y2 = points[(i + 1) % len(points)]
                if min(y1, y2) <= y + .5 < max(y1, y2):
                    xs.append(x1 + (y + .5 - y1) / (y2 - y1) * (x2 - x1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                self.rect(math.ceil(xs[i]), y, math.floor(xs[i + 1]) - math.ceil(xs[i]) + 1, 1, color)

    def line(self, points, color, thickness=1):
        for a, b in zip(points, points[1:]):
            n = max(abs(round(a[0] - b[0])), abs(round(a[1] - b[1])), 1)
            for i in range(n + 1):
                self.rect(round(a[0] + (b[0] - a[0]) * i / n), round(a[1] + (b[1] - a[1]) * i / n), thickness, thickness, color)

    def emit(self, target, sheet=False):
        target.parent.mkdir(parents=True, exist_ok=True)
        ops = []
        for y in range(self.h):
            x = 0
            while x < self.w:
                color = self.pixels.get((x, y))
                end = x + 1
                while end < self.w and self.pixels.get((end, y)) == color:
                    end += 1
                if color:
                    ops.append({"op": "fill_rect", "x": x, "y": y, "width": end - x, "height": 1, "color": color})
                x = end
        log = WORK / "pixels.json"
        dump(log, ops)
        run("draw-sheet" if sheet else "draw", "render", "--actions", log, "--out", target, "--width", self.w, "--height", self.h, "--no-layers")


KINDS = ["ruby", "amber", "citrine", "jade", "beryl", "sapphire", "amethyst"]
HUES = [.972, .065, .135, .405, .503, .615, .762]
SHAPES = [
    [(32, 5), (54, 21), (51, 43), (32, 58), (13, 43), (10, 21)],
    [(20, 9), (44, 9), (57, 30), (44, 53), (20, 53), (7, 30)],
    [(32, 3), (56, 32), (32, 61), (8, 32)],
    [(18, 11), (46, 11), (53, 18), (53, 46), (46, 53), (18, 53), (11, 46), (11, 18)],
    [(32, 4), (49, 16), (54, 33), (45, 51), (32, 60), (19, 51), (10, 33), (15, 16)],
    [(22, 7), (42, 7), (55, 20), (55, 42), (42, 55), (22, 55), (9, 42), (9, 20)],
    [(32, 5), (57, 44), (49, 52), (15, 52), (7, 44)],
]


def color(h, light, saturation=.78):
    r, g, b = colorsys.hls_to_rgb(h % 1, light, saturation)
    return "#%02x%02x%02xff" % (int(r * 255), int(g * 255), int(b * 255))


def gem(k, strain=0, turn=0):
    c = Canvas()
    prism = k == 7
    shape = SHAPES[2] if prism else SHAPES[k]
    if prism:
        shape = [(32 + (x - 32) * (.80 + .20 * math.cos(turn)), y) for x, y in shape]
    hue = .50 if prism else HUES[k]
    c.poly(shape, color(hue, .12))
    outer = [(32 + (x - 32) * .94, 31 + (y - 31) * .94) for x, y in shape]
    inner = [(32 + (x - 32) * .56, 31 + (y - 31) * .56) for x, y in shape]
    for i in range(len(shape)):
        j = (i + 1) % len(shape)
        h = i / len(shape) + turn / 6 if prism else hue
        light = [.78, .49, .28, .34, .55, .68, .48, .66][i]
        c.poly([outer[i], outer[j], inner[j], inner[i]], color(h, light, .48 if prism else .78))
        c.line([outer[i], inner[i]], color(h, min(.92, light + .10), .65))
    c.poly(inner, color(hue + turn / 8, .57, .2 if prism else .72))
    center = (29 + 3 * math.sin(turn), 27)
    for i in range(0, len(inner), 2):
        c.poly([center, inner[i], inner[(i + 1) % len(inner)]], color((i / 8 + turn / 5) if prism else hue, .68 if i < 3 else .42, .4 if prism else .72))
    c.line([outer[-1], outer[0], outer[1]], color(hue, .88, .48))
    c.rect(21, 17, 7, 2, "#ffffffb0")
    c.rect(20, 19, 3, 4, "#ffffff80")
    if strain:
        cracks = [[(33, 10), (29, 23), (35, 30), (28, 40)], [(35, 30), (44, 28), (50, 36)], [(28, 40), (34, 48), (30, 55)]]
        if strain >= 2:
            cracks += [[(29, 23), (21, 28), (12, 26)], [(35, 30), (37, 40), (48, 46)]]
        if strain == 3:
            cracks += [[(18, 17), (22, 29), (17, 43)], [(44, 16), (40, 24), (44, 28)]]
        for pts in cracks:
            c.line(pts, "#151320ff", 2 if strain == 3 else 1)
            c.line([(x + 1, y) for x, y in pts], "#ffe3b9ff" if strain == 3 else "#ecf7ffb0")
        if strain == 3:
            for x, y in [(8, 31), (55, 31), (31, 4), (31, 58)]:
                c.rect(x, y, 3, 3, "#ffe8c2ff")
    return c


def art():
    for k, name in enumerate(KINDS + ["prism"]):
        for strain in range(4):
            gem(k, strain).emit(OUT / "gems" / f"{name}-{strain}.png")
    for k, name in enumerate(KINDS):
        base = gem(k)
        for frame in range(6):
            c = Canvas()
            for (x, y), rgba in base.pixels.items():
                # Four irregular fracture planes, flying outward independently.
                sector = (0 if x < 31 + (y - 32) * .17 else 1) + (0 if y < 30 - (x - 32) * .2 else 2)
                dx = (-1 if sector % 2 == 0 else 1) * frame * 3
                dy = (-1 if sector < 2 else 1) * frame * 3 + frame * frame // 4
                if (x + y + sector) % (9 - frame) != 0 and (frame < 4 or (x + y) % 3):
                    c.rect(x + dx, y + dy, 1, 1, rgba[:7] + f"{max(0, 255 - frame * 37):02x}")
            c.emit(OUT / "gems/break" / name / f"{frame}.png", True)
    for f in range(12):
        gem(7, turn=f * math.tau / 12).emit(OUT / "gems/prism-turn" / f"{f}.png", True)
    c = Canvas()
    c.line([(32, 5), (58, 32), (32, 58), (5, 32), (32, 5)], "#fff0bdff", 1)
    c.line([(32, 10), (53, 32), (32, 53), (10, 32), (32, 10)], "#f9cb7070")
    for x, y in [(32, 6), (57, 32), (32, 57), (6, 32)]:
        c.line([(x - 3, y), (x + 3, y)], "#ffffffff")
        c.line([(x, y - 3), (x, y + 3)], "#ffffffff")
    c.emit(OUT / "gems/brilliant.png")
    c = Canvas()
    pts = []
    for n in range(16):
        r = 28 if n % 2 == 0 else 14
        a = n * math.tau / 16 - math.pi / 2
        pts.append((32 + r * math.cos(a), 32 + r * math.sin(a)))
    c.line(pts + [pts[0]], "#ffffdcff")
    c.line([(32, 12), (32, 52)], "#ffffb4cc")
    c.line([(12, 32), (52, 32)], "#ffffb4cc")
    c.emit(OUT / "gems/star.png")
    c = Canvas(608, 608)
    c.rect(0, 0, 608, 608, "#050d12ff")
    c.rect(2, 2, 604, 604, "#31444aff")
    c.rect(4, 4, 600, 600, "#101f25ff")
    c.rect(8, 8, 592, 592, "#7c7561ff")
    c.rect(9, 9, 590, 590, "#182a30ff")
    c.rect(15, 15, 578, 578, "#071218ff")
    for row in range(8):
        for col in range(8):
            x, y = 18 + col * 72, 18 + row * 72
            c.rect(x, y, 68, 68, "#13242bff" if (row + col) % 2 else "#15272eff")
            c.rect(x + 2, y + 2, 64, 1, "#21353cff")
            c.rect(x + 3, y + 3, 62, 60, "#102128ff" if (row + col) % 2 else "#12252cff")
            c.line([(x + 1, y + 9), (x + 1, y + 1), (x + 9, y + 1)], "#34434aff")
            c.rect(x + 31, y + 32, 2, 2, "#264047ff")
    for x, y in [(5, 5), (589, 5), (5, 589), (589, 589)]:
        c.poly([(x, y + 6), (x + 6, y), (x + 12, y + 6), (x + 6, y + 12)], "#c9b58aff")
        c.rect(x + 5, y + 4, 3, 4, "#f1dfb6ff")
    c.emit(OUT / "gems/board-frame.png")


def config(name, duration=900, **extra):
    path = WORK / f"{name}.json"
    dump(path, {"sample_rate": 44100, "channels": "stereo", "max_duration_ms": duration, "seed": 914, "actions": str(WORK / f"{name}-ops.json"), "preview": str(WORK / f"{name}-preview.png"), "wav": str(OUT / "audio" / f"{name}.wav"), "mid": str(OUT / "audio" / f"{name}.mid"), **extra})
    return path


def synth():
    recipes = {"select": [(980, 0, 65, -22), (1960, 0, 40, -32)], "swap": [(390, 0, 90, -22), (780, 40, 100, -24)], "refuse": [(125, 0, 130, -19), (132, 0, 90, -25)], "land": [(72, 0, 160, -18), (145, 5, 85, -26)], "flaw": [(1700, 0, 45, -25), (270, 0, 80, -24)], "cut": [(1046, 0, 340, -24), (1568, 45, 270, -26), (2093, 80, 300, -28)], "levelup": [(523, 0, 320, -24), (659, 100, 350, -24), (784, 200, 400, -24), (1046, 300, 450, -24)], "gameover": [(523, 0, 240, -23), (440, 160, 260, -24), (349, 320, 300, -24), (261, 480, 380, -25)]}
    for n, freq in enumerate([523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5]):
        recipes[f"chain-{n + 1}"] = [(freq, 0, 280, -22), (freq * 2.003, 0, 140, -33), (freq * 3, 0, 75, -39)]
    for name, voices in recipes.items():
        cfg = config(name, 1100 if name in ["levelup", "gameover"] else 600)
        run("sfx-synth", "--config", cfg, "init")
        for i, (freq, start, dur, gain) in enumerate(voices):
            run("sfx-synth", "--config", cfg, "add-voice", "--name", f"v{i}", "--wave", "triangle" if name in ["swap", "refuse", "land"] else "sine", "--freq", freq, "--start", start, "--dur", dur, "--gain", gain)
            run("sfx-synth", "--config", cfg, "set-envelope", "--voice", f"v{i}", "--env", "pluck")
        if name in ["land", "flaw", "refuse"]:
            run("sfx-synth", "--config", cfg, "add-voice", "--name", "grit", "--wave", "noise", "--dur", 55, "--gain", -35)
            run("sfx-synth", "--config", cfg, "set-envelope", "--voice", "grit", "--env", "pluck")
        run("sfx-synth", "--config", cfg, "render")
    cfg = config("shatter", 800, sample_pack="combat-core")
    run("sfx-sample", "--config", cfg, "init")
    run("sfx-sample", "--config", cfg, "add-sample", "--name", "debris_glass", "--t", 0, "--gain", -21, "--fade-out", 180)
    run("sfx-sample", "--config", cfg, "add-sample", "--name", "snap_transient", "--t", 0, "--gain", -29)
    run("sfx-sample", "--config", cfg, "render")


def music():
    for name, tempo in [("title", 108), ("play", 80)]:
        cfg = config(name, round(32 * 60000 / tempo), instrument_bank="gm-lite")
        run("music", "--config", cfg, "init")
        run("music", "--config", cfg, "set-tempo", "--bpm", tempo)
        for track, instrument, gain, pan in [("hook", "music_box" if name == "title" else "vibraphone", -24, -.20), ("arp", "marimba", -31, .3), ("bell", "glockenspiel", -36, .1)]:
            run("music", "--config", cfg, "define-track", "--name", track, "--instrument", instrument)
            run("music", "--config", cfg, "set-track-fx", "--track", track, "--gain", gain, "--pan", pan, "--reverb", .25, "--env", "pluck")
        chords = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]] * 2
        hook = [81, 76, 79, 81, 84, 83, 79, 76, 77, 81, 79, 76, 74, 72, 76, 79]
        for bar, chord in enumerate(chords):
            for n in range(8):
                run("music", "--config", cfg, "add-note", "--track", "arp", "--pitch", chord[n % 4], "--t", bar * 4 + n * .5, "--dur", .8, "--velocity", 58 if n % 2 else 70)
            for n in range(2):
                pitch = hook[(bar * 2 + n) % len(hook)]
                run("music", "--config", cfg, "add-note", "--track", "hook", "--pitch", pitch - (12 if name == "play" else 0), "--t", bar * 4 + n * 1.5, "--dur", 1.25, "--velocity", 62)
            if bar % 2 == 0:
                run("music", "--config", cfg, "add-note", "--track", "bell", "--pitch", chord[2] + 24, "--t", bar * 4 + 3, "--dur", .7, "--velocity", 45)
        run("music", "--config", cfg, "render")


def particles():
    for name, count, speed, life, size, palette in [
        ("clear", 13, 52, 350, 2.3, "#fff1c8@0,#78ddd9@0.3,#36737d@1"),
        ("flawed", 32, 110, 590, 3.7, "#ffffff@0,#ffc580@0.3,#ff6a66@1"),
        ("cut", 24, 75, 650, 3, "#ffffff@0,#fbe0a1@0.4,#a891d5@1"),
        ("aura", 7, 12, 1000, 1.6, "#e7ffff@0,#c7dcba@0.5,#8172a2@1"),
    ]:
        folder = OUT / "fx" / name
        folder.mkdir(parents=True, exist_ok=True)
        cfg = WORK / f"fx-{name}.json"
        dump(cfg, {"width": 128, "height": 128, "duration_ms": 1400, "fps": 30, "actions": str(WORK / f"fx-{name}-ops.json"), "preview": str(WORK / f"fx-{name}.png"), "system": str(folder / "system.json")})
        run("particle-2d", "--config", cfg, "init")
        run("particle-2d", "--config", cfg, "add-emitter", "--name", "sparks", "--shape", "disc", "--radius", 23 if name == "aura" else 3, "--x", 0, "--y", 0, "--rate" if name == "aura" else "--burst", count, "--lifetime", life, "--lifetime-spread", 100, "--speed", speed, "--speed-spread", speed / 3, "--cone-angle", 180)
        run("particle-2d", "--config", cfg, "set-particle", "--emitter", "sparks", "--size-curve", "ease-out", "--size-from", size, "--size-to", .1, "--opacity-from", .85, "--opacity-to", 0, "--color-gradient", palette, "--stretch", 1.3)
        run("particle-2d", "--config", cfg, "set-forces", "--gravity", 55 if name != "aura" else -5, "--drag", 2)
        if name == "aura":
            run("particle-2d", "--config", cfg, "set-timeline", "--loop", "true")
        run("particle-2d", "--config", cfg, "render", "--frame", 8, "--out", WORK / f"fx-{name}.png")


if __name__ == "__main__":
    import sys
    for section in sys.argv[1:] or ["art", "synth", "music", "particles"]:
        globals()[section]()
        print(f"Produced {section}.", flush=True)
