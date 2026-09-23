import json
from pathlib import Path

from widget.model import Widget

FILE_NAME = "widget.json"


class WidgetStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else Path.cwd() / FILE_NAME

    def load(self):
        if not self.path.exists():
            return []
        rows = json.loads(self.path.read_text(encoding="utf-8"))
        return [Widget(row["id"], row["text"]) for row in rows]
