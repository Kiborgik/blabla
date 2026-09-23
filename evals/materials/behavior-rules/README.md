# Widget

A small application that keeps a list of widgets. It is driven one JSON request per line through
the adapter in `adapters/python/blabla_adapter.py`, and it keeps its widgets across a restart of
its process.

## Behavior

- `empty-add-noop`: adding an empty text changes nothing.
- `add-count`: adding a non-empty text adds exactly one widget.
- `added-widget`: the added widget carries the given text and an id no earlier widget had.
- `add-preserves-existing`: adding never changes or drops a widget that was already there.
- `persistence`: after the process restarts, the widgets are exactly the ones before the restart.
- `unique-ids`: no two widgets share an id.
- `empty-text`: no widget ever has an empty text.

## Code rules

- `a-widget-is-a-type`: `widget/model.py` defines `Widget`.
- `the-model-names-its-fields`: `widget/model.py` defines `FIELDS`, the names of a widget's fields.
- `the-store-is-a-type`: `widget/store.py` defines `WidgetStore`.
- `state-is-read-back-at-start`: `WidgetStore.load` reads the saved widgets back.
- `state-survives-a-restart`: `WidgetStore.save` writes the widgets to disk.
- `the-application-is-bound`: `app.py` defines `WidgetApplication`.
- `actions-are-bound`: `app.py` defines `bind`, which binds the application's actions to the adapter.
- `the-store-uses-the-model`: `widget/store.py` imports `widget/model.py`.
- `the-app-uses-the-adapter`: `app.py` imports `blabla_adapter`.
- `the-format-encodes`: `widget/format.py` defines `encode`.
- `the-format-decodes`: `widget/format.py` defines `decode`.
- `ids-are-minted-in-one-place`: `widget/ids.py` defines `next_id`, the one place new ids are made.
- `diagnostics-have-one-owner`: `widget/log.py` defines `note`, the one place diagnostics are written.
- `the-app-mints-ids-through-ids`: `app.py` imports `widget/ids.py`.
- `the-store-encodes-through-the-format`: `widget/store.py` encodes and decodes widgets through `widget/format.py`.
- `the-model-stays-below-the-store`: `widget/model.py` never imports `widget/store.py`.
- `the-format-stays-below-the-store`: `widget/format.py` never imports `widget/store.py`.
- `the-store-encodes-nothing-itself`: `widget/store.py` never imports `json`; encoding belongs to the format module.

## Ownership

The model defines what a widget is, its identity and its fields, independent of how it is stored.
The store persists the widget list and reads it back at start, and it owns the record format on
disk. The store reads and writes `Widget` values; the model never learns how they are stored.

## Persistence practice

- `one-writer-owns-the-format`: exactly one module decides the on-disk record format. Before
  changing the format, read every place that parses it, write the new reader first, and only then
  change the writer, so a file written by either version can still be read.
- `write-then-rename`: write a new file beside the old one and rename it into place, so a crash
  mid-write leaves the previous complete file rather than a truncated one.
