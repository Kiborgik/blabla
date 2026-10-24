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
  focused?: boolean;
  revealed?: boolean;
  completed?: boolean;
  importance?: number;
  protectedBounds?: ScreenBox;
  geometryReason?: string;
  shortLabel?: string;
  captionWidth?: number;
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
  symbol: ScreenBox | null;
  label: ScreenBox | null;
  leader: { from: { x: number; y: number }; to: { x: number; y: number } } | null;
  caption: string;
  fullLabel: string;
  fontSize: number;
  symbolSize: number;
  emphasis: 'selected' | 'landmark' | 'normal' | 'subtle';
  placementMode: 'exterior' | 'compact' | 'generic' | 'omitted';
  fallbackReason: string | null;
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

function validBox(box: ScreenBox | undefined): box is ScreenBox {
  return !!box && [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
}

function expanded(box: ScreenBox, amount: number): ScreenBox {
  return { left: box.left - amount, top: box.top - amount, width: box.width + amount * 2, height: box.height + amount * 2 };
}

class BoxIndex {
  private cells = new Map<string, Array<{ box: ScreenBox; id: string }>>();
  private width: number;
  private height: number;
  constructor(width: number, height: number) { this.width = width; this.height = height; }
  private keys(box: ScreenBox): string[] {
    const left = Math.max(-1, Math.floor(box.left / 64));
    const top = Math.max(-1, Math.floor(box.top / 64));
    const right = Math.min(Math.ceil(this.width / 64), Math.floor((box.left + box.width) / 64));
    const bottom = Math.min(Math.ceil(this.height / 64), Math.floor((box.top + box.height) / 64));
    const keys: string[] = [];
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) keys.push(`${x}:${y}`);
    return keys;
  }
  add(box: ScreenBox, id: string): void {
    const entry = { box, id };
    for (const key of this.keys(box)) {
      const cell = this.cells.get(key);
      if (cell) cell.push(entry); else this.cells.set(key, [entry]);
    }
  }
  nearby(box: ScreenBox): Array<{ box: ScreenBox; id: string }> {
    return [...new Set(this.keys(box).flatMap(key => this.cells.get(key) ?? []))];
  }
  overlaps(box: ScreenBox, gap: number, except?: string): boolean {
    return this.nearby(expanded(box, gap)).some(entry => entry.id !== except && intersects(box, entry.box, gap));
  }
}

