import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "adapters" / "python"))

from blabla_adapter import Adapter
from widget.ids import next_id
from widget.log import note
from widget.model import Widget
from widget.store import WidgetStore


class WidgetApplication:
    def __init__(self, storage):
        self.storage = storage
        self.widgets = storage.load()

    def reset(self):
        self.storage.reset()
        self.widgets = []
        note("widget store reset")

    def add(self, text):
        if text == "":
            return
        self.widgets.append(Widget(next_id(self.widgets), text))
        self.storage.save(self.widgets)

    def observe(self):
        return {
            "archived": [],
            "widgets": [
                {"id": widget.id, "text": widget.text} for widget in self.widgets
            ],
        }


def bind(application):
    adapter = Adapter(application.reset, application.observe)
    adapter.action("add", 1, lambda args: application.add(args.string(0)))
    return adapter


if __name__ == "__main__":
    sys.exit(bind(WidgetApplication(WidgetStore())).serve())
