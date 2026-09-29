import json
from pathlib import Path

from widget.format import decode, encode
from widget.model import Widget

FILE_NAME = "widget.json"


class WidgetStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else Path.cwd() / FILE_NAME

    def load(self) -> list[Widget]:
        if not self.path.exists():
            return []
        return decode(json.loads(self.path.read_text(encoding="utf-8")))

    def save(self, widgets: list[Widget]):
        self.path.write_text(json.dumps(encode(widgets)), encoding="utf-8")
