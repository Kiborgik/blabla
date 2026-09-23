# Widget

Widgets are kept in a list and saved to disk, so they are still there after the program restarts.

## Code rules

- `a-widget-is-a-type`: `widget/model.py` defines `Widget`.
- `the-model-names-its-fields`: `widget/model.py` defines `FIELDS`, the names of a widget's fields.
- `the-store-is-a-type`: `widget/store.py` defines `WidgetStore`.
- `state-is-read-back-at-start`: `WidgetStore.load` reads the saved widgets back.
- `state-survives-a-restart`: `WidgetStore.save` writes the widgets to disk.
- `the-format-encodes`: `widget/format.py` defines `encode`.
- `the-format-decodes`: `widget/format.py` defines `decode`.
- `ids-are-minted-in-one-place`: `widget/ids.py` defines `next_id`, the one place new ids are made.
- `the-store-uses-the-model`: `widget/store.py` imports `widget/model.py`.
- `the-store-encodes-through-the-format`: `widget/store.py` encodes and decodes widgets through `widget/format.py`.
- `the-model-stays-below-the-store`: `widget/model.py` never imports `widget/store.py`.
- `the-format-stays-below-the-store`: `widget/format.py` never imports `widget/store.py`.
- `the-store-encodes-nothing-itself`: `widget/store.py` never imports `json`; encoding belongs to the format module.
