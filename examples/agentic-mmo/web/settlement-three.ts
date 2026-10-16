import * as THREE from 'three';
import type { AtlasWorld } from './atlas.ts';
import { hexPosition } from './atlas.ts';
import { settlementVisual, VISUAL_PALETTE, visualDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import { shapeTriangles } from './settlement-parts.ts';

export function createPartMeshes(project: (detail: DetailLevel) => Array<{ part: VisualPart; color: string }>, material: (color: string) => THREE.Material): {
  group: THREE.Group; update: (tilePixels: number) => DetailLevel; dispose: () => void;
} {
  const group = new THREE.Group();
  const geometries = new Map<VisualPart['shape'], THREE.BufferGeometry>();
  let detail: DetailLevel | undefined;
  const clear = (): void => {
    for (const mesh of group.children) if (mesh instanceof THREE.InstancedMesh) mesh.dispose();
    group.clear();
  };
  return {
    group,
    update: (tilePixels) => {
      const next = visualDetail(tilePixels, detail);
      if (next === detail) return next;
      detail = next;
      clear();
      const batches = new Map<string, { shape: VisualPart['shape']; color: string; matrices: THREE.Matrix4[] }>();
      for (const { part, color } of project(detail)) {
        const key = `${part.shape}:${color}`;
        const batch = batches.get(key) ?? { shape: part.shape, color, matrices: [] };
        batch.matrices.push(new THREE.Matrix4().compose(
          new THREE.Vector3(...part.position),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), part.rotation),
          new THREE.Vector3(...part.scale),
        ));
        batches.set(key, batch);
      }
      for (const batch of batches.values()) {
        let geometry = geometries.get(batch.shape);
        if (!geometry) {
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.Float32BufferAttribute(shapeTriangles(batch.shape), 3));
          geometry.computeVertexNormals();
          geometries.set(batch.shape, geometry);
        }
        const mesh = new THREE.InstancedMesh(geometry, material(batch.color), batch.matrices.length);
        batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return next;
    },
    dispose: () => { clear(); for (const geometry of geometries.values()) geometry.dispose(); group.removeFromParent(); },
  };
}

export function createSettlementMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => world.cities.flatMap(city => {
    if (!city.settlement) return [];
    const origin = hexPosition(city.q, city.r);
    const floor = world.tiles.find(tile => tile.q === city.q && tile.r === city.r)?.height ?? .4;
    return settlementVisual(city.settlement, detail).parts.map(part => ({
      color: part.material === 'identity' ? city.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], floor + part.position[1], origin.z + part.position[2]] },
    }));
  }), material);
}
