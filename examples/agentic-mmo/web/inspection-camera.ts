import type { ScreenBox } from '../visuals/map-hierarchy.ts';

export interface CameraView { x: number; z: number; zoom: number }
export interface ScreenPoint { x: number; y: number }

export function unobscuredInspectionAnchor(
  current: ScreenPoint,
  preferred: ScreenPoint,
  viewport: { width: number; height: number },
  blocked: readonly ScreenBox[],
): ScreenPoint {
  const { width, height } = viewport;
  if (![width, height, current.x, current.y, preferred.x, preferred.y].every(Number.isFinite) || width <= 0 || height <= 0) return current;
  const margin = Math.min(48, width / 2, height / 2);
  const obstacles = blocked.filter(box => [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0)
    .map(box => ({ left: Math.max(0, box.left), top: Math.max(0, box.top), right: Math.min(width, box.left + box.width), bottom: Math.min(height, box.top + box.height) }))
    .filter(box => box.right > box.left && box.bottom > box.top);
  const clear = (x: number, y: number): boolean => x >= margin && x <= width - margin && y >= margin && y <= height - margin
    && !obstacles.some(box => x > box.left - margin && x < box.right + margin && y > box.top - margin && y < box.bottom + margin);
  const start = { x: current.x * width, y: current.y * height };
  if (clear(start.x, start.y)) return current;
  const clampX = (x: number): number => Math.max(margin, Math.min(width - margin, x));
  const clampY = (y: number): number => Math.max(margin, Math.min(height - margin, y));
  const xs = [...new Set([clampX(start.x), clampX(preferred.x * width), margin, width - margin,
    ...obstacles.flatMap(box => [clampX(box.left - margin - 2), clampX(box.right + margin + 2)])])].toSorted((a, b) => a - b);
  const ys = [...new Set([clampY(start.y), clampY(preferred.y * height), margin, height - margin,
    ...obstacles.flatMap(box => [clampY(box.top - margin - 2), clampY(box.bottom + margin + 2)])])].toSorted((a, b) => a - b);
  let best: ScreenPoint | null = null;
  let distance = Infinity;
  let preference = Infinity;
  for (const x of xs) for (const y of ys) {
    if (!clear(x, y)) continue;
    const nextDistance = (x - start.x) ** 2 + (y - start.y) ** 2;
    const nextPreference = (x - preferred.x * width) ** 2 + (y - preferred.y * height) ** 2;
    if (nextDistance < distance || nextDistance === distance && nextPreference < preference) {
      best = { x: x / width, y: y / height };
      distance = nextDistance;
      preference = nextPreference;
    }
  }
  return best ?? current;
}

export function inspectionAnchor(
  map: { x: number; y: number; width: number; height: number },
  headingBottom: number,
  sheetTop: number,
  controlsLeft: number,
): ScreenPoint {
  const left = map.x + 28;
  const right = Math.max(left, controlsLeft - 24);
  const top = Math.max(map.y + 26, headingBottom + 26);
  const bottom = Math.max(top, sheetTop - 36);
  return {
    x: ((left + right) / 2 - map.x) / Math.max(1, map.width),
    y: ((top + bottom) / 2 - map.y) / Math.max(1, map.height),
  };
}

export function cameraShiftForAnchor(
  current: ScreenPoint,
  anchor: ScreenPoint,
  unitX: ScreenPoint,
  unitZ: ScreenPoint,
): { x: number; z: number } {
  const determinant = unitX.x * unitZ.y - unitZ.x * unitX.y;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) return { x: 0, z: 0 };
  const dx = current.x - anchor.x;
  const dy = current.y - anchor.y;
  return {
    x: (dx * unitZ.y - unitZ.x * dy) / determinant,
    z: (unitX.x * dy - dx * unitX.y) / determinant,
  };
}

export function createInspectionSession(): {
  begin: (camera: CameraView) => void;
  active: () => boolean;
  savedCamera: (camera: CameraView) => CameraView;
  release: () => void;
  end: () => CameraView | null;
} {
  let original: CameraView | null = null;
  return {
    begin: (camera) => { original ??= { ...camera }; },
    active: () => original !== null,
    savedCamera: (camera) => ({ ...(original ?? camera) }),
    release: () => { original = null; },
    end: () => { const restore = original; original = null; return restore; },
  };
}
