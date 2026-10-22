import type { VisualPart } from '../visuals/world-visuals.ts';

export type Point3 = readonly [number, number, number];
export interface PartShape { vertices: readonly Point3[]; faces: readonly (readonly number[])[] }

const BOX: PartShape = {
  vertices: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [-.5, .5, -.5], [.5, .5, -.5], [.5, .5, .5], [-.5, .5, .5]],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
};
const GABLE: PartShape = {
  vertices: [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [0, .5, -.5], [0, .5, .5]],
  faces: [[0, 3, 2, 1], [0, 1, 4], [3, 5, 2], [0, 4, 5, 3], [1, 2, 5, 4]],
};
const CYLINDER: PartShape = {
  vertices: Array.from({ length: 16 }, (_, i) => [Math.cos(i % 8 * Math.PI / 4) / 2, i < 8 ? -.5 : .5, Math.sin(i % 8 * Math.PI / 4) / 2]),
  faces: [Array.from({ length: 8 }, (_, i) => 7 - i), Array.from({ length: 8 }, (_, i) => i + 8), ...Array.from({ length: 8 }, (_, i) => [i, (i + 1) % 8, (i + 1) % 8 + 8, i + 8])],
};

const CONE: PartShape = {
  vertices: [...Array.from({ length: 6 }, (_, i): Point3 => [Math.cos(i * Math.PI / 3) / 2, -.5, Math.sin(i * Math.PI / 3) / 2]), [0, .5, 0]],
  faces: [[5, 4, 3, 2, 1, 0], ...Array.from({ length: 6 }, (_, i) => [i, (i + 1) % 6, 6])],
};
const CANOPY: PartShape = {
  vertices: [...Array.from({ length: 12 }, (_, i): Point3 => [Math.cos(i % 6 * Math.PI / 3) * (i < 6 ? .5 : .3), i < 6 ? -.25 : .3, Math.sin(i % 6 * Math.PI / 3) * (i < 6 ? .5 : .3)]), [0, .5, 0], [0, -.5, 0]],
  faces: [...Array.from({ length: 6 }, (_, i) => [i, (i + 1) % 6, (i + 1) % 6 + 6, i + 6]), ...Array.from({ length: 6 }, (_, i) => [i + 6, (i + 1) % 6 + 6, 12]), ...Array.from({ length: 6 }, (_, i) => [(i + 1) % 6, i, 13])],
};

export function partShape(shape: VisualPart['shape']): PartShape {
  return shape === 'gable' ? GABLE : shape === 'cylinder' ? CYLINDER : shape === 'cone' ? CONE : shape === 'canopy' ? CANOPY : BOX;
}

export function transformedVertices(part: VisualPart): Point3[] {
  const sine = Math.sin(part.rotation);
  const cosine = Math.cos(part.rotation);
  return partShape(part.shape).vertices.map(([x, y, z]) => {
    const sx = x * part.scale[0];
    const sz = z * part.scale[2];
    return [part.position[0] + sx * cosine + sz * sine, part.position[1] + y * part.scale[1], part.position[2] - sx * sine + sz * cosine];
  });
}

export function flatMapPoint(x: number, z: number, height = 0): { x: number; z: number } {
  return { x, z: z * .72 - height * .85 };
}

export function flatPartFaces(part: VisualPart, groundScale = 1): Array<{ points: string; shade: number; depth: number }> {
  const vertices = transformedVertices(part);
  return partShape(part.shape).faces.flatMap((face, index) => {
    const points = face.flatMap((i) => vertices[i] ? [vertices[i]] : []);
    const projected = points.map(([x, y, z]) => [x, z * groundScale - y * .85] as const);
    const area = projected.reduce((sum, p, i) => {
      const next = projected[(i + 1) % projected.length];
      return sum + (next ? p[0] * next[1] - next[0] * p[1] : 0);
    }, 0);
    if (area <= .000001) return [];
    return [{ points: projected.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' '),
      shade: index === 1 ? 0 : index % 2 ? .10 : .22,
      depth: points.reduce((sum, point) => sum + point[2] * .85 + point[1] * groundScale, 0) / Math.max(1, points.length) }];
  }).toSorted((a, b) => a.depth - b.depth);
}

export function flatSceneFaces(parts: readonly VisualPart[], groundScale = 1): Array<{ part: VisualPart; points: string; shade: number; depth: number }> {
  return parts.flatMap(part => flatPartFaces(part, groundScale).map(face => ({ part, ...face }))).toSorted((a, b) => a.depth - b.depth || a.part.id.localeCompare(b.part.id));
}

export function shapeTriangles(shape: VisualPart['shape']): number[] {
  const { vertices, faces } = partShape(shape);
  return faces.flatMap((face) => face.slice(1, -1).flatMap((_, i) => [face[0], face[i + 2], face[i + 1]].flatMap((index) => index === undefined ? [] : vertices[index] ?? [])));
}
export function mapOverlayBounds(container: HTMLElement): Array<{ x: number; y: number; width: number; height: number }> {
  const origin = container.getBoundingClientRect();
  return [...(container.parentElement?.querySelectorAll('.civilization-panel, .inspection, .world-heading, .chronicle, .map-controls') ?? [])].flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.width && box.height ? [{ x: box.left + box.width / 2 - origin.left, y: box.top - origin.top, width: box.width, height: box.height }] : [];
  });
}
