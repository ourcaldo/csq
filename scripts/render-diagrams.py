"""Render the single CSQ flow to docs/diagrams/csq-flow.png via kroki.io.

The mermaid source lives here (inline) — no markdown file involved.
Run: python scripts/render-diagrams.py
"""

import sys
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).parent.parent
DEST = ROOT / "docs" / "diagrams" / "csq-flow.png"
DEST.parent.mkdir(parents=True, exist_ok=True)

MERMAID = """flowchart LR
    W1["WhatsApp Business API"] --> S["AI Agent siap melayani"]
    W2["Scan QR — pakai nomor<br/>WhatsApp sendiri"] --> S

    C["Pelanggan chat<br/>via WhatsApp"] --> S

    S --> A["AI jawab otomatis<br/>produk · stok · retur · pengiriman"]
    A --> B{"Buat pesanan?"}
    B -- "ya" --> D["Order masuk,<br/>stok berkurang otomatis"]
    B -- "tidak" --> R
    A --> E{"Perlu CS manusia?"}
    E -- "ya" --> F["CS ambil alih chat,<br/>AI lanjut layani pelanggan lain"]
    E -- "tidak" --> R["Semua tercatat otomatis"]
    D --> R
    F --> R
    R --> G["Pipeline: pelanggan baru<br/>→ tertarik → deal"]
    G --> H["Otomasi follow-up<br/>chat baru · setelah order · tanpa balasan · jadwal"]
    H -.-> C
"""

req = urllib.request.Request(
    "https://kroki.io/mermaid/png",
    data=MERMAID.strip().encode("utf-8"),
    headers={"Content-Type": "text/plain", "User-Agent": "csq-docs/1.0"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as r:
    DEST.write_bytes(r.read())
print(f"ok {DEST} ({DEST.stat().st_size // 1024} KB)")
