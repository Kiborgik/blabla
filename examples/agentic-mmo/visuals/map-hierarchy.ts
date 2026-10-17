import { visualDetail, type DetailLevel } from './visual-language.ts';

export interface ScreenBox { left: number; top: number; width: number; height: number }
export interface HierarchyAnchor {
  id: string;
  kind: 'town' | 'wonder' | 'site' | 'resource' | 'route';
  label: string;
  x: number;
  y: number;
  tileId?: number;
  selected?: boolean;
  related?: boolean;
  revealed?: boolean;
  completed?: boolean;
  importance?: number;
}
export interface HierarchyFrame {
  width: number;
  height: number;
  tileDiameter: number;
  previousDetail?: DetailLevel;
  blocked?: readonly ScreenBox[];
}
export interface HierarchyPlacement {
  id: string;
  kind: HierarchyAnchor['kind'];
  anchor: { x: number; y: number };
  mark: ScreenBox | null;
  label: ScreenBox | null;
  leader: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  caption: string;
  fullLabel: string;
  fontSize: number;
  symbolSize: number;
  emphasis: 'selected' | 'landmark' | 'normal' | 'subtle';
}
export interface HierarchyBudget { detail: DetailLevel; marks: number; labels: number; resources: number; resourceSpacing: number }

export function hierarchyScale(tileDiameter: number, width: number, previous?: DetailLevel): HierarchyBudget {
  const detail = visualDetail(tileDiameter, previous);
  const index = detail === 'far' ? 0 : detail === 'mid' ? 1 : 2;
  const narrow = width < 600;
  return { detail, marks: (narrow ? [8, 12, 16] : [12, 18, 24])[index] ?? 8,
    labels: [5, 8, 12][index] ?? 5, resources: (narrow ? [2, 4, 6] : [3, 6, 10])[index] ?? 2,
    resourceSpacing: [88, 64, 44][index] ?? 88 };
}

function intersects(a: ScreenBox, b: ScreenBox, gap = 4): boolean {
  return a.left < b.left + b.width + gap && a.left + a.width + gap > b.left && a.top < b.top + b.height + gap && a.top + a.height + gap > b.top;
}

function priority(item: HierarchyAnchor): number {
  if (item.selected) return 0;
  if (item.kind === 'wonder' && item.completed) return 1;
  if (item.kind === 'town') return 2;
  if (item.related) return 3;
  if (item.kind === 'wonder') return 4;
  if (item.kind === 'site') return 5;
  if (item.kind === 'route') return 6;
  return 7;
}

const labelSegments = new Intl.Segmenter('en', { granularity: 'grapheme' });

function clippedCaption(label: string, characters: number): string {
  const points = Array.from(labelSegments.segment(label), item => item.segment);
  return points.length <= characters ? label : points.slice(0, characters - 1).join('') + '…';
}

function candidateMarks(item: HierarchyAnchor, size: number): ScreenBox[] {
  const lift = item.kind === 'town' ? -14 : item.kind === 'resource' ? -10 : -20;
  const distances = item.kind === 'resource' ? [0] : item.selected || item.related || item.kind === 'town' ? [0, 28, 48, 64] : [0, 28];
  return distances.flatMap(distance => {
    const offsets = distance === 0 ? [[0, 0]] : [[0, -distance], [-distance, 0], [distance, 0], [0, distance], [-distance, -distance], [distance, -distance], [-distance, distance], [distance, distance]];
    return offsets.map(([dx, dy]) => ({ left: item.x + (dx ?? 0) - size / 2, top: item.y + lift + (dy ?? 0) - size / 2, width: size, height: size }));
  });
}

