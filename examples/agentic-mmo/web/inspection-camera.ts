export interface CameraView { x: number; z: number; zoom: number }
export interface ScreenPoint { x: number; y: number }

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
