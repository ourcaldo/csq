"""Compose all 10 flow-diagram PNGs into one tall image with section titles.

Output: docs/diagrams/00-csq-all-flows.png
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
DIAG = ROOT / "docs" / "diagrams"
OUT = DIAG / "00-csq-all-flows.png"

SECTIONS = [
    ("1 · Architecture — four layers", "01-architecture.png"),
    ("2 · Inbound WhatsApp message → AI reply (core loop)", "02-inbound-message-loop.png"),
    ("3 · Tool Gateway — permission, approval, audit", "03-tool-gateway.png"),
    ("4 · Data ingestion + source-priority arbitration", "04-data-ingestion.png"),
    ("5 · Inbox CRM — handoff & assignment", "05-inbox-handoff.png"),
    ("6 · Scenario automation — triggers → engine → nodes", "06-scenario-automation.png"),
    ("7 · Knowledge semantic search (bge-m3 + pgvector)", "07-semantic-search.png"),
    ("8 · Channel onboarding — Cloud API / Baileys QR", "08-channel-onboarding.png"),
    ("9 · Pipeline — deal stages", "09-pipeline.png"),
    ("10 · Deployment topology (VPS)", "10-deployment-topology.png"),
]

WIDTH = 1800
MARGIN = 60
CONTENT_W = WIDTH - 2 * MARGIN
TITLE_H = 70
GAP = 40
HEADER_H = 150

FONTS = Path("C:/Windows/Fonts")
title_font = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 34)
header_font = ImageFont.truetype(str(FONTS / "segoeuib.ttf"), 52)
sub_font = ImageFont.truetype(str(FONTS / "segoeui.ttf"), 26)
GREEN = (21, 128, 61)
INK = (15, 23, 42)


def fit(img: Image.Image, max_w: int) -> Image.Image:
    if img.width <= max_w:
        return img
    h = round(img.height * max_w / img.width)
    return img.resize((max_w, h), Image.LANCZOS)


# Pass 1: measure
rendered = []
for title, fname in SECTIONS:
    img = Image.open(DIAG / fname).convert("RGBA")
    img = fit(img, CONTENT_W)
    rendered.append((title, img))

total_h = HEADER_H + sum(TITLE_H + img.height + GAP for _, img in rendered) + MARGIN
canvas = Image.new("RGB", (WIDTH, total_h), (250, 250, 248))
draw = ImageDraw.Draw(canvas)

# Header
draw.text((MARGIN, 40), "CSQ — Complete Flow Diagrams", font=header_font, fill=INK)
draw.text((MARGIN, 105), "AI Agent WhatsApp untuk UMKM · all features · 2026-09-19 · commit abee816", font=sub_font, fill=(100, 116, 139))

y = HEADER_H
for title, img in rendered:
    draw.text((MARGIN, y), title, font=title_font, fill=GREEN)
    y += TITLE_H - 18
    # paste with white backing (kroki PNGs can be transparent)
    backing = Image.new("RGB", img.size, (255, 255, 255))
    backing.paste(img, (0, 0), img)
    x = MARGIN + (CONTENT_W - img.width) // 2
    canvas.paste(backing, (x, y))
    y += img.height + GAP

canvas.save(OUT, optimize=True)
print(f"ok {OUT} ({canvas.width}x{canvas.height}, {OUT.stat().st_size // 1024} KB)")
