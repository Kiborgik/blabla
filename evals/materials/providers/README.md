# Widget in five languages

The same small widget store is written in Rust, TypeScript, Go, Java and C. In every language a
model defines the widget, a store saves the widgets, and a format module encodes them.

## Code rules, in every language

- `the-store-is-a-type`: the store module defines the store type.
- `state-survives-a-restart`: the store has a save operation that writes the widgets to disk.
- `the-format-encodes`: the format module defines the encode operation.
- `the-store-uses-the-model`: the store imports the model.
- `the-store-encodes-through-the-format`: the store encodes through the format module.
- `the-model-stays-below-the-store`: the model never imports the store.
- `the-format-stays-below-the-store`: the format module never imports the store.

C also requires `the-store-declares-save`: `c/store.h` declares `store_save`.

## Where each language keeps them

| Language | Model | Store | Format |
| --- | --- | --- | --- |
| Rust | `rust/src/model.rs` | `rust/src/store.rs`: `Store`, `Store::save` | `rust/src/format.rs`: `encode` |
| TypeScript | `typescript/model.ts` | `typescript/store.ts`: `WidgetStore`, `save` | `typescript/format.ts`: `encode` |
| Go | `go/model/model.go` | `go/store/store.go`: `Store`, `Save` | `go/format/format.go`: `Encode` |
| Java | `widget/model/Widget.java` | `widget/store/WidgetStore.java`: `WidgetStore`, `save` | `widget/format/WidgetFormat.java`: `encode` |
| C | `c/model.c`, `c/model.h` | `c/store.h`, `c/store.c`: `Store`, `store_save` | `c/format.h`, `c/format.c`: `format_encode` |
