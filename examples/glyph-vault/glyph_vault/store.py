import json
import os
from pathlib import Path

from model import DURABLE_FIELDS, DurableVault


class VaultStore:
    def __init__(self, path="vaults.json"):
        self.path = Path(path)

    def load(self):
        if not self.path.exists():
            return []
        document = json.loads(self.path.read_text(encoding="utf-8"))
        return [DurableVault(key, *(record[field] for field in DURABLE_FIELDS)) for key, record in document.items()]

    def save(self, rows):
        document = {row.id: {field: getattr(row, field) for field in DURABLE_FIELDS} for row in rows}
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(document, ensure_ascii=False), encoding="utf-8")
        os.replace(temporary, self.path)

    def clear(self):
        self.path.unlink(missing_ok=True)