export function allocateMapHierarchy(anchors: readonly HierarchyAnchor[], frame: HierarchyFrame): { budgets: HierarchyBudget; items: HierarchyPlacement[] } {
  const budgets = hierarchyScale(frame.tileDiameter, frame.width, frame.previousDetail);
  const occupied = (frame.blocked ?? []).map(box => ({ ...box }));
  const resources: Array<{ x: number; y: number }> = [];
  const occupiedTiles = new Set(anchors.filter(item => item.kind !== 'resource' && item.tileId !== undefined).map(item => item.tileId));
  const sorted = anchors.toSorted((a, b) => priority(a) - priority(b)
    || (Number.isFinite(b.importance) ? b.importance ?? 0 : 0) - (Number.isFinite(a.importance) ? a.importance ?? 0 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let marks = 0;
  let labels = 0;
  const fits = (box: ScreenBox): boolean => box.left >= 8 && box.top >= 8 && box.left + box.width <= frame.width - 8 && box.top + box.height <= frame.height - 8 && !occupied.some(other => intersects(box, other));
  const labelsFor = (placement: HierarchyPlacement, item: HierarchyAnchor): void => {
    const mark = placement.mark;
    if (!mark) return;
    const { caption, fontSize } = placement;
    const center = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
    const canLabel = item.kind === 'town' || item.kind === 'wonder' && item.completed || item.selected || item.related || budgets.detail !== 'far' && item.kind !== 'resource' || budgets.detail === 'close';
    if (!canLabel || labels >= budgets.labels) return;
    const width = Math.min(frame.width - 16, Math.max(44, Array.from(labelSegments.segment(caption)).length * fontSize * .58 + 12));
    const height = fontSize + 10;
    const candidates: ScreenBox[] = [
      { left: center.x - width / 2, top: mark.top + mark.height + 5, width, height },
      { left: center.x - width / 2, top: mark.top - height - 5, width, height },
      { left: mark.left + mark.width + 5, top: center.y - height / 2, width, height },
      { left: mark.left - width - 5, top: center.y - height / 2, width, height },
      { left: center.x - width / 2, top: mark.top + mark.height + 5 + height, width, height },
      { left: center.x - width / 2, top: mark.top - height * 2 - 5, width, height },
    ];
    const label = candidates.map(box => ({ ...box, left: Math.max(8, Math.min(frame.width - width - 8, box.left)) })).find(fits);
    if (label) { placement.label = label; occupied.push(label); labels += 1; }
  };
  const items = sorted.map(item => {
    const fontSize = item.selected && item.kind === 'town' ? 14 : 12;
    const caption = clippedCaption(item.label, frame.width < 600 ? item.kind === 'town' ? 25 : 22 : 32);
    const placement: HierarchyPlacement = { id: item.id, kind: item.kind, anchor: { x: item.x, y: item.y }, mark: null, label: null, leader: null,
      caption, fullLabel: item.label, fontSize, symbolSize: item.kind === 'resource' ? 15 : item.selected ? 26 : item.kind === 'town' ? 22 : 20,
      emphasis: item.selected ? 'selected' : item.kind === 'wonder' && item.completed ? 'landmark' : item.kind === 'resource' ? 'subtle' : 'normal' };
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y) || item.x < 0 || item.y < 0 || item.x > frame.width || item.y > frame.height || marks >= budgets.marks) return placement;
    if (item.kind === 'resource' && (!item.revealed || resources.length >= budgets.resources || item.tileId !== undefined && occupiedTiles.has(item.tileId)
      || resources.some(other => Math.hypot(item.x - other.x, item.y - other.y) < budgets.resourceSpacing))) return placement;
    const mark = candidateMarks(item, item.kind === 'resource' ? 20 : 44).find(fits);
    if (!mark) return placement;
    placement.mark = mark;
    occupied.push(mark);
    marks += 1;
    if (item.kind === 'resource') resources.push({ x: item.x, y: item.y });
    const center = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
    if (item.kind !== 'resource' && Math.hypot(center.x - item.x, center.y - item.y) > 8) placement.leader = { from: { ...placement.anchor }, to: center };
    if (item.selected || item.kind === 'wonder' && item.completed) labelsFor(placement, item);
    return placement;
  });
  for (const [index, placement] of items.entries()) {
    const item = sorted[index]; if (item && !placement.label) labelsFor(placement, item);
  }
  return { budgets, items };
}

export interface RetainedMapPoint { id: string | number; x: number; z: number }

export function retainedCoordinateShift(before: readonly RetainedMapPoint[], after: readonly RetainedMapPoint[]): { x: number; z: number } | null {
  const previous = new Map(before.map(point => [point.id, point]));
  let shift: { x: number; z: number } | null = null;
  let count = 0;
  for (const point of after) {
    const old = previous.get(point.id);
    if (!old || ![point.x, point.z, old.x, old.z].every(Number.isFinite)) continue;
    const delta = { x: point.x - old.x, z: point.z - old.z };
    if (shift && (Math.abs(shift.x - delta.x) > 1e-8 || Math.abs(shift.z - delta.z) > 1e-8)) return null;
    shift ??= delta;
    count += 1;
  }
  return count >= 2 ? shift : null;
}

export function mapContentWindow(width: number, height: number, blocked: readonly ScreenBox[]): ScreenBox | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) return null;
  const obstacles = blocked.filter(box => [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0)
    .map(box => ({ left: Math.max(8, box.left - 6), top: Math.max(8, box.top - 6),
      right: Math.min(width - 8, box.left + box.width + 6), bottom: Math.min(height - 8, box.top + box.height + 6) }))
    .filter(box => box.right > box.left && box.bottom > box.top)
    .map(box => ({ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }));
  const xs = [...new Set([8, width - 8, ...obstacles.flatMap(box => [box.left, box.left + box.width])])].toSorted((a, b) => a - b);
  const ys = [...new Set([8, height - 8, ...obstacles.flatMap(box => [box.top, box.top + box.height])])].toSorted((a, b) => a - b);
  let best: ScreenBox | null = null;
  for (const left of xs) for (const right of xs) {
    if (right <= left) continue;
    for (const top of ys) for (const bottom of ys) {
      if (bottom <= top) continue;
      const candidate = { left, top, width: right - left, height: bottom - top };
      if (obstacles.some(box => intersects(candidate, box, 0))) continue;
      if (!best || candidate.width * candidate.height > best.width * best.height) best = candidate;
    }
  }
  return best;
}

export function fitMapOverview(points: readonly { x: number; z: number }[], viewport: { width: number; height: number }, window: ScreenBox): { x: number; z: number; halfHeight: number } | null {
  const finite = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.z));
  if (!finite.length || viewport.width <= 0 || viewport.height <= 0 || window.width <= 0 || window.height <= 0) return null;
  const left = Math.min(...finite.map(point => point.x)) - 2;
  const right = Math.max(...finite.map(point => point.x)) + 2;
  const top = Math.min(...finite.map(point => point.z)) - 2;
  const bottom = Math.max(...finite.map(point => point.z)) + 2;
  const scale = Math.min(window.width / (right - left), window.height / (bottom - top));
  return { x: (left + right) / 2 - (window.left + window.width / 2 - viewport.width / 2) / scale,
    z: (top + bottom) / 2 - (window.top + window.height / 2 - viewport.height / 2) / scale,
    halfHeight: viewport.height / (2 * scale) };
}