function priority(item: HierarchyAnchor): number {
  if (item.focused) return -1;
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
const captionCache = new Map<string, string>();
const widthCache = new Map<string, number>();

export function hierarchyCaption(label: string, kind: HierarchyAnchor['kind'], width: number): string {
  const characters = width < 600 ? kind === 'town' ? 25 : 22 : 32;
  const key = `${characters}:${label}`;
  const cached = captionCache.get(key);
  if (cached !== undefined) return cached;
  const points = Array.from(labelSegments.segment(label), item => item.segment);
  const caption = points.length <= characters ? label : points.slice(0, characters - 1).join('') + '…';
  if (captionCache.size >= 512) captionCache.clear();
  captionCache.set(key, caption);
  return caption;
}

function captionEstimate(caption: string, fontSize: number): number {
  const key = `${fontSize}:${caption}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const width = Array.from(labelSegments.segment(caption)).length * fontSize * .58;
  if (widthCache.size >= 512) widthCache.clear();
  widthCache.set(key, width);
  return width;
}

function candidateMarks(item: HierarchyAnchor, size: number): ScreenBox[] {
  const lift = item.kind === 'town' ? -14 : item.kind === 'resource' ? -10 : -20;
  const distances = item.kind === 'resource' ? [0] : item.selected || item.related || item.focused || item.kind === 'town' ? [0, 28, 48, 64] : [0, 28];
  return distances.flatMap(distance => {
    const offsets = distance === 0 ? [[0, 0]] : [[0, -distance], [-distance, 0], [distance, 0], [0, distance], [-distance, -distance], [distance, -distance], [-distance, distance], [distance, distance]];
    return offsets.map(([dx, dy]) => ({ left: item.x + (dx ?? 0) - size / 2, top: item.y + lift + (dy ?? 0) - size / 2, width: size, height: size }));
  });
}

function exteriorMarks(item: HierarchyAnchor, bounds: ScreenBox): ScreenBox[] {
  const left = bounds.left - 31; const right = bounds.left + bounds.width + 31;
  const top = bounds.top - 31; const bottom = bounds.top + bounds.height + 31;
  const x = Math.max(bounds.left, Math.min(bounds.left + bounds.width, item.x));
  const y = Math.max(bounds.top, Math.min(bounds.top + bounds.height, item.y));
  return [[x, bottom], [right, y], [left, y], [x, top], [right, bottom], [left, bottom], [right, top], [left, top]]
    .map(([cx, cy]) => ({ left: (cx ?? 0) - 22, top: (cy ?? 0) - 22, width: 44, height: 44 }))
    .toSorted((a, b) => Math.hypot(a.left + 22 - item.x, a.top + 22 - item.y) - Math.hypot(b.left + 22 - item.x, b.top + 22 - item.y));
}

type Leader = NonNullable<HierarchyPlacement['leader']>;

function markLeader(item: HierarchyAnchor, mark: ScreenBox): Leader | null {
  if (item.kind === 'resource') return null;
  const center = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
  const dx = item.x - center.x; const dy = item.y - center.y;
  const fraction = Math.min(Math.abs(mark.width / (2 * dx)), Math.abs(mark.height / (2 * dy)));
  if (fraction >= 1 || !Number.isFinite(fraction)) return null;
  return { from: { x: item.x, y: item.y }, to: { x: center.x + dx * fraction, y: center.y + dy * fraction } };
}

function lineBounds(line: Leader): ScreenBox {
  return { left: Math.min(line.from.x, line.to.x), top: Math.min(line.from.y, line.to.y), width: Math.abs(line.to.x - line.from.x), height: Math.abs(line.to.y - line.from.y) };
}

function lineIntersectsBox(line: Leader, box: ScreenBox, gap = 2): boolean {
  const bounds = expanded(box, gap);
  let lower = 0; let upper = 1;
  for (const [start, delta, low, high] of [[line.from.x, line.to.x - line.from.x, bounds.left, bounds.left + bounds.width],
    [line.from.y, line.to.y - line.from.y, bounds.top, bounds.top + bounds.height]] as const) {
    if (Math.abs(delta) < 1e-9) { if (start < low || start > high) return false; }
    else { const a = (low - start) / delta; const b = (high - start) / delta; lower = Math.max(lower, Math.min(a, b)); upper = Math.min(upper, Math.max(a, b)); }
    if (lower > upper) return false;
  }
  return true;
}

function linesCross(a: Leader, b: Leader): boolean {
  const cross = (p: Leader['from'], q: Leader['from'], r: Leader['from']): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return intersects(expanded(lineBounds(a), .01), expanded(lineBounds(b), .01), 0)
    && cross(a.from, a.to, b.from) * cross(a.from, a.to, b.to) <= 0 && cross(b.from, b.to, a.from) * cross(b.from, b.to, a.to) <= 0;
}

export function allocateMapHierarchy(anchors: readonly HierarchyAnchor[], frame: HierarchyFrame): { budgets: HierarchyBudget; items: HierarchyPlacement[]; occupied: ScreenBox[] } {
  const budgets = hierarchyScale(frame.tileDiameter, frame.width, frame.previousDetail);
  const architecture = new BoxIndex(frame.width, frame.height);
  const occupiedIndex = new BoxIndex(frame.width, frame.height);
  const occupied: ScreenBox[] = [];
  for (const item of anchors) if (validBox(item.protectedBounds)) architecture.add(item.protectedBounds, item.id);
  for (const box of frame.blocked ?? []) if (validBox(box)) occupiedIndex.add(box, '');
  const hasArchitecture = anchors.some(item => validBox(item.protectedBounds));
  const leaders: Leader[] = [];
  const resources: Array<{ x: number; y: number }> = [];
  const occupiedTiles = new Set(anchors.filter(item => item.kind !== 'resource' && item.tileId !== undefined).map(item => item.tileId));
  const sorted = anchors.toSorted((a, b) => priority(a) - priority(b)
    || (Number.isFinite(b.importance) ? b.importance ?? 0 : 0) - (Number.isFinite(a.importance) ? a.importance ?? 0 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let marks = 0; let labels = 0;
  const fits = (box: ScreenBox, except?: string): boolean => validBox(box) && box.left >= 8 && box.top >= 8
    && box.left + box.width <= frame.width - 8 && box.top + box.height <= frame.height - 8
    && !occupiedIndex.overlaps(box, 4) && !architecture.overlaps(box, 6, except) && !leaders.some(line => lineIntersectsBox(line, box));
  const safeLeader = (line: Leader | null, id: string): boolean => !line || Math.hypot(line.to.x - line.from.x, line.to.y - line.from.y) <= 96
    && !architecture.nearby(expanded(lineBounds(line), 2)).some(entry => entry.id !== id && lineIntersectsBox(line, entry.box))
    && !occupiedIndex.nearby(expanded(lineBounds(line), 2)).some(entry => lineIntersectsBox(line, entry.box))
    && !leaders.some(other => linesCross(line, other));
  const reserve = (box: ScreenBox, id: string): void => { occupied.push(box); occupiedIndex.add(box, id); };
  const items = sorted.map(item => {
    const fontSize = item.selected && item.kind === 'town' ? 14 : 12;
    const caption = hierarchyCaption(item.shortLabel ?? item.label, item.kind, frame.width);
    const placement: HierarchyPlacement = { id: item.id, kind: item.kind, anchor: { x: item.x, y: item.y }, mark: null, symbol: null, label: null, leader: null,
      caption, fullLabel: item.label, fontSize, symbolSize: item.kind === 'resource' ? 15 : item.kind === 'town' ? item.selected ? 22 : 20 : 20,
      emphasis: item.selected ? 'selected' : item.kind === 'wonder' && item.completed ? 'landmark' : item.kind === 'resource' ? 'subtle' : 'normal',
      placementMode: 'omitted', fallbackReason: null };
    const omit = (reason: string): HierarchyPlacement => { placement.fallbackReason = reason; return placement; };
    if (![item.x, item.y, frame.width, frame.height].every(Number.isFinite)) return omit('invalid-anchor');
    if (item.x < 0 || item.y < 0 || item.x > frame.width || item.y > frame.height) return omit('offscreen-anchor');
    if (marks >= budgets.marks) return omit('mark-budget');
    if (budgets.detail === 'far' && item.kind === 'site' && !item.related && !item.selected && !item.focused) return omit('far-detail');
    if (item.kind === 'resource') {
      if (!item.revealed) return omit('unrevealed-resource');
      if (resources.length >= budgets.resources) return omit('resource-budget');
      if (item.tileId !== undefined && occupiedTiles.has(item.tileId)) return omit('occupied-tile');
      if (resources.some(other => Math.hypot(item.x - other.x, item.y - other.y) < budgets.resourceSpacing)) return omit('resource-spacing');
    }
    const bounds = validBox(item.protectedBounds) ? item.protectedBounds : undefined;
    const focusOutset = item.kind === 'resource' ? 0 : 3;
    const exterior = bounds ? exteriorMarks(item, bounds).find(box => fits(expanded(box, focusOutset)) && safeLeader(markLeader(item, box), item.id)) : undefined;
    const mark = exterior ?? candidateMarks(item, item.kind === 'resource' ? 20 : 44).find(box => fits(expanded(box, focusOutset), bounds ? item.id : undefined)
      && (!hasArchitecture && item.kind !== 'site' || safeLeader(markLeader(item, box), item.id)));
    if (!mark) return omit('no-safe-placement');
    placement.mark = mark;
    const center = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
    placement.symbol = { left: center.x - placement.symbolSize / 2, top: center.y - placement.symbolSize / 2, width: placement.symbolSize, height: placement.symbolSize };
    placement.placementMode = exterior ? 'exterior' : bounds ? 'compact' : 'generic';
    placement.fallbackReason = exterior ? null : bounds ? 'exterior-blocked' : item.geometryReason ?? (item.protectedBounds ? 'invalid-protected-bounds' : item.kind === 'site' ? 'geometry-not-provided' : null);
    placement.leader = markLeader(item, mark);
    if ((item.kind === 'site' || hasArchitecture) && placement.leader) leaders.push(placement.leader);
    reserve(expanded(mark, focusOutset), item.id);
    marks += 1;
    if (item.kind === 'resource') resources.push({ x: item.x, y: item.y });
    return placement;
  });
  for (const [index, placement] of items.entries()) {
    const item = sorted[index]; const mark = placement.mark;
    if (!item || !mark || labels >= budgets.labels) continue;
    const canLabel = item.kind === 'town' || item.kind === 'wonder' && item.completed || item.selected || item.related || item.focused
      || budgets.detail !== 'far' && item.kind !== 'resource' || budgets.detail === 'close';
    if (!canLabel) continue;
    const measured = Number.isFinite(item.captionWidth) && (item.captionWidth ?? -1) >= 0 ? item.captionWidth ?? 0 : captionEstimate(placement.caption, placement.fontSize);
    const width = Math.min(frame.width - 16, Math.max(44, measured + 12));
    const height = placement.fontSize + 10;
    const cx = mark.left + mark.width / 2; const cy = mark.top + mark.height / 2;
    const candidates: ScreenBox[] = [
      { left: cx - width / 2, top: mark.top + mark.height + 7, width, height },
      { left: cx - width / 2, top: mark.top - height - 7, width, height },
      { left: mark.left + mark.width + 8, top: cy - height / 2, width, height },
      { left: mark.left - width - 8, top: cy - height / 2, width, height },
      { left: cx - width / 2, top: mark.top + mark.height + 7 + height, width, height },
      { left: cx - width / 2, top: mark.top - height * 2 - 7, width, height },
      { left: mark.left + mark.width - 8, top: mark.top + mark.height + 7, width, height },
      { left: mark.left - width + 8, top: mark.top + mark.height + 7, width, height },
      { left: mark.left + mark.width - 8, top: mark.top - height - 7, width, height },
      { left: mark.left - width + 8, top: mark.top - height - 7, width, height },
    ];
    const label = candidates.map(box => ({ ...box, left: Math.max(8, Math.min(frame.width - width - 8, box.left)) })).find(box => fits(box));
    if (label) { placement.label = label; reserve(label, item.id); labels += 1; }
  }
  return { budgets, items, occupied };
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
