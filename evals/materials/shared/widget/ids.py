def next_id(widgets):
    return max((widget.id for widget in widgets), default=0) + 1
