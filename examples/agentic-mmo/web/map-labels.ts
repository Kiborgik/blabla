import { DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import type { DetailLevel } from '../visuals/world-visuals.ts';

export interface MapLabel { id: number; x: number; y: number; width: number; height: number }

export function mapLabelVisibility(labels: readonly MapLabel[], selected: number, detail: DetailLevel, width: number, height: number): boolean[] {
  const visible = labels.map(() => false);
  const chosen = labels.findIndex((label) => label.id === selected);
  const order = labels.map((_, index) => index).toSorted((a, b) => Number(b === chosen) - Number(a === chosen));
  const occupied: MapLabel[] = [];
  for (const index of order) {
    const label = labels[index];
    if (!label || occupied.length >= DETAIL_BUDGETS[detail].labels) continue;
    if (label.x + label.width / 2 < 0 || label.x - label.width / 2 > width || label.y + label.height < 0 || label.y > height) continue;
    if (index !== chosen && occupied.some((other) => Math.abs(label.x - other.x) < (label.width + other.width) / 2 + 6 && Math.abs(label.y - other.y) < Math.max(label.height, other.height) + 4)) continue;
    occupied.push(label);
    visible[index] = true;
  }
  return visible;
}
