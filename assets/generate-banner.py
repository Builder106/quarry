# /// script
# requires-python = ">=3.11"
# dependencies = ["fonttools>=4.50", "uharfbuzz>=0.39"]
# ///
"""Draw the README banner from the compiled executor runtime.

The banner prints every byte of the deployed runtime as a hex dump, so it
has to be redrawn whenever Executor.yul changes:

    forge build                      # in contracts/
    uv run assets/generate-banner.py contracts/out/Executor.yul/QuarryExecutor.json FONTS_DIR assets/

FONTS_DIR holds the variable fonts the site uses, from github.com/google/fonts:
BigShoulders.ttf, IBMPlexSans.ttf and JetBrainsMono.ttf. All text is outlined
to paths because GitHub renders the SVG as an <img>, which can't load fonts.
"""

import json
import sys
from pathlib import Path

import uharfbuzz as hb
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

W, H = 1200, 420
LEFT, RIGHT = 72, 1128
COLS = 41  # 492 B = 12 rows of 41

THEMES = {
    "dark": {
        "bg": "#14110d",
        "wordmark": "#ededed",
        "tagline": "#b8a888",
        "caption": "#8f7f65",
        "offset": "#4a3d2a",
        "opcode": "#8a7a60",
        "data": "#4f4433",
        "call": "#d4923a",
        "revert": "#c4622e",
    },
    "light": {
        "bg": "#f4f4f4",
        "wordmark": "#14110d",
        "tagline": "#4a3d2a",
        "caption": "#6b5d48",
        "offset": "#c2b8a8",
        "opcode": "#8a7a60",
        "data": "#c9c0b2",
        "call": "#a36b1d",
        "revert": "#b0501f",
    },
}

CALLS = {0xF1, 0xFA}  # CALL, STATICCALL
REVERT = 0xFD


def num(v: float) -> str:
    return f"{v:.1f}".rstrip("0").rstrip(".")


class Face:
    def __init__(self, path: Path, axes: dict[str, float]) -> None:
        self.hb = hb.Font(hb.Face(hb.Blob.from_file_path(str(path))))
        self.hb.set_variations(axes)
        tt = instantiateVariableFont(TTFont(path), axes)
        self.glyphs = tt.getGlyphSet()
        self.order = tt.getGlyphOrder()
        self.upem = tt["head"].unitsPerEm
        self.cap = tt["OS/2"].sCapHeight

    def size_for_cap(self, cap_px: float) -> float:
        return cap_px * self.upem / self.cap

    def run(self, text: str, size: float) -> tuple[list[tuple[str, float]], float]:
        """Shape text; return (glyph name, x offset in px) pairs and the width."""
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(self.hb, buf)
        scale = size / self.upem
        placed: list[tuple[str, float]] = []
        x = 0
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            placed.append((self.order[info.codepoint], (x + pos.x_offset) * scale))
            x += pos.x_advance
        return placed, x * scale

    def outline(self, name: str, size: float, x: float, y: float) -> str:
        pen = SVGPathPen(self.glyphs, ntos=num)
        s = size / self.upem
        self.glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, x, y)))
        return pen.getCommands()

    def text(self, text: str, size: float, x: float, y: float) -> tuple[str, float]:
        placed, width = self.run(text, size)
        return "".join(self.outline(n, size, x + dx, y) for n, dx in placed), width


def classify(code: bytes) -> list[str]:
    """Walk the bytecode so PUSH immediates aren't mistaken for opcodes."""
    kinds: list[str] = []
    i = 0
    while i < len(code):
        op = code[i]
        if op in CALLS:
            kinds.append("call")
        elif op == REVERT:
            kinds.append("revert")
        else:
            kinds.append("opcode")
        i += 1
        if 0x60 <= op <= 0x7F:
            n = min(op - 0x5F, len(code) - i)
            kinds.extend(["data"] * n)
            i += n
    return kinds


