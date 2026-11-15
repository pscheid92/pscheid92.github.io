#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools", "brotli"]
# ///
"""
Build the self-hosted font subsets in public/fonts/.

The pre-split files from Google Fonts and Fontsource drop the super- and subscripts,
arrows and maths symbols the cryptography posts use, so this subsets the full fonts itself.
Re-run it after writing a post with new special characters; it reports what no font covers.

The site is set in IBM Plex. Plex Serif has no Greek alphabet, so the reading text takes
its Greek letters from Plex Sans, the next family in --font-text (src/styles/global.css).

Usage:  uv run scripts/build-fonts.py
        (without uv: pip install fonttools brotli, then python3 scripts/build-fonts.py)
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

GREEK = set(range(0x370, 0x400))
BOX_DRAWING = set(range(0x2500, 0x2580))

CODE_BLOCK = re.compile(r'```.*?```', re.S)
INLINE_CODE = re.compile(r'`[^`\n]+`')


def non_ascii(text: str) -> set[int]:
    return {ord(c) for c in text if ord(c) > 0x7F}


def content_characters() -> tuple[set[int], set[int]]:
    """Non-ASCII characters in the posts and project pages, as (running text, code)."""
    text, code = set(), set()
    for path in glob.glob(str(ROOT / 'src/content/**/*.md*'), recursive=True):
        raw = Path(path).read_text(encoding='utf-8')
        without_blocks = CODE_BLOCK.sub('', raw)
        code |= non_ascii(''.join(CODE_BLOCK.findall(raw) + INLINE_CODE.findall(without_blocks)))
        text |= non_ascii(INLINE_CODE.sub('', without_blocks))
    return text, code


def page_characters() -> set[int]:
    """Non-ASCII characters in pages, layouts and components: the tools use symbols such as Δ and ≥."""
    paths = glob.glob(str(ROOT / 'src/**/*.astro'), recursive=True)
    return non_ascii(''.join(Path(path).read_text(encoding='utf-8') for path in paths))


def build(source: str, output: str, unicodes: set[int], axes: dict | None = None) -> set[int]:
    """Subset one font to the given characters and return the characters it covers."""
    url = SOURCE + source.replace('[', '%5B').replace(']', '%5D')
    font = TTFont(io.BytesIO(urllib.request.urlopen(url).read()), lazy=False)

    if axes:
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
    # Plex carries a 'meta' table (its design languages) that the subsetter cannot cut down
    options.drop_tables += ['meta']
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    font.flavor = 'woff2'
    font.save(OUT / output)
    print(f'{output:34s} {(OUT / output).stat().st_size // 1024:4d} KB')
    return set(font.getBestCmap())


def listed(characters: set[int]) -> str:
    return ' '.join(chr(c) for c in sorted(characters))


def main() -> None:
    text, code = content_characters()
    pages = page_characters()

    # Headings, contents lists and the tools are set in the sans, and the reading text falls back to it,
    # so it gets every character the site uses. It ships at weights 400 to 600 only: every bold on the
    # site is Plex SemiBold.
    sans = UI | pages | text
    sans_axes = {'wght': (400, 600), 'wdth': 100}

    # Plex Serif and Plex Mono contain one Greek letter, π. Leaving the whole alphabet out of both
    # keeps the Greek in a formula in one typeface: Plex Sans.
    serif = (TEXT | text) - GREEK
    mono = (UI | BOX_DRAWING | code) - GREEK

    sans_covers = build('ibmplexsans/IBMPlexSans[wdth,wght].ttf', 'plex-sans.woff2', sans, sans_axes)
    build('ibmplexsans/IBMPlexSans-Italic[wdth,wght].ttf', 'plex-sans-italic.woff2', sans, sans_axes)
    serif_covers = build('ibmplexserif/IBMPlexSerif-Regular.ttf', 'plex-serif.woff2', serif)
    build('ibmplexserif/IBMPlexSerif-Italic.ttf', 'plex-serif-italic.woff2', serif)
    build('ibmplexserif/IBMPlexSerif-SemiBold.ttf', 'plex-serif-semibold.woff2', serif)
    build('ibmplexserif/IBMPlexSerif-SemiBoldItalic.ttf', 'plex-serif-semibold-italic.woff2', serif)
    mono_covers = build('ibmplexmono/IBMPlexMono-Regular.ttf', 'plex-mono.woff2', mono)

    print()
    print(f'running text takes these from Plex Sans: {listed((text & sans_covers) - serif_covers) or "nothing"}')
    for label, missing in [
        ('running text', text - serif_covers - sans_covers),
        ('code', code - mono_covers),
        ('pages and tools', pages - sans_covers),
    ]:
        if missing:
            print(f'{label}: in none of the fonts, browsers fall back to a system font: {listed(missing)}')


if __name__ == '__main__':
    main()
