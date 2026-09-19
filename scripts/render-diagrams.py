"""Render every mermaid block in docs/2026-09-19-csq-flow-diagram.md to PNG
via kroki.io/mermaid/png (POST body = diagram source, no local browser)."""

import re
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
MD = ROOT / "docs" / "2026-09-19-csq-flow-diagram.md"
OUT = ROOT / "docs" / "diagrams"
OUT.mkdir(parents=True, exist_ok=True)

NAMES = [
    "01-architecture",
    "02-inbound-message-loop",
    "03-tool-gateway",
    "04-data-ingestion",
    "05-inbox-handoff",
    "06-scenario-automation",
    "07-semantic-search",
    "08-channel-onboarding",
    "09-pipeline",
    "10-deployment-topology",
]

blocks = re.findall(r"```mermaid\r?\n(.*?)```", MD.read_text(encoding="utf-8"), re.S)
print(f"found {len(blocks)} mermaid blocks")
assert len(blocks) == len(NAMES), "block count mismatch"

for name, code in zip(NAMES, blocks):
    dest = OUT / f"{name}.png"
    body = code.strip().encode("utf-8")
    req = urllib.request.Request(
        "https://kroki.io/mermaid/png",
        data=body,
        headers={"Content-Type": "text/plain", "User-Agent": "csq-docs/1.0"},
        method="POST",
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                dest.write_bytes(r.read())
            print(f"ok  {dest.name} ({dest.stat().st_size // 1024} KB)")
            break
        except Exception as e:
            print(f"retry {name} ({e})")
            time.sleep(3)
    else:
        print(f"FAILED {name}")
    time.sleep(1)
