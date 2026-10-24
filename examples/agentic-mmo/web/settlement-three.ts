import { settlementPartColor } from '../visuals/settlement-homes.ts';
import { greatLibraryVisual } from '../visuals/wonder-landmark.ts';
import { depositParts } from '../visuals/strategic-resource-visuals.ts';
import * as THREE from 'three';
import type { AtlasWorld } from './atlas.ts';
import { hexPosition } from './atlas.ts';
import { settlementVisual, SETTLEMENT_RENDER_SCALE, VISUAL_PALETTE, visualDetail, settlementDetail } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';
import { shapeTriangles } from './settlement-parts.ts';
import { improvementParts } from '../visuals/improvement-visuals.ts';
import { districtParts } from '../visuals/district-visuals.ts';

export function createPartMeshes(project: (detail: DetailLevel) => Array<{ part: VisualPart; color: string }>, material: (color: string) => THREE.Material, resolveDetail: typeof visualDetail = visualDetail): {
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
      const next = resolveDetail(tilePixels, detail);
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
      color: settlementPartColor(part, city.color),
      part: { ...part, position: [origin.x + part.position[0] * SETTLEMENT_RENDER_SCALE, floor + part.position[1] * SETTLEMENT_RENDER_SCALE, origin.z + part.position[2] * SETTLEMENT_RENDER_SCALE],
        scale: [part.scale[0] * SETTLEMENT_RENDER_SCALE, part.scale[1] * SETTLEMENT_RENDER_SCALE, part.scale[2] * SETTLEMENT_RENDER_SCALE] },
    }));
  }), material, settlementDetail);
}

export function createDistrictMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => (world.districts ?? []).flatMap(district => {
    const origin = hexPosition(district.q, district.r);
    return districtParts(district, detail).map(part => ({
      color: part.material === 'identity' ? district.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], district.height + part.position[1], origin.z + part.position[2]] },
    }));
  }), material, settlementDetail);
}

export function createImprovementMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => (world.improvements ?? []).flatMap(site => {
    const origin = hexPosition(site.q, site.r);
    return improvementParts(site, detail).map(part => ({
      color: part.material === 'identity' ? site.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], site.height + part.position[1], origin.z + part.position[2]] },
    }));
  }), material, settlementDetail);
}

export function createDepositMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => (world.deposits ?? []).flatMap(site => {
    const origin = hexPosition(site.q, site.r);
    return depositParts(site, detail).map(part => ({
      color: part.material === 'identity' ? VISUAL_PALETTE.metal : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], site.height + part.position[1], origin.z + part.position[2]] },
    }));
  }), material);
}

export function createWonderMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => (world.wonders ?? []).flatMap(site => {
    const origin = hexPosition(site.q, site.r);
    return greatLibraryVisual(site.record, detail).parts.map(part => ({
      color: part.material === 'identity' ? site.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], site.height + part.position[1], origin.z + part.position[2]] },
    }));
  }), material);
}
