import * as THREE from 'three';
import type { AtlasWorld } from './atlas.ts';
import { projectTerrainSurface, projectLandscape } from '../visuals/landscape.ts';
import { VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import { createPartMeshes } from './settlement-three.ts';

export function createLandscapeMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? []), ...(world.improvements ?? []), ...(world.wonders ?? [])], detail, world.drainage).parts.map(part => ({
    part, color: part.material === 'identity' ? VISUAL_PALETTE.stone : VISUAL_PALETTE[part.material],
  })), material);
}

export function createTerrainMeshes(tiles: Parameters<typeof projectTerrainSurface>[0], drainage?: Parameters<typeof projectTerrainSurface>[1]): THREE.Group {
  const group = new THREE.Group();
  const surface = projectTerrainSurface(tiles, drainage);
  for (const faces of [surface.flatMap(tile => tile.faces), surface.flatMap(tile => tile.cliffs)]) {
    const positions: number[] = []; const colors: number[] = [];
    for (const face of faces) {
      const color = new THREE.Color(face.color);
      for (let index = 1; index < face.points.length - 1; index++) {
        for (const point of [face.points[0], face.points[index + 1], face.points[index]]) {
          if (!point) continue;
          positions.push(...point); colors.push(color.r, color.g, color.b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    mesh.receiveShadow = true; mesh.castShadow = true; group.add(mesh);
  }
  return group;
}
