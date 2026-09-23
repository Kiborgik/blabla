import { FIELDS, Widget } from "./model";

export function encode(widgets: Widget[]): string {
  return JSON.stringify(widgets.map((widget) => Object.fromEntries(FIELDS.map((field) => [field, (widget as any)[field]]))));
}

export function decode(text: string): Widget[] {
  return (JSON.parse(text) as { id: number; text: string }[]).map((row) => new Widget(row.id, row.text));
}
