from widget.model import FIELDS, Widget


def encode(widgets):
    return [{field: getattr(widget, field) for field in FIELDS} for widget in widgets]


def decode(rows):
    return [Widget(row["id"], row["text"]) for row in rows]
