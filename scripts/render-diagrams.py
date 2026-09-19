"""Render the single CSQ flow (docs/2026-09-19-csq-flow-diagram.md) to PNG via kroki."""

import re
import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
MD = ROOT / "docs" / "2026-09-19-csq-flow-diagram.md"
DEST = ROOT / "docs" / "diagrams" / "csq-flow.png"
DEST.parent.mkdir(parents=True, exist_ok=True)

blocks = re.findall(r"```mermaid\r?\n(.*?)```", MD.read_text(encoding="utf-8"), re.S)
assert len(blocks) == 1, f"expected exactly 1 mermaid block, found {len(blocks)}"
req = urllib.request.Request(
    "https://kroki.io/mermaid/png",
    data=blocks[0].strip().encode("utf-8"),
    headers={"Content-Type": "text/plain", "User-Agent": "csq-docs/1.0"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as r:
    DEST.write_bytes(r.read())
img = None
print(f"ok {DEST} ({DEST.stat().st_size // 1024} KB)")
