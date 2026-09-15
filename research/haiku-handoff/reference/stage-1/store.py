import json
import os
from dataclasses import asdict
from pathlib import Path

from model import DurableVault


class VaultStore:
    def __init__(self, path="vaults.json"):
        self.path = Path(path)

    def load(self):
        if not self.path.exists():
            return []
        rows = json.loads(self.path.read_text(encoding="utf-8"))
        return [DurableVault(row["id"], row["keeper"], row["glyph"], row["charge"], row["sealed"], row["quarantined"]) for row in rows]

    def save(self, rows):
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps([asdict(row) for row in rows], ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, self.path)

    def clear(self):
        self.path.unlink(missing_ok=True)
