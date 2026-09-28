#!/usr/bin/env python3
"""
Build the self-hosted font subsets in public/fonts/.

The pre-split files from Google Fonts and Fontsource drop the super- and subscripts,
arrows and maths symbols the cryptography posts use, so this subsets the full fonts itself.
Re-run it after writing a post with new special characters; it reports anything the fonts lack.

Requires: pip install fonttools brotli
Usage:    python3 scripts/build-fonts.py
"""

import glob
import io
import re
import urllib.request
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'fonts'

# Pinned so that a rebuild produces the same files
SOURCE = 'https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/'

# Latin, Latin-1, typographic punctuation and a few symbols: enough for headings, navigation and the tools
UI = {
    *range(0x20, 0x7F), *range(0xA0, 0x100), 0x152, 0x153, 0x160, 0x161, 0x178, 0x17D, 0x17E, 0x2C6, 0x2DC,
    *range(0x2010, 0x2028), *range(0x2030, 0x203B), 0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2197, 0x2212,
}

# Running text also needs Greek, super- and subscripts, arrows, maths operators and combining accents
TEXT = UI | {
    *range(0x300, 0x370), *range(0x370, 0x400), *range(0x2070, 0x20A0), *range(0x2190, 0x2200),
    *range(0x2200, 0x2300), 0x2026, 0x2032, 0x2033, 0x2113,
}

FONTS = [
    # (file in google/fonts, output file, axes to keep, characters)
    ('atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext[wght].ttf', 'atkinson-next.woff2', {'wght': (400, 700)}, UI),
    ('atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext-Italic[wght].ttf', 'atkinson-next-italic.woff2', {'wght': (400, 700)}, UI),
    ('sourceserif4/SourceSerif4[opsz,wght].ttf', 'source-serif-4.woff2', {'wght': (400, 700), 'opsz': 20}, TEXT),
    ('sourceserif4/SourceSerif4-Italic[opsz,wght].ttf', 'source-serif-4-italic.woff2', {'wght': (400, 700), 'opsz': 20}, TEXT),
]


def post_characters() -> set[int]:
    """Every non-ASCII character in the posts' running text (code blocks use the system monospace font)."""
    chars = set()
    for path in glob.glob(str(ROOT / 'src/content/blog/**/*.md*'), recursive=True):
        text = re.sub(r'```.*?```', '', Path(path).read_text(encoding='utf-8'), flags=re.S)
        chars |= {ord(c) for c in text if ord(c) > 0x7F}
    return chars


def build(source: str, output: str, axes: dict, unicodes: set[int]) -> set[int]:
    url = SOURCE + source.replace('[', '%5B').replace(']', '%5D')
    font = TTFont(io.BytesIO(urllib.request.urlopen(url).read()), lazy=False)
    font = instancer.instantiateVariableFont(font, axes)

    # Reload before subsetting: subsetting the instanced font in memory fails on its glyph variations
    buffer = io.BytesIO()
    font.save(buffer)
    buffer.seek(0)
    font = TTFont(buffer, lazy=False)

    options = subset.Options()
    options.flavor = 'woff2'
    options.layout_features = ['*']
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = ['*']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    font.flavor = 'woff2'
    font.save(OUT / output)
    return set(font.getBestCmap())


def main() -> None:
    needed = post_characters()
    for source, output, axes, unicodes in FONTS:
        is_text_font = unicodes is TEXT
        covered = build(source, output, axes, unicodes | needed if is_text_font else unicodes)
        print(f'{output:30s} {(OUT / output).stat().st_size // 1024:4d} KB')
        missing = ''.join(sorted(chr(c) for c in needed - covered)) if is_text_font else ''
        if missing:
            print(f'  not in this font, browsers fall back to a system font: {missing}')


if __name__ == '__main__':
    main()
