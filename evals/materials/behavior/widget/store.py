from widget.model import Widget
from pathlib import Path

FILE_NAME = "widget.json"


class WidgetStore:
    def __init__(self, path=None):
        self.path = Path(path) if path is not None else Path.cwd() / FILE_NAME

    def load(self):
        return []

    def save(self, widgets):
        return None

    def reset(self):
        self.path.unlink(missing_ok=True)
