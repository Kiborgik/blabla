import json

from widget.model import FIELDS, Widget


def encode(widgets):
    return json.dumps([{field: getattr(widget, field) for field in FIELDS} for widget in widgets])


def decode(text):
    rows = json.loads(text)
    return [Widget(index, row["text"]) for index, row in enumerate(rows)]
