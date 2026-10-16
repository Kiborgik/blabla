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

export function partShape(shape: VisualPart['shape']): PartShape {
  return shape === 'gable' ? GABLE : shape === 'cylinder' ? CYLINDER : BOX;
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

export function flatPartFaces(part: VisualPart): Array<{ points: string; shade: number; depth: number }> {
  const vertices = transformedVertices(part);
  return partShape(part.shape).faces.map((face, index) => {
    const points = face.flatMap((i) => vertices[i] ? [vertices[i]] : []);
    return { points: points.map(([x, y, z]) => `${x.toFixed(3)},${(z - y * .85).toFixed(3)}`).join(' '),
      shade: index === 1 ? 0 : index % 2 ? .13 : .27,
      depth: points.reduce((sum, point) => sum + point[2] + point[1] * .01, 0) / Math.max(1, points.length) };
  }).toSorted((a, b) => a.depth - b.depth);
}

export function shapeTriangles(shape: VisualPart['shape']): number[] {
  const { vertices, faces } = partShape(shape);
  return faces.flatMap((face) => face.slice(1, -1).flatMap((_, i) => [face[0], face[i + 2], face[i + 1]].flatMap((index) => index === undefined ? [] : vertices[index] ?? [])));
}