def build(theme: dict[str, str], code: bytes, fonts: Path) -> str:
    display = Face(fonts / "BigShoulders.ttf", {"wght": 900, "opsz": 72})
    sans = Face(fonts / "IBMPlexSans.ttf", {"wght": 400, "wdth": 100})
    mono = Face(fonts / "JetBrainsMono.ttf", {"wght": 400})
    mono_bold = Face(fonts / "JetBrainsMono.ttf", {"wght": 700})

    rows = -(-len(code) // COLS)
    cw = (RIGHT - LEFT) / (4 + 3 + COLS * 3 - 1)
    mono_size = cw * mono.upem / 600
    line = 15.5
    dump_top = H - 36 - (rows - 1) * line

    wordmark, _ = display.text("QUARRY", display.size_for_cap(92), LEFT - 4, 136)
    tagline, _ = sans.text("A bare-metal MEV arbitrage simulator.", 22, LEFT, 174)

    caption_parts = [
        (f"The full executor runtime, {len(code)} bytes. ", "caption"),
        ("Calls", "call"),
        (" in gold, the ", "caption"),
        ("revert", "revert"),
        (" in red.", "caption"),
    ]
    widths = [sans.run(t, 13)[1] for t, _ in caption_parts]
    x = RIGHT - sum(widths)
    caption: dict[str, str] = {}
    for (t, kind), w in zip(caption_parts, widths):
        d, _ = sans.text(t, 13, x, 174)
        caption[kind] = caption.get(kind, "") + d
        x += w

    defs = []
    for prefix, face in (("r", mono), ("b", mono_bold)):
        for ch in "0123456789abcdef":
            name = face.run(ch, mono_size)[0][0][0]
            defs.append(f'<path id="{prefix}{ch}" d="{face.outline(name, mono_size, 0, 0)}"/>')

    dump = []
    kinds = classify(code)
    for r in range(rows):
        y = dump_top + r * line
        uses = [
            f'<use href="#r{ch}" x="{num(LEFT + i * cw)}" class="offset"/>'
            for i, ch in enumerate(f"{r * COLS:04x}")
        ]
        for c, byte in enumerate(code[r * COLS : (r + 1) * COLS]):
            kind = kinds[r * COLS + c]
            weight = "r" if kind in ("opcode", "data") else "b"
            for k, ch in enumerate(f"{byte:02x}"):
                bx = LEFT + (7 + c * 3 + k) * cw
                uses.append(f'<use href="#{weight}{ch}" x="{num(bx)}" class="{kind}"/>')
        dump.append(f'<g transform="translate(0 {num(y)})">{"".join(uses)}</g>')

    caption_paths = "\n".join(
        f'<path fill="{theme[kind]}" d="{d}"/>' for kind, d in caption.items()
    )
    style = "".join(
        f".{k}{{fill:{theme[k]}}}" for k in ("offset", "opcode", "data", "call", "revert")
    )
    nl = "\n"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" role="img" aria-label="Quarry: a bare-metal MEV arbitrage simulator. Hex dump of the {len(code)}-byte executor runtime.">
<title>Quarry</title>
<!-- Generated by assets/generate-banner.py from the compiled runtime. -->
<style>{style}</style>
<defs>
{nl.join(defs)}
</defs>
<rect width="{W}" height="{H}" fill="{theme["bg"]}"/>
<path fill="{theme["wordmark"]}" d="{wordmark}"/>
<path fill="{theme["tagline"]}" d="{tagline}"/>
{caption_paths}
{nl.join(dump)}
</svg>
"""


def main() -> None:
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    artifact, fonts, out = (Path(a) for a in sys.argv[1:])
    code = bytes.fromhex(json.loads(artifact.read_text())["deployedBytecode"]["object"][2:])
    for name, theme in THEMES.items():
        (out / f"banner-{name}.svg").write_text(build(theme, code, fonts))
    print(f"{len(code)} bytes of runtime drawn")


if __name__ == "__main__":
    main()
