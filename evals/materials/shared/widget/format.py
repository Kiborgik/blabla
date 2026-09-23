import json

from widget.model import FIELDS, Widget


def encode(widgets):
    return json.dumps([{field: getattr(widget, field) for field in FIELDS} for widget in widgets])


def decode(text):
    return [Widget(row["id"], row["text"]) for row in json.loads(text)]
