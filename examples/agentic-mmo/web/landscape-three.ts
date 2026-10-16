import type * as THREE from 'three';
import type { AtlasWorld } from './atlas.ts';
import { projectLandscape } from '../visuals/landscape.ts';
import { VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import { createPartMeshes } from './settlement-three.ts';

export function createLandscapeMeshes(world: AtlasWorld, material: (color: string) => THREE.Material): ReturnType<typeof createPartMeshes> {
  return createPartMeshes(detail => projectLandscape(world.tiles, [...world.cities, ...(world.districts ?? []), ...(world.improvements ?? [])], detail).parts.map(part => ({
    part, color: part.material === 'identity' ? VISUAL_PALETTE.stone : VISUAL_PALETTE[part.material],
  })), material);
}
